import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStreamJson } from "./claude-agent";
import { runDeepSeekRaw } from "./deepseek-agent";
import {
  agentTimeoutMs,
  callResearchTool,
  configuredLimit,
  RESEARCH_TOOL_NAMES,
  researchReadSourceUrls,
  researchSourceUrls,
  researchTools
} from "./research-tools";
import { canonicalizeUrl } from "./url";

const temps: string[] = [];
const schemas = RESEARCH_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  function: { name, parameters: { type: "object" } }
}));
const localUrl = "raven-local://interview-A_2026";
beforeEach(() => {
  for (const key of [
    "FORECAST_AGENT_TIMEOUT_MS",
    "FORECAST_RESEARCH_TIMEOUT_MS",
    "FORECAST_MAX_MODEL_TURNS",
    "FORECAST_MAX_TOOL_CALLS",
    "FORECAST_ALLOWED_TOOLS"
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
  vi.stubEnv("DEEPSEEK_API_KEY", "test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});

function gateway(source: string): void {
  const dir = mkdtempSync(join(tmpdir(), "research-limits-"));
  temps.push(dir);
  const path = join(dir, "gateway");
  writeFileSync(path, "#!/usr/bin/env node\n" + source);
  chmodSync(path, 0o700);
  vi.stubEnv("FORECAST_SIGNAL_DESK_COMMAND", path);
}

describe("progressive research boundaries", () => {
  it("loads discovery in the registry and keeps responses larger than 1 MB intact", async () => {
    gateway(
      `process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify(process.argv[2]==='research-tools'?${JSON.stringify(schemas)}:{text:'证'.repeat(1100000),source_urls:['${localUrl}']})));`
    );
    expect((await researchTools()).map((t) => t.function.name)).toContain("research_sources");
    const result = await callResearchTool("fetch_page", { url: localUrl });
    expect((result.text as string).length).toBe(1100000);
    expect(researchSourceUrls(result)).toEqual([localUrl]);
  });

  it("keeps local discovery separate from reading and never accepts file paths or signed URLs as reads", () => {
    const rejected = [
      "file:///etc/passwd",
      "raven-local://../secret",
      "raven-local://id?token=x",
      "raven-local://user@id",
      "raven-local://id/path"
    ];
    const data = {
      status: "ok",
      access: "body_verified",
      text: "Interview statement",
      source_urls: [localUrl, ...rejected]
    };
    expect(researchSourceUrls(data)).toEqual([localUrl]);
    expect(researchReadSourceUrls("research_sources", data)).toEqual([]);
    expect(researchReadSourceUrls("web_search", data)).toEqual([]);
    expect(researchReadSourceUrls("fetch_page", data)).toEqual([localUrl]);
    expect(
      researchReadSourceUrls("fetch_page", { ...data, source_urls: ["https://example.com/doc?signature=secret"] })
    ).toEqual([]);
    expect(researchReadSourceUrls("fetch_page", { ...data, error: "denied" })).toEqual([]);
    expect(canonicalizeUrl(localUrl)).toBe(localUrl);
    expect(canonicalizeUrl(localUrl)).not.toBe(canonicalizeUrl("https://interview-A_2026"));
  });

  it("captures correlated Claude local reads without counting discovery as a search", () => {
    const rows = [
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "d", name: "mcp__raven_research__research_sources", input: {} }] }
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "d",
              content: [{ type: "text", text: JSON.stringify({ source_urls: [] }) }]
            }
          ]
        }
      },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "r", name: "mcp__raven_research__fetch_page", input: { url: localUrl } }]
        }
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "r",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "ok",
                    access: "body_verified",
                    text: "interview",
                    source_urls: [localUrl]
                  })
                }
              ]
            }
          ]
        }
      }
    ];
    const parsed = parseStreamJson(rows.map((row) => JSON.stringify(row)).join("\n"));
    expect(parsed.searchQueries).toEqual([]);
    expect([...parsed.searchResultUrls]).toEqual([localUrl]);
    expect(parsed.readSourceUrls).toEqual([localUrl]);
  });

  it("uses no research timeout by default and honors explicit limits with visible failure", async () => {
    expect(agentTimeoutMs()).toBe(0);
    vi.stubEnv("FORECAST_SIGNAL_DESK", "0");
    expect(agentTimeoutMs()).toBe(360000);
    vi.stubEnv("FORECAST_AGENT_TIMEOUT_MS", "1234");
    expect(agentTimeoutMs()).toBe(1234);
    expect(agentTimeoutMs(0)).toBe(0);
    vi.stubEnv("FORECAST_RESEARCH_TIMEOUT_MS", "50");
    gateway("setTimeout(()=>{},10000);");
    await expect(callResearchTool("research_sources", {})).rejects.toThrow("timed out after 50ms");
    vi.stubEnv("FORECAST_MAX_TOOL_CALLS", "bad");
    expect(() => configuredLimit("FORECAST_MAX_TOOL_CALLS", 0)).toThrow("non-negative integer");
  });
});

