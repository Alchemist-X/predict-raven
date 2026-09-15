// DeepSeek provider — OpenAI-compatible chat completion, with OPTIONAL web
// search via function calling (FORECAST_WEB_SEARCH=1|exa|tavily).
//
// Default (search off): one HTTP POST per round, structured JSON via
// json_object mode, no tool trace — the fabrication guard degrades to a
// CITATION LIVENESS check (see verifyCitedUrls): a cited URL counts as
// "verified" unless it provably does not exist — a strictly weaker guarantee
// than a search-trace membership check.
//
// Search on: the model gets web_search/fetch_page tools (standard OpenAI
// function calling — works for DeepSeek AND Kimi/Moonshot through the same
// adapter); the tool loop records a REAL search trace, so citations are
// verified by trace membership exactly like the claude provider (with the
// liveness check as fallback only when the model never touched the tools).
//
// The endpoint is configured purely by env (DEEPSEEK_BASE_URL / API key), so no
// secret is committed here.

import { extractJsonObject } from "./claude-agent";
import type { AgentRunResult, RunAgentOptions } from "./claude-agent";
import { fetchPageText, webSearch } from "./web-search";
import {
  agentTimeoutMs,
  configuredLimit,
  callResearchTool,
  RESEARCH_POLICY,
  researchSourceUrls,
  researchReadSourceUrls,
  researchToolReading,
  researchRetrievalAttempt,
  type ResearchToolReading,
  researchTools,
  signalDeskEnabled,
  type ResearchToolSchema
} from "./research-tools";

export function webSearchEnabled(): boolean {
  const v = (process.env.FORECAST_WEB_SEARCH ?? "").trim().toLowerCase();
  // "duckduckgo" still *enables* search even though the backend was removed
  // (2026-08-22): enabling makes backendName() throw loudly at tool time,
  // which beats silently downgrading a configured run to no-research mode.
  return signalDeskEnabled() || v === "1" || v === "true" || v === "exa" || v === "duckduckgo" || v === "tavily";
}

export interface DeepSeekDeps {
  fetchFn?: typeof fetch; // injectable for tests
  researchCall?: typeof callResearchTool;
  researchSchemas?: ResearchToolSchema[];
}

// Deep-scan the agent's structured output for every cited URL (claim sources,
// legacy source_url fields, and reflection justifiers) so their liveness can be checked.
export function collectCitedUrls(jsonObject: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const key of ["url", "source_url", "new_source_url"]) {
      const v = rec[key];
      if (typeof v === "string" && v.trim() && !seen.has(v)) {
        seen.add(v);
        urls.push(v);
      }
    }
    for (const v of Object.values(rec)) walk(v);
  };
  walk(jsonObject);
  return urls;
}

const VERIFY_TIMEOUT_MS = 8_000; // per-URL budget
const VERIFY_CONCURRENCY = 6;
const VERIFY_MAX_URLS = 24; // cap the probe fan-out per round

// Only these statuses prove a citation is DEAD. Anti-bot refusals (401/403/
// 405/429) and origin hiccups (5xx) come from real, existing pages — major
// outlets (WSJ, Reuters, Bloomberg) refuse HEAD/GET from scripts, and treating
// them as fabrications would soft-clamp exactly the highest-quality citations.
// A fabricated path on a real domain overwhelmingly returns 404/410.
const DEAD_STATUSES = new Set([404, 410]);

