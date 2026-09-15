import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractToolUrls, parseStreamJson, runAgentRaw } from "./claude-agent";
import { runDeepSeekRaw } from "./deepseek-agent";
import {
  callResearchTool,
  RESEARCH_MCP_PREFIX,
  RESEARCH_TOOL_NAMES,
  researchClaudeArgs,
  researchSourceUrls,
  researchReadSourceUrls,
  researchToolReading,
  researchToolNames,
  researchTools,
  signalDeskEnabled
} from "./research-tools";

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temps.splice(0)) rmSync(path, { recursive: true, force: true });
});
const schemas = RESEARCH_TOOL_NAMES.map((name) => ({
  type: "function" as const,
  function: { name, parameters: { type: "object" } }
}));
const url = "https://geoscopeapp.com/api/v1/member/publishers/SemiAnalysis/articles/meta/markdown";
const wire = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n");
const use = (name: string, id = "one", input = {}) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name: RESEARCH_MCP_PREFIX + name, input }] }
});
const result = (data: unknown, id = "one", is_error = false) => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, is_error, content: [{ type: "text", text: JSON.stringify(data) }] }
    ]
  }
});

describe("personal research boundary", () => {
  it("preserves Chinese quotes split across subprocess byte chunks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "research utf8 "));
    temps.push(dir);
    const expected = "资本开支原文：前后口径一致。";
    const emitter = (payload: unknown) =>
      '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>{const b=Buffer.from(' +
      JSON.stringify(JSON.stringify(payload)) +
      '+"\\n");let i=0;const t=setInterval(()=>{if(i<b.length){process.stdout.write(b.subarray(i,i+1));i++;}else clearInterval(t)},1)});';
    const gatewayFile = join(dir, "gateway");
    writeFileSync(gatewayFile, emitter({ text: expected }));
    chmodSync(gatewayFile, 0o700);
    vi.stubEnv("FORECAST_SIGNAL_DESK_COMMAND", gatewayFile);
    expect((await callResearchTool("signal_desk_read", { article_id: "x" })).text).toBe(expected);
    const claudeFile = join(dir, "claude");
    writeFileSync(claudeFile, emitter({ type: "result", result: JSON.stringify({ answer: expected }) }));
    chmodSync(claudeFile, 0o700);
    vi.stubEnv("PATH", dir + ":" + process.env.PATH);
    vi.stubEnv("FORECAST_SIGNAL_DESK", "0");
    const out = await runAgentRaw("fixture", { cwd: dir, allowedTools: "", timeoutMs: 3000 });
    expect(out.jsonObject).toEqual({ answer: expected });
  });
  it("is opt-in and removes builtin search when the gateway is active", () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "");
    vi.stubEnv("FORECAST_ALLOWED_TOOLS", undefined);
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
    expect(researchToolNames("WebSearch")).toEqual(["research_sources", "web_search", "signal_desk_search"]);
    expect(researchToolNames("WebFetch")).toEqual(["fetch_page", "signal_desk_read", "signal_desk_pdf", "research_images", "research_image"]);
    expect(args.at(-1)).toContain(RESEARCH_MCP_PREFIX + "research_image");
  });

  it("accepts the expanded gateway registry while respecting existing explicit tool filters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "research image registry "));
    temps.push(dir);
    const command = join(dir, "gateway");
    writeFileSync(command, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(' + JSON.stringify(JSON.stringify(schemas)) + '));');
    chmodSync(command, 0o700);
    vi.stubEnv("FORECAST_SIGNAL_DESK_COMMAND", command);
    expect((await researchTools()).map(t => t.function.name)).toEqual(RESEARCH_TOOL_NAMES);
    expect((await researchTools("WebSearch")).map(t => t.function.name)).toEqual(["research_sources", "web_search", "signal_desk_search"]);
    expect((await researchTools("signal_desk_read")).map(t => t.function.name)).toEqual(["signal_desk_read"]);
    expect(await researchTools("")).toEqual([]);
  });

  it("accepts only successful, correlated MCP provenance, never input URLs or embedded links", () => {
    const stream = wire([
      use("fetch_page", "failed", { url: "https://not-read.example" }),
      result({ error: "403", source_urls: ["https://not-read.example"] }, "failed"),
      result({ source_urls: ["https://unsolicited.example"] }, "unknown"),
      use("web_search", "search", { query: "Meta capex" }),
      result({ source_urls: [url], text: "https://embedded.example", results: [] }, "search"),
      use("signal_desk_read", "read"),
      result({ source_urls: [url], text: "body" }, "read"),
      { type: "result", result: '{"ok":true}' }
    ]);
    expect([...extractToolUrls(stream)]).toEqual([url]);
    expect(parseStreamJson(stream).searchQueries).toEqual(["Meta capex"]);
    expect(parseStreamJson(stream).usage?.webFetchRequests).toBe(2);
    expect(researchSourceUrls({ error: "failure", source_urls: [url] })).toEqual([]);
    expect(researchSourceUrls({ text: JSON.stringify({ source_urls: [url] }) })).toEqual([]);
  });

  it("runs JSON subprocesses without shell expansion and surfaces protocol failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "research gateway "));
    temps.push(dir);
    const command = join(dir, "gateway");
    writeFileSync(
      command,
      '#!/usr/bin/env node\nlet b="";process.stdin.on("data",d=>b+=d);process.stdin.on("end",()=>console.log(JSON.stringify({echo:JSON.parse(b),source_urls:[]})));'
    );
    chmodSync(command, 0o700);
    vi.stubEnv("FORECAST_SIGNAL_DESK_COMMAND", command);
    const value = await callResearchTool("web_search", { query: "Meta $(not-a-command) `literal`" });
    expect((value.echo as { arguments: { query: string } }).arguments.query).toContain("$(not-a-command)");
    writeFileSync(command, '#!/usr/bin/env node\nprocess.stdout.write("invalid");');
    await expect(callResearchTool("web_search", {})).rejects.toThrow("invalid JSON");
    writeFileSync(command, "#!/usr/bin/env node\nsetTimeout(()=>{},10000);");
    await expect(callResearchTool("web_search", {}, 50)).rejects.toThrow("timed out");
  });
});