describe("research provider budgets", () => {
  it("continues beyond eight model turns and fourteen tools, retaining discovery and local reads", async () => {
    const requests: any[] = [];
    const fetchFn = vi.fn(async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      const turn = requests.length;
      const message =
        turn <= 16
          ? {
              tool_calls: [
                {
                  id: String(turn),
                  function: {
                    name: turn === 1 ? "research_sources" : "fetch_page",
                    arguments: JSON.stringify(turn === 1 ? {} : { url: localUrl })
                  }
                }
              ]
            }
          : { content: '{"answer":"complete"}' };
      return new Response(JSON.stringify({ choices: [{ message }] }));
    }) as typeof fetch;
    const researchCall = vi.fn(async (_name: string, _args: Record<string, unknown>, _timeout?: number) => ({
      status: "ok",
      access: "body_verified",
      text: "interview",
      source_urls: [localUrl]
    }));
    const result = await runDeepSeekRaw("Research", {}, { fetchFn, researchCall, researchSchemas: schemas });
    expect(researchCall).toHaveBeenCalledTimes(16);
    expect(result.numTurns).toBe(17);
    expect(result.readSourceUrls).toEqual([localUrl]);
    expect(requests[0]).not.toHaveProperty("max_tokens");
    expect(requests[0].tools.map((t: any) => t.function.name)).toContain("research_sources");
    expect(researchCall.mock.calls.every((call) => call[2] === 0)).toBe(true);
  });

  it("enforces explicitly configured tool caps even within a batch", async () => {
    vi.stubEnv("FORECAST_MAX_TOOL_CALLS", "2");
    const requests: any[] = [];
    const fetchFn = vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message:
                requests.length === 1
                  ? {
                      tool_calls: [1, 2, 3].map((i) => ({
                        id: String(i),
                        function: { name: "research_sources", arguments: "{}" }
                      }))
                    }
                  : { content: '{"answer":"limited"}' }
            }
          ]
        })
      );
    }) as typeof fetch;
    const researchCall = vi.fn(async () => ({ source_urls: [] }));
    await runDeepSeekRaw("Research", {}, { fetchFn, researchCall, researchSchemas: schemas });
    expect(researchCall).toHaveBeenCalledTimes(2);
    expect(requests[1]).not.toHaveProperty("tools");
    expect(requests[1].messages.at(-1).content).toContain("configured tool-call limit 2 reached");
  });
});

it("honors an explicit model-turn cap without an extra repair call", async () => {
  vi.stubEnv("FORECAST_MAX_MODEL_TURNS", "1");
  const fetchFn = vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content: "not JSON" } }] }))
  ) as typeof fetch;
  await expect(
    runDeepSeekRaw("Research", {}, { fetchFn, researchSchemas: schemas, researchCall: async () => ({}) })
  ).rejects.toThrow("model-turn limit 1 reached");
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