// CITATION LIVENESS check standing in for the search trace: a cited URL counts
// as "verified" unless it demonstrably does not exist (DEAD_STATUSES) or the
// host is unreachable (network error / timeout on both probes). Method: HEAD
// first; on a dead status or a thrown probe, one GET attempt (aborted right
// after headers — the body is never downloaded). NOTE this only proves the
// citation resolves to a live page, NOT that the model actually read it; the
// engine's unverified soft-clamp still applies to anything that fails.
export async function verifyCitedUrls(urls: string[], fetchFn: typeof fetch = fetch): Promise<Set<string>> {
  const unique = [...new Set(urls)].slice(0, VERIFY_MAX_URLS);
  const verified = new Set<string>();

  const probe = async (url: string, method: "HEAD" | "GET"): Promise<number> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { method, redirect: "follow", signal: controller.signal });
      if (method === "GET") controller.abort(); // headers are enough; do not download the body
      return res.status;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const check = async (url: string): Promise<void> => {
    try {
      if (!DEAD_STATUSES.has(await probe(url, "HEAD"))) {
        verified.add(url);
        return;
      }
    } catch {
      /* HEAD failed outright — fall through to the GET attempt */
    }
    // HEAD said dead (some servers 404 HEAD but serve GET) or errored — one GET attempt.
    try {
      if (!DEAD_STATUSES.has(await probe(url, "GET"))) verified.add(url);
    } catch {
      /* unreachable — leave it out of the set */
    }
  };

  // Bounded concurrency: a shared cursor over the deduped list.
  let next = 0;
  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, unique.length) }, async () => {
    while (next < unique.length) {
      const url = unique[next++];
      if (url === undefined) break;
      await check(url);
    }
  });
  await Promise.all(workers);
  return verified;
}

// OpenAI function-calling tool definitions for the research loop.
const RESEARCH_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the live web for information beyond your training data. Returns up to 8 results " +
        "with title, url, snippet, and — when the backend supplies it — publishedDate and author. " +
        "Prefer a result's publishedDate over guessing how current a claim is.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "search query" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description: "Fetch a web page by URL and return its readable text (truncated).",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "absolute http(s) URL" } },
        required: ["url"]
      }
    }
  }
] as const;