describe("OpenAI-compatible research tool loop", () => {
  it("strips image bytes, reports unavailable visual review and refuses text-only observation writes", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    const requests: any[] = [];
    const imageArgs = { image_id: "figure-1", question: "Did capex fall?", importance_reason: "The chart compares actual annual capex." };
    const fetchFn = vi.fn(async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const args = requests.length === 1 ? imageArgs : { ...imageArgs, observation: { key_observations: ["Fabricated visual claim"] } };
      return new Response(JSON.stringify({ choices: [{ message: requests.length < 3
        ? { content: null, tool_calls: [{ id: String(requests.length), type: "function", function: { name: "research_image", arguments: JSON.stringify(args) } }] }
        : { content: '{"answer":"Visual review unavailable"}' } }] }));
    }) as typeof fetch;
    const researchCall = vi.fn(async () => ({ status: "ok", image_id: "figure-1", access: "image_retrieved",
      source_urls: [url], sha256: "image-hash", text: "Caption only", _image_content: { type: "image", mimeType: "image/png", data: "PRIVATE_IMAGE_BYTES" } }));
    const out = await runDeepSeekRaw("Read material figures", {}, { fetchFn, researchCall, researchSchemas: schemas });
    const firstResult = JSON.parse(requests[1].messages.find((m: any) => m.role === "tool").content);
    expect(firstResult).toMatchObject({ access: "image_retrieved", visual_review_status: "visual_review_unavailable", visual_review_unavailable: true });
    expect(firstResult.visual_review_warning).toContain("vision-capable");
    expect(JSON.stringify(requests)).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(JSON.stringify(requests)).not.toContain("_image_content");
    expect(JSON.stringify(out)).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(researchCall).toHaveBeenCalledTimes(1);
    expect(out.readSourceUrls).toEqual([]);
    expect(out.researchReadings).toEqual([]);
    expect(out.retrievalAttempts?.map(a => a.outcome)).toEqual(["results", "failed"]);
    expect(out.retrievalAttempts?.every(a => !a.readKey)).toBe(true);
  });

  it("keeps native MCP image retrieval separate from article text-reading provenance", () => {
    const metadata = { status: "ok", image_id: "figure-1", access: "image_retrieved", source_urls: [url], text: "A chart caption" };
    const stream = wire([
      use("research_image", "figure", { image_id: "figure-1", importance_reason: "Tests the capex claim" }),
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "figure", content: [
        { type: "text", text: JSON.stringify(metadata) },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "PRIVATE_IMAGE_BYTES" } }
      ] }] } },
      { type: "result", result: '{"answer":"done"}' }
    ]);
    const parsed = parseStreamJson(stream);
    expect([...parsed.searchResultUrls]).toEqual([url]);
    expect(parsed.readSourceUrls).toEqual([]);
    expect(parsed.researchReadings).toEqual([]);
    expect(parsed.retrievalAttempts[0]).toMatchObject({ tool: "research_image", outcome: "results" });
    expect(parsed.retrievalAttempts[0].readKey).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(parsed.usage?.webFetchRequests).toBe(1);
  });

  it("sends all research schemas, executes search/read, keeps complete JSON and records genuine source URLs", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    let calls = 0;
    const requests: any[] = [];
    const fetchFn = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      calls++;
      const message =
        calls <= 2
          ? {
              content: null,
              tool_calls: [
                {
                  id: String(calls),
                  type: "function",
                  function: {
                    name: calls === 1 ? "web_search" : "signal_desk_read",
                    arguments:
                      calls === 1 ? '{"query":"Meta capex","research_keywords":["Meta","capex"]}' : '{"article_id":"a"}'
                  }
                }
              ]
            }
          : { content: JSON.stringify({ new_evidence: [{ source_url: url }] }) };
      return new Response(JSON.stringify({ choices: [{ message }] }));
    }) as typeof fetch;
    const researchCall = vi.fn(async (name) =>
      name === "web_search"
        ? {
            results: [{ url, source_provider: "signal_desk" }],
            sources: { signal_desk: { status: "ok" } },
            source_urls: [url]
          }
        : { status: "ok", text: "e".repeat(12000), access: "body_verified", source_urls: [url], next_offset: 12000 }
    );
    const out = await runDeepSeekRaw("Research Meta", {}, { fetchFn, researchCall, researchSchemas: schemas });
    expect(requests[0].tools).toHaveLength(RESEARCH_TOOL_NAMES.length);
    expect(requests[0].messages[0].content).toContain("coverage");
    const toolMessage = requests[2].messages.filter((m: any) => m.role === "tool").at(-1);
    expect(JSON.parse(toolMessage.content).text).toHaveLength(12000);
    expect(JSON.parse(toolMessage.content).next_offset).toBe(12000);
    expect([...out.searchResultUrls]).toEqual([url]);
    expect(out.searchQueries).toEqual(["Meta capex"]);
    expect(out.readSourceUrls).toEqual([url]);
    expect(researchCall).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("does not turn a failed private read into a successful citation through a liveness probe", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    let calls = 0;
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  ++calls === 1
                    ? {
                        tool_calls: [{ id: "x", function: { name: "fetch_page", arguments: JSON.stringify({ url }) } }]
                      }
                    : { content: JSON.stringify({ new_evidence: [{ source_url: url }] }) }
              }
            ]
          })
        )
    ) as typeof fetch;
    const out = await runDeepSeekRaw(
      "Research",
      {},
      { fetchFn, researchSchemas: schemas, researchCall: async () => ({ error: "permission denied", source_urls: [] }) }
    );
    expect(out.searchResultUrls.size).toBe(0);
    expect(out.readSourceUrls).toEqual([]);
    expect(out.researchReadings).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

