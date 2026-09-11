import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractToolUrls, parseStreamJson } from "./claude-agent";
import { runDeepSeekRaw } from "./deepseek-agent";
import { callResearchTool, RESEARCH_MCP_PREFIX, RESEARCH_TOOL_NAMES, researchClaudeArgs, researchSourceUrls, researchToolNames, signalDeskEnabled } from "./research-tools";

const temps: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true }); });
const schemas = RESEARCH_TOOL_NAMES.map(name => ({ type: "function" as const, function: { name, parameters: { type: "object" } } }));
const url = "https://geoscopeapp.com/api/v1/member/publishers/SemiAnalysis/articles/meta/markdown";
const wire = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n");
const use = (name: string, id = "one", input = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name: RESEARCH_MCP_PREFIX + name, input }] } });
const result = (data: unknown, id = "one", is_error = false) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content: [{ type: "text", text: JSON.stringify(data) }] }] } });

describe("personal research boundary", () => {
  it("is opt-in and removes builtin search when the gateway is active", () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", ""); vi.stubEnv("FORECAST_ALLOWED_TOOLS", undefined);
    expect(signalDeskEnabled()).toBe(false);
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
    expect(signalDeskEnabled()).toBe(true);
    const args = researchClaudeArgs();
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args.at(-1)).toContain(RESEARCH_MCP_PREFIX + "web_search");
    expect(researchToolNames("")).toEqual([]);
    const noTools = researchClaudeArgs("");
    expect(JSON.parse(noTools[noTools.indexOf("--mcp-config") + 1]).mcpServers).toEqual({});
    expect(researchToolNames("WebSearch")).toEqual(["web_search", "signal_desk_search"]);
  });

  it("accepts only successful, correlated MCP provenance, never input URLs or embedded links", () => {
    const stream = wire([
      use("fetch_page", "failed", { url: "https://not-read.example" }),
      result({ error: "403", source_urls: ["https://not-read.example"] }, "failed"),
      result({ source_urls: ["https://unsolicited.example"] }, "unknown"),
      use("web_search", "search", { query: "Meta capex" }),
      result({ source_urls: [url], text: "https://embedded.example", results: [] }, "search"),
      use("signal_desk_read", "read"), result({ source_urls: [url], text: "body" }, "read"),
      { type: "result", result: '{"ok":true}' }
    ]);
    expect([...extractToolUrls(stream)]).toEqual([url]);
    expect(parseStreamJson(stream).searchQueries).toEqual(["Meta capex"]);
    expect(parseStreamJson(stream).usage?.webFetchRequests).toBe(2);
    expect(researchSourceUrls({ error: "failure", source_urls: [url] })).toEqual([]);
    expect(researchSourceUrls({ text: JSON.stringify({ source_urls: [url] }) })).toEqual([]);
  });

  it("runs JSON subprocesses without shell expansion and surfaces protocol failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "research gateway ")); temps.push(dir);
    const command = join(dir, "gateway");
    writeFileSync(command, '#!/usr/bin/env node\nlet b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>console.log(JSON.stringify({echo:JSON.parse(b),source_urls:[]})));');
    chmodSync(command, 0o700); vi.stubEnv("FORECAST_SIGNAL_DESK_COMMAND", command);
    const value = await callResearchTool("web_search", { query: "Meta $(not-a-command) `literal`" });
    expect((value.echo as { arguments: { query: string } }).arguments.query).toContain("$(not-a-command)");
    writeFileSync(command, '#!/usr/bin/env node\nprocess.stdout.write("invalid");');
    await expect(callResearchTool("web_search", {})).rejects.toThrow("invalid JSON");
    writeFileSync(command, '#!/usr/bin/env node\nsetTimeout(()=>{},10000);');
    await expect(callResearchTool("web_search", {}, 50)).rejects.toThrow("timed out");
  });
});

describe("OpenAI-compatible research tool loop", () => {
  it("sends all five schemas, executes search/read, keeps complete JSON and records genuine source URLs", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1"); vi.stubEnv("DEEPSEEK_API_KEY", "test");
    let calls = 0;
    const requests: any[] = [];
    const fetchFn = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body); calls++;
      const message = calls <= 2 ? { content: null, tool_calls: [{ id: String(calls), type: "function", function: {
        name: calls === 1 ? "web_search" : "signal_desk_read", arguments: calls === 1 ? '{"query":"Meta capex","research_keywords":["Meta","capex"]}' : '{"article_id":"a"}'
      } }] } : { content: JSON.stringify({ new_evidence: [{ source_url: url }] }) };
      return new Response(JSON.stringify({ choices: [{ message }] }));
    }) as typeof fetch;
    const researchCall = vi.fn(async name => name === "web_search"
      ? { results: [{ url, source_provider: "signal_desk" }], sources: { signal_desk: { status: "ok" } }, source_urls: [url] }
      : { text: "e".repeat(12000), access: "body_verified", source_urls: [url], next_offset: 12000 });
    const out = await runDeepSeekRaw("Research Meta", {}, { fetchFn, researchCall, researchSchemas: schemas });
    expect(requests[0].tools).toHaveLength(5);
    expect(requests[0].messages[0].content).toContain("coverage");
    const toolMessage = requests[2].messages.filter((m: any) => m.role === "tool").at(-1);
    expect(JSON.parse(toolMessage.content).text).toHaveLength(12000);
    expect(JSON.parse(toolMessage.content).next_offset).toBe(12000);
    expect([...out.searchResultUrls]).toEqual([url]);
    expect(out.searchQueries).toEqual(["Meta capex"]);
    expect(researchCall).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not turn a failed private read into a successful citation through a liveness probe", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1"); vi.stubEnv("DEEPSEEK_API_KEY", "test");
    let calls = 0;
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: ++calls === 1
      ? { tool_calls: [{ id: "x", function: { name: "fetch_page", arguments: JSON.stringify({ url }) } }] }
      : { content: JSON.stringify({ new_evidence: [{ source_url: url }] }) } }] }))) as typeof fetch;
    const out = await runDeepSeekRaw("Research", {}, { fetchFn, researchSchemas: schemas,
      researchCall: async () => ({ error: "permission denied", source_urls: [] }) });
    expect(out.searchResultUrls.size).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