// This adapter only sends text chat messages. Never turn image bytes into a
// text tool result or claim that image retrieval established visual review.
function textOnlyResearchResult(name: string, raw: Record<string, unknown>): Record<string, unknown> {
  const { _image_content: image, ...metadata } = raw;
  if (name !== "research_image" && image === undefined) return metadata;
  return {
    ...metadata,
    visual_review_status: "visual_review_unavailable",
    visual_review_unavailable: true,
    visual_review_warning:
      "This research route only sends text. The image was not delivered to the model for visual review. " +
      "Use a vision-capable route to inspect it; do not submit visual observations or claim that the figure was read. " +
      "Captions and OCR are not visual verification. Keep material unread figures as research gaps."
  };
}

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: Array<{ message?: ChatMessage }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function runDeepSeekRaw(
  prompt: string,
  opts: RunAgentOptions = {},
  deps: DeepSeekDeps = {}
): Promise<AgentRunResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required for the deepseek provider.");
  }
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = opts.model || process.env.FORECAST_DEEPSEEK_MODEL || "deepseek-chat";
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = agentTimeoutMs(opts.timeoutMs);

  if (webSearchEnabled() && opts.allowedTools !== "") {
    return runWithTools(prompt, {
      baseUrl,
      apiKey,
      model,
      fetchFn,
      timeoutMs,
      researchCall: deps.researchCall ?? callResearchTool,
      researchSchemas: signalDeskEnabled()
        ? (deps.researchSchemas ?? (await researchTools(opts.allowedTools)))
        : undefined
    });
  }

  // The timeout must cover the BODY read too, not just the response headers — a
  // drip-fed body would otherwise stall a round indefinitely. The abort signal
  // propagates into res.text()/res.json(), so the timer stays armed until the
  // body is fully consumed.
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        // json_object mode requires the word "json" in the prompt — every engine
        // prompt already demands a JSON object, so this is safe to always set.
        response_format: { type: "json_object" },
        ...(signalDeskEnabled() ? {} : { max_tokens: 6000 })
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`deepseek API error ${res.status}: ${body.slice(0, 300)}`);
    }
    data = (await res.json()) as typeof data;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`deepseek request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const rawFinalText = data.choices?.[0]?.message?.content ?? "";
  const jsonObject = rawFinalText ? extractJsonObject(rawFinalText) : null;
  const jsonError = !rawFinalText ? "empty completion" : jsonObject ? null : "no JSON object found in agent final text";

  // Cost is only computable when the operator supplies prices (per Mtok) via env.
  const priceIn = Number(process.env.DEEPSEEK_PRICE_IN_PER_MTOK);
  const priceOut = Number(process.env.DEEPSEEK_PRICE_OUT_PER_MTOK);
  const costUsd =
    Number.isFinite(priceIn) && Number.isFinite(priceOut) && data.usage
      ? ((data.usage.prompt_tokens ?? 0) * priceIn + (data.usage.completion_tokens ?? 0) * priceOut) / 1_000_000
      : null;

  // No search trace exists for this provider; the liveness-checked citation set
  // stands in so the engine's verified/unverified soft-clamp still functions.
  const searchResultUrls = await verifyCitedUrls(collectCitedUrls(jsonObject), deps.fetchFn);

  return {
    rawFinalText,
    jsonObject,
    jsonError,
    searchQueries: [], // provider has no search
    searchResultUrls,
    readSourceUrls: [],
    researchReadings: [],
    costUsd,
    numTurns: 1,
    exitCode: 0,
    stderrTail: ""
  };
}

interface ToolLoopCtx {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
  researchCall: typeof callResearchTool;
  researchSchemas?: ResearchToolSchema[];
}

// The research tool loop: standard OpenAI function calling against the same
// endpoint. The overall timeout is a shared budget across every model call in
// the loop. During tool turns response_format is OMITTED (json_object mode
// suppresses tool calls); if the final content fails to parse, one repair
// turn asks for the JSON alone.
async function runWithTools(prompt: string, ctx: ToolLoopCtx): Promise<AgentRunResult> {
  const deadline = ctx.timeoutMs > 0 ? Date.now() + ctx.timeoutMs : Infinity;
  const maxModelTurns = configuredLimit("FORECAST_MAX_MODEL_TURNS", ctx.researchSchemas ? 0 : 8);
  const maxToolCalls = configuredLimit("FORECAST_MAX_TOOL_CALLS", ctx.researchSchemas ? 0 : 14);
  let modelTurns = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  const call = async (messages: ChatMessage[], withTools: boolean, forceJson: boolean): Promise<ChatMessage> => {
    if (maxModelTurns > 0 && modelTurns >= maxModelTurns)
      throw new Error(`model-turn limit ${maxModelTurns} reached before a valid final answer`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`deepseek tool loop exhausted its ${ctx.timeoutMs}ms budget`);
    const controller = new AbortController();
    const timer = Number.isFinite(remaining) ? setTimeout(() => controller.abort(), remaining) : undefined;
    try {
      modelTurns += 1;
      const res = await ctx.fetchFn(`${ctx.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ctx.apiKey}` },
        body: JSON.stringify({
          model: ctx.model,
          messages,
          ...(withTools ? { tools: ctx.researchSchemas ?? RESEARCH_TOOLS } : {}),
          ...(forceJson ? { response_format: { type: "json_object" } } : {}),
          ...(signalDeskEnabled() ? {} : { max_tokens: 6000 })
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`deepseek API error ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as ChatResponse;
      promptTokens += data.usage?.prompt_tokens ?? 0;
      completionTokens += data.usage?.completion_tokens ?? 0;
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("deepseek returned no message");
      return msg;
    } catch (err) {
      if (controller.signal.aborted) throw new Error(`deepseek request timed out (shared ${ctx.timeoutMs}ms budget)`);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const messages: ChatMessage[] = [
    { role: "user", content: ctx.researchSchemas ? `${RESEARCH_POLICY}\n\n${prompt}` : prompt }
  ];
  const searchQueries: string[] = [];
  const traceUrls = new Set<string>();
  const readUrls = new Set<string>();
  const readings = new Map<string, ResearchToolReading>();
  const retrievalAttempts: import("./research-progress").RetrievalAttempt[] = [];
  let toolCalls = 0;
  let finalText = "";

  for (let turn = 0; maxModelTurns === 0 || turn < maxModelTurns; turn++) {
    const allowTools = maxToolCalls === 0 || toolCalls < maxToolCalls;
    const msg = await call(messages, allowTools, false);
    if (msg.tool_calls?.length && allowTools) {
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let resultText: string;
        try {
          if (maxToolCalls > 0 && toolCalls >= maxToolCalls)
            throw new Error(`configured tool-call limit ${maxToolCalls} reached`);
          toolCalls += 1;
          const args = JSON.parse(tc.function.arguments || "{}") as { query?: string; url?: string } & Record<
            string,
            unknown
          >;
          if (ctx.researchSchemas) {
            if (!ctx.researchSchemas.some((t) => t.function.name === tc.function.name))
              throw new Error("tool is not enabled");
            if (["web_search", "signal_desk_search"].includes(tc.function.name))
              searchQueries.push(String(args.query ?? args.keywords ?? ""));
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error("research tool budget exhausted");
            const gatewayTimeout = configuredLimit("FORECAST_RESEARCH_TIMEOUT_MS", 0);
            const budget = Math.min(gatewayTimeout || Infinity, remaining);
            if (tc.function.name === "research_image" && args.observation !== undefined)
              throw new Error("visual_review_unavailable: this text-only route cannot submit visual observations; use a vision-capable route");
            const result = textOnlyResearchResult(tc.function.name,
              await ctx.researchCall(tc.function.name, args, Number.isFinite(budget) ? budget : 0));
            retrievalAttempts.push(researchRetrievalAttempt(tc.function.name, args, result));
            for (const url of researchSourceUrls(result)) traceUrls.add(url);
            for (const url of researchReadSourceUrls(tc.function.name, result)) readUrls.add(url);
            const reading = researchToolReading(tc.function.name, result);
            if (reading) readings.set(JSON.stringify(reading), reading);
            resultText = JSON.stringify(result);
          } else if (tc.function.name === "web_search" && args.query) {
            searchQueries.push(args.query);
            const hits = await webSearch(args.query, ctx.fetchFn);
            for (const h of hits) traceUrls.add(h.url);
            resultText = JSON.stringify(hits);
          } else if (tc.function.name === "fetch_page" && args.url) {
            traceUrls.add(args.url);
            resultText = await fetchPageText(args.url, ctx.fetchFn);
          } else {
            resultText = `[unknown tool or missing argument: ${tc.function.name}]`;
          }
        } catch (error) {
          if (ctx.researchSchemas) {
            let args = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* Record malformed tool arguments as a failure. */ }
            retrievalAttempts.push(researchRetrievalAttempt(tc.function.name, args, {error:"Research tool call failed before a valid result"}));
          }
          resultText = `[tool failed: ${error instanceof Error ? error.message : String(error)}]`;
        }
        messages.push({
          role: "tool",
          content: ctx.researchSchemas ? resultText : resultText.slice(0, 8000),
          tool_call_id: tc.id
        });
      }
      continue;
    }
    finalText = msg.content ?? "";
    break;
  }

  let jsonObject = finalText ? extractJsonObject(finalText) : null;
  if (!jsonObject) {
    // One repair turn: JSON only, no tools.
    messages.push({
      role: "user",
      content:
        "Return ONLY the JSON object requested in the original instructions — no prose, no tool calls, valid json."
    });
    const repaired = await call(messages, false, true);
    finalText = repaired.content ?? finalText;
    jsonObject = finalText ? extractJsonObject(finalText) : null;
  }
  const jsonError = !finalText ? "empty completion" : jsonObject ? null : "no JSON object found in agent final text";

  // Verified set: the REAL tool trace when the model researched; liveness
  // fallback (weaker) only when it never touched the tools.
  const searchResultUrls =
    ctx.researchSchemas || traceUrls.size
      ? traceUrls
      : await verifyCitedUrls(collectCitedUrls(jsonObject), ctx.fetchFn);

  const priceIn = Number(process.env.DEEPSEEK_PRICE_IN_PER_MTOK);
  const priceOut = Number(process.env.DEEPSEEK_PRICE_OUT_PER_MTOK);
  const costUsd =
    Number.isFinite(priceIn) && Number.isFinite(priceOut)
      ? (promptTokens * priceIn + completionTokens * priceOut) / 1_000_000
      : null;

  return {
    rawFinalText: finalText,
    jsonObject,
    jsonError,
    searchQueries,
    searchResultUrls,
    readSourceUrls: [...readUrls],
    researchReadings: [...readings.values()],
    retrievalAttempts,
    costUsd,
    costCoverage: costUsd == null ? "unavailable" : ctx.researchSchemas ? "partial" : "complete",
    numTurns: modelTurns,
    exitCode: 0,
    stderrTail: ""
  };
}