const verifiedRead = (sourceUrl = url, extra: Record<string, unknown> = {}) => ({
  status: "ok",
  access: "body_verified",
  text: "Original article text, with a short auditable quote.",
  article_id: "article",
  url: sourceUrl,
  sha256: "actual-content-hash",
  content_kind: "article",
  source_urls: [sourceUrl],
  offset: 4000,
  next_offset: 10000,
  total_chars: 24000,
  ...extra
});
const pdfUrl = "https://geoscopeapp.com/api/v1/member/publishers/Foreign%20Research/articles/report/pdf";
const verifiedPdf = () =>
  verifiedRead(pdfUrl, {
    content_kind: "pdf",
    start_page: 4,
    next_page: 7,
    total_pages: 12,
    pages: [{ page: 4, text_chars: 1300, truncated: true }],
    path: "/private/report.pdf",
    signed_url: "https://bucket.example/report?token=secret"
  });

describe("strict successfully-read provenance", () => {
  it("preserves partial PDF reading without upgrading it to complete extraction", () => {
    const partial = { ...verifiedPdf(), status: "partial", access: "body_partial" };
    expect(researchReadSourceUrls("signal_desk_pdf", partial)).toEqual([pdfUrl]);
    expect(researchToolReading("signal_desk_pdf", partial)).toMatchObject({
      access: "body_partial",
      pages: [{ page: 4, text_chars: 1300, truncated: true }]
    });
    expect(researchReadSourceUrls("signal_desk_pdf", { ...partial, access: "body_verified" })).toEqual([]);
  });
  it.each(["fetch_page", "signal_desk_read", "signal_desk_pdf"])(
    "accepts %s only with an actual readable response",
    (name) => {
      const data = name === "signal_desk_pdf" ? verifiedPdf() : verifiedRead();
      expect(researchReadSourceUrls(name, data)).toEqual(data.source_urls);
      expect(
        researchReadSourceUrls(name, { ...data, source_urls: [...data.source_urls, ...data.source_urls] })
      ).toEqual(data.source_urls);
    }
  );

  it.each([
    ["web_search", verifiedRead()],
    ["signal_desk_search", verifiedRead()],
    ["fetch_page", verifiedRead(url, { status: "error" })],
    ["fetch_page", verifiedRead(url, { status: undefined })],
    ["fetch_page", verifiedRead(url, { error: "access denied" })],
    ["signal_desk_read", verifiedRead(url, { access: "search_candidate" })],
    ["signal_desk_read", verifiedRead(url, { text: " \n " })],
    ["signal_desk_read", verifiedRead(url, { source_urls: undefined, nested: { source_urls: [url] } })],
    ["signal_desk_pdf", verifiedRead(pdfUrl, { access: "summary_verified", content_kind: "pdf" })],
    ["signal_desk_pdf", verifiedRead(pdfUrl, { content_kind: "summary" })],
    ["fetch_page", verifiedRead("https://example.org/report?X-Amz-Signature=secret")],
    ["fetch_page", verifiedRead("https://example.org/report?access_token=secret")],
    ["fetch_page", verifiedRead("https://user:secret@example.org/report")]
  ])("rejects discovery, failure or credential-bearing read #%#", (name, data) => {
    expect(researchReadSourceUrls(name as string, data)).toEqual([]);
    expect(researchToolReading(name as string, data)).toBeNull();
  });

  it("keeps real PDF page evidence and Markdown offsets while omitting paths, tool inputs and credentials", () => {
    const pdf = researchToolReading("signal_desk_pdf", {
      ...verifiedPdf(),
      arguments: { api_key: "never-keep" },
      headers: { Authorization: "never-keep" }
    });
    expect(pdf).toMatchObject({
      tool: "signal_desk_pdf",
      url: pdfUrl,
      content_kind: "pdf",
      start_page: 4,
      next_page: 7,
      total_pages: 12,
      pages: [{ page: 4, text_chars: 1300, truncated: true }]
    });
    expect(JSON.stringify(pdf)).not.toMatch(/private|signed_url|token=|Authorization|never-keep/);
    const md = researchToolReading(
      "signal_desk_read",
      verifiedRead(url, { access: "summary_verified", content_kind: "summary" })
    );
    expect(md).toMatchObject({
      offset: 4000,
      next_offset: 10000,
      total_chars: 24000,
      access: "summary_verified",
      content_kind: "summary"
    });
    expect(researchToolReading("signal_desk_pdf", { ...verifiedPdf(), pages: [] })).toBeNull();
    expect(researchToolReading("signal_desk_read", verifiedRead(url, { sha256: "" }))).toBeNull();
    expect(
      researchToolReading("signal_desk_read", verifiedRead(url, { url: "https://not-returned.example" }))
    ).toBeNull();
  });

  it("correlates Claude reads by tool identity and ignores failed, unrequested, searched or nested URL claims", () => {
    const publicUrl = "https://issuer.example/filing";
    const stream = wire([
      use("web_search", "search"),
      result(verifiedRead("https://discovery.example"), "search"),
      use("fetch_page", "input-only", { url: "https://not-read.example" }),
      result(verifiedRead("https://unsolicited.example"), "unknown"),
      use("fetch_page", "failed"),
      result(verifiedRead("https://failed.example"), "failed", true),
      use("signal_desk_read", "read"),
      result(verifiedRead(), "read"),
      result(verifiedRead(), "read"),
      use("signal_desk_pdf", "pdf"),
      result(verifiedPdf(), "pdf"),
      use("fetch_page", "public"),
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "public", structuredContent: verifiedRead(publicUrl) }]
        }
      },
      use("signal_desk_read", "nested"),
      result(
        {
          nested: { source_urls: ["https://nested.example"] },
          text: JSON.stringify(verifiedRead("https://embedded.example"))
        },
        "nested"
      ),
      { type: "result", result: '{"answer":"done"}' }
    ]);
    const parsed = parseStreamJson(stream);
    expect(parsed.readSourceUrls).toEqual([url, pdfUrl, publicUrl]);
    expect(parsed.researchReadings).toHaveLength(2);
    expect(parsed.researchReadings.map((r) => r.tool)).toEqual(["signal_desk_read", "signal_desk_pdf"]);
    expect(JSON.parse(JSON.stringify(parsed)).readSourceUrls).toEqual([url, pdfUrl, publicUrl]);
  });

  it("returns the strict read trace from the actual Claude subprocess adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "read provenance "));
    temps.push(dir);
    const stream = wire([
      use("signal_desk_read", "read"),
      result(verifiedRead(), "read"),
      { type: "result", result: '{"answer":"done"}' }
    ]);
    const command = join(dir, "claude");
    writeFileSync(
      command,
      '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write(' +
        JSON.stringify(stream) +
        "));"
    );
    chmodSync(command, 0o700);
    vi.stubEnv("PATH", dir + ":" + process.env.PATH);
    vi.stubEnv("FORECAST_SIGNAL_DESK", "0");
    const out = await runAgentRaw("fixture", { cwd: dir, allowedTools: "", timeoutMs: 3000 });
    expect(out.readSourceUrls).toEqual([url]);
    expect(out.researchReadings?.[0]).toMatchObject({ url, offset: 4000, sha256: "actual-content-hash" });
  });

  it("accumulates only actual DeepSeek tool reads, separately from search discovery", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
    vi.stubEnv("DEEPSEEK_API_KEY", "test");
    const specs = [
      { name: "web_search", args: { query: "research" }, data: verifiedRead("https://search-only.example") },
      {
        name: "signal_desk_read",
        args: { article_id: "summary" },
        data: verifiedRead(url, { content_kind: "summary", access: "summary_verified" })
      },
      { name: "signal_desk_pdf", args: { article_id: "pdf" }, data: verifiedPdf() },
      {
        name: "fetch_page",
        args: { url: "https://issuer.example/filing" },
        data: verifiedRead("https://issuer.example/filing")
      },
      {
        name: "fetch_page",
        args: { url: "https://denied.example" },
        data: verifiedRead("https://denied.example", { status: "error", error: "403" })
      }
    ];
    let turn = 0,
      callIndex = 0;
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message:
                  ++turn === 1
                    ? {
                        tool_calls: specs.map((spec, i) => ({
                          id: String(i),
                          type: "function",
                          function: { name: spec.name, arguments: JSON.stringify(spec.args) }
                        }))
                      }
                    : { content: '{"answer":"done"}' }
              }
            ]
          })
        )
    ) as typeof fetch;
    const researchCall = vi.fn(async () => specs[callIndex++].data);
    const out = await runDeepSeekRaw("Research", {}, { fetchFn, researchCall, researchSchemas: schemas });
    expect(out.searchResultUrls.has("https://search-only.example")).toBe(true);
    expect(out.readSourceUrls).toEqual([url, pdfUrl, "https://issuer.example/filing"]);
    expect(out.researchReadings?.map((r) => r.tool)).toEqual(["signal_desk_read", "signal_desk_pdf"]);
    expect(out.researchReadings?.[0].access).toBe("summary_verified");
    expect(JSON.stringify(out.researchReadings)).not.toContain("/private/");
  });
});
