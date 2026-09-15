// Claude Code invocation + stream-json parsing.
//
// We drive the model as a CLI session: `claude --print --output-format
// stream-json --verbose --allowedTools WebSearch`. The stream-json output lets
// us do two things a plain markdown render cannot:
//   1) capture the agent's ACTUAL WebSearch queries and the result URLs it was
//      given — the ground-truth source trace used to flag fabricated citations;
//   2) read the final assistant text and extract the structured JSON the round
//      contract requires.
//
// The endpoint is configured purely by env (ANTHROPIC_BASE_URL / API key), so
// no secret is committed here.

import { spawn } from "node:child_process";
import {
  agentTimeoutMs,
  RESEARCH_MCP_PREFIX,
  RESEARCH_POLICY,
  researchClaudeArgs,
  researchSourceUrls,
  researchReadSourceUrls,
  researchToolReading,
  researchRetrievalAttempt,
  type ResearchToolReading,
  researchToolNames,
  signalDeskEnabled
} from "./research-tools";
import { rankClaimSources } from "./claims";
import type {
  AgentRoundOutput,
  ClaimCategory,
  ClaimSource,
  ClaimSupport,
  CrossCheckStatus,
  ResolutionRelevance,
  SourceType,
  SupportQuality
} from "./types";

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
}

export interface AgentRunResult {
  retrievalAttempts?: import("./research-progress").RetrievalAttempt[];
  rawFinalText: string;
  jsonObject: unknown | null; // first balanced JSON object extracted from the final text
  jsonError: string | null; // set when no JSON object could be extracted
  searchQueries: string[];
  searchResultUrls: Set<string>; // every URL the agent's searches actually returned
  readSourceUrls?: string[]; // successful correlated read results only; JSON-safe
  researchReadings?: ResearchToolReading[]; // private source excerpts, never generic public output
  costUsd: number | null;
  // The provider/runtime reports these after the call. They are deliberately
  // separate from the requested model archived before the call: aliases and
  // provider routing can resolve to a different concrete model.
  resolvedModel?: string | null;
  usage?: AgentUsage;
  costSource?: "provider_reported" | "configured_rates" | "unavailable";
  costCoverage?: "complete" | "partial" | "unavailable";
  agentRuntimeVersion?: string | null;
  numTurns: number | null;
  exitCode: number;
  stderrTail: string;
}

// Collect every URL the agent actually interacted with via a tool, so a cited
// source can be reconciled against what was really retrieved (fabrication guard).
// Two strong signals, captured without over-capturing page-embedded links:
//   - tool_use with input.url  → e.g. WebFetch: the URL the agent explicitly fetched
//   - {title, url} pairs        → WebSearch result links returned to the agent
function collectToolUrlsDeep(node: unknown, urls: Set<string>, researchIds: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectToolUrlsDeep(item, urls, researchIds);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "tool_use" && typeof rec.name === "string" && rec.name.startsWith(RESEARCH_MCP_PREFIX)) {
    if (typeof rec.id === "string") researchIds.add(rec.id);
    return;
  }
  if (rec.type === "tool_result" && typeof rec.tool_use_id === "string" && researchIds.has(rec.tool_use_id)) {
    if (rec.is_error) return;
    const blocks = Array.isArray(rec.content) ? rec.content : [{ text: rec.content }];
    for (const block of blocks) {
      if (!block || typeof block !== "object" || typeof block.text !== "string") continue;
      try {
        for (const url of researchSourceUrls(JSON.parse(block.text))) urls.add(url);
      } catch {
        /* A malformed result provides no source verification. */
      }
    }
    for (const url of researchSourceUrls(rec.structuredContent)) urls.add(url);
    return;
  }
  if (rec.type === "tool_use" && rec.input && typeof rec.input === "object") {
    const u = (rec.input as Record<string, unknown>).url;
    if (typeof u === "string" && u) urls.add(u);
  }
  if (typeof rec.url === "string" && typeof rec.title === "string") {
    urls.add(rec.url);
  }
  for (const v of Object.values(rec)) collectToolUrlsDeep(v, urls, researchIds);
}

// Correlate actual MCP tool results without traversing source content as protocol events.
function collectToolReads(
  node: unknown,
  calls: Map<string, string>,
  urls: Set<string>,
  readings: Map<string, ResearchToolReading>
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectToolReads(item, calls, urls, readings);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "tool_use") {
    if (typeof rec.id === "string" && typeof rec.name === "string" && rec.name.startsWith(RESEARCH_MCP_PREFIX)) {
      calls.set(rec.id, rec.name.slice(RESEARCH_MCP_PREFIX.length));
    }
    return;
  }
  if (rec.type === "tool_result") {
    const name = typeof rec.tool_use_id === "string" ? calls.get(rec.tool_use_id) : undefined;
    if (!name || rec.is_error) return;
    const accept = (data: unknown) => {
      for (const url of researchReadSourceUrls(name, data)) urls.add(url);
      const reading = researchToolReading(name, data);
      if (reading) readings.set(JSON.stringify(reading), reading);
    };
    const blocks = Array.isArray(rec.content) ? rec.content : [{ text: rec.content }];
    for (const block of blocks) {
      if (!block || typeof block !== "object" || typeof block.text !== "string") continue;
      try {
        accept(JSON.parse(block.text));
      } catch {
        /* Malformed content does not establish a read. */
      }
    }
    accept(rec.structuredContent);
    return;
  }
  for (const value of Object.values(rec)) collectToolReads(value, calls, urls, readings);
}

// Exported for testing: pull the tool-interaction URL set out of a raw
// stream-json stdout (covers both WebSearch results and WebFetch fetches).
export function extractToolUrls(stdout: string): Set<string> {
  const urls = new Set<string>();
  const researchIds = new Set<string>();
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t || t[0] !== "{") continue;
    try {
      collectToolUrlsDeep(JSON.parse(t), urls, researchIds);
    } catch {
      /* skip non-JSON lines */
    }
  }
  return urls;
}

interface ParsedStreamJson {
  retrievalAttempts: import("./research-progress").RetrievalAttempt[];
  finalText: string;
  searchQueries: string[];
  searchResultUrls: Set<string>;
  readSourceUrls: string[];
  researchReadings: ResearchToolReading[];
  costUsd: number | null;
  numTurns: number | null;
  resolvedModel: string | null;
  usage: AgentUsage | null;
  agentRuntimeVersion: string | null;
}

const zeroUsage = (): AgentUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  webSearchRequests: 0,
  webFetchRequests: 0
});

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usageFromRecord(raw: unknown): AgentUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const server =
    o.server_tool_use && typeof o.server_tool_use === "object" ? (o.server_tool_use as Record<string, unknown>) : {};
  const hasUsageField =
    [
      "input_tokens",
      "inputTokens",
      "output_tokens",
      "outputTokens",
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
      "cache_read_input_tokens",
      "cacheReadInputTokens",
      "web_search_requests",
      "webSearchRequests"
    ].some((key) => key in o) || Object.keys(server).length > 0;
  if (!hasUsageField) return null;
  return {
    inputTokens: finiteNumber(o.input_tokens ?? o.inputTokens),
    outputTokens: finiteNumber(o.output_tokens ?? o.outputTokens),
    cacheCreationInputTokens: finiteNumber(o.cache_creation_input_tokens ?? o.cacheCreationInputTokens),
    cacheReadInputTokens: finiteNumber(o.cache_read_input_tokens ?? o.cacheReadInputTokens),
    webSearchRequests: finiteNumber(server.web_search_requests ?? o.web_search_requests ?? o.webSearchRequests),
    webFetchRequests: finiteNumber(server.web_fetch_requests ?? o.web_fetch_requests ?? o.webFetchRequests)
  };
}

function addUsage(target: AgentUsage, source: AgentUsage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.webSearchRequests += source.webSearchRequests;
  target.webFetchRequests += source.webFetchRequests;
}

// Exported for provenance tests. Claude Code's result event is preferred as
// the authoritative aggregate; assistant-message usage is only a fallback.
export function parseStreamJson(stdout: string): ParsedStreamJson {
  const retrievalAttempts: import("./research-progress").RetrievalAttempt[] = [];
  const retrievalCalls = new Map<string, {name: string; args: Record<string, unknown>; complete: boolean}>();
  const collectRetrieval = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(collectRetrieval); return; }
    const r = node as Record<string, any>;
    if (r.type === "tool_use" && typeof r.name === "string" && r.name.startsWith(RESEARCH_MCP_PREFIX) && typeof r.id === "string") {
      if (!retrievalCalls.has(r.id)) retrievalCalls.set(r.id, {name:r.name.slice(RESEARCH_MCP_PREFIX.length),args:r.input ?? {},complete:false});
      return;
    }
    if (r.type === "tool_result") {
      const call = retrievalCalls.get(r.tool_use_id);
      if (!call || call.complete) return;
      let data: unknown = r.structuredContent;
      if (!data) for (const block of Array.isArray(r.content) ? r.content : [{text:r.content}]) {
        try { data = JSON.parse(block.text); break; } catch { /* An unreadable result is a failed retrieval. */ }
      }
      retrievalAttempts.push(researchRetrievalAttempt(call.name, call.args, r.is_error ? {error:"MCP tool failed"} : data));
      call.complete = true;
      return;
    }
    Object.values(r).forEach(collectRetrieval);
  };
  const queries: string[] = [];
  const urls = new Set<string>();
  const researchIds = new Set<string>();
  const readCalls = new Map<string, string>();
  const readUrls = new Set<string>();
  const readings = new Map<string, ResearchToolReading>();
  let finalText = "";
  let costUsd: number | null = null;
  let numTurns: number | null = null;
  let systemModel: string | null = null;
  let assistantModel: string | null = null;
  let modelUsageModel: string | null = null;
  let agentRuntimeVersion: string | null = null;
  const assistantUsage = zeroUsage();
  let assistantUsageObserved = false;
  let resultUsage: AgentUsage | null = null;
  let modelUsage: AgentUsage | null = null;
  let observedWebFetchCalls = 0;
  const lastAssistantTexts: string[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = obj.type;
    collectRetrieval(obj);
    collectToolUrlsDeep(obj, urls, researchIds); // tool_use.input.url (WebFetch) + {title,url} (WebSearch)
    collectToolReads(obj, readCalls, readUrls, readings);
    if (type === "system" && obj.subtype === "init") {
      if (typeof obj.model === "string" && obj.model) systemModel = obj.model;
      if (typeof obj.claude_code_version === "string") agentRuntimeVersion = obj.claude_code_version;
    } else if (type === "assistant") {
      const msg = obj.message as { content?: unknown; model?: unknown; usage?: unknown } | undefined;
      if (typeof msg?.model === "string" && msg.model !== "<synthetic>") assistantModel = msg.model;
      const observed = usageFromRecord(msg?.usage);
      if (observed) {
        assistantUsageObserved = true;
        addUsage(assistantUsage, observed);
      }
      const content = (msg?.content as unknown[]) ?? [];
      for (const block of content) {
        const b = block as Record<string, unknown>;
        if (
          b.type === "tool_use" &&
          (b.name === "WebSearch" ||
            b.name === RESEARCH_MCP_PREFIX + "web_search" ||
            b.name === RESEARCH_MCP_PREFIX + "signal_desk_search")
        ) {
          const input = b.input as { query?: unknown; keywords?: unknown } | undefined;
          const query = input?.query ?? input?.keywords;
          if (typeof query === "string") queries.push(query);
          else if (Array.isArray(query)) queries.push(query.join(" "));
        }
        if (
          b.type === "tool_use" &&
          (b.name === "WebFetch" ||
            ["fetch_page", "signal_desk_read", "signal_desk_pdf", "research_images", "research_image"].some((name) => b.name === RESEARCH_MCP_PREFIX + name))
        )
          observedWebFetchCalls += 1;
        if (b.type === "text" && typeof b.text === "string") {
          lastAssistantTexts.push(b.text);
        }
      }
    } else if (type === "result") {
      if (typeof obj.result === "string") finalText = obj.result;
      if (typeof obj.total_cost_usd === "number") costUsd = obj.total_cost_usd;
      if (typeof obj.num_turns === "number") numTurns = obj.num_turns;
      resultUsage = usageFromRecord(obj.usage);
      if (obj.modelUsage && typeof obj.modelUsage === "object" && !Array.isArray(obj.modelUsage)) {
        const aggregate = zeroUsage();
        let found = false;
        for (const [model, rawUsage] of Object.entries(obj.modelUsage as Record<string, unknown>)) {
          const observed = usageFromRecord(rawUsage);
          if (!observed) continue;
          found = true;
          addUsage(aggregate, observed);
          if (!modelUsageModel) modelUsageModel = model;
        }
        if (found) modelUsage = aggregate;
      }
    }
  }

  if (!finalText && lastAssistantTexts.length) {
    finalText = lastAssistantTexts[lastAssistantTexts.length - 1] ?? "";
  }
  for (const call of retrievalCalls.values()) if (!call.complete)
    retrievalAttempts.push(researchRetrievalAttempt(call.name, call.args, {error:"Tool call has no correlated result"}));
  let usage = resultUsage ?? modelUsage ?? (assistantUsageObserved ? assistantUsage : null);
  // Older Claude Code builds did not put tool counts in the result usage. The
  // actual tool trace is a safe lower-bound fallback and avoids a misleading 0.
  if (!usage && (queries.length > 0 || observedWebFetchCalls > 0)) usage = zeroUsage();
  if (usage) {
    usage.webSearchRequests = Math.max(usage.webSearchRequests, queries.length);
    usage.webFetchRequests = Math.max(usage.webFetchRequests, observedWebFetchCalls);
  }
  return {
    finalText,
    searchQueries: queries,
    searchResultUrls: urls,
    readSourceUrls: [...readUrls],
    researchReadings: [...readings.values()],
    retrievalAttempts,
    costUsd,
    numTurns,
    resolvedModel: assistantModel ?? modelUsageModel ?? systemModel,
    usage,
    agentRuntimeVersion
  };
}

// Pull the first balanced JSON object out of possibly-chatty model text.
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let s = text.trim();
  // Strip ```json ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = (fence[1] ?? "").trim();
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const STANCES = new Set(["supports_yes", "supports_no", "neutral"]);
const STRENGTHS = new Set(["weak", "moderate", "strong"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const SOURCE_TYPES = new Set<SourceType>([
  "official",
  "data",
  "academic",
  "original_reporting",
  "press",
  "insider",
  "secondary"
]);
const CLAIM_CATEGORIES = new Set<ClaimCategory>([
  "base_rate",
  "resolution",
  "current_state",
  "causal_driver",
  "counterevidence"
]);
const RELEVANCE = new Set<ResolutionRelevance>(["direct", "indirect", "context"]);
const RELATIONS = new Set<ClaimSupport>(["supports", "contradicts", "context"]);
const SUPPORT_QUALITY = new Set<SupportQuality>(["direct", "partial", "context"]);
const CROSS_CHECK = new Set<CrossCheckStatus>(["confirmed", "single_source", "contested", "unverified"]);

function cleanId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : "";
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

function parseClaimSource(raw: unknown, fallback: Record<string, unknown>, index: number): ClaimSource | null {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : fallback;
  const url =
    typeof source.url === "string" ? source.url : typeof source.source_url === "string" ? source.source_url : "";
  if (!url.trim()) return null;
  const sourceType = SOURCE_TYPES.has(source.source_type as SourceType) ? (source.source_type as SourceType) : "press";
  const credibility = CONFIDENCES.has(source.credibility as string)
    ? (source.credibility as ClaimSource["credibility"])
    : "medium";
  return {
    url: url.trim(),
    title:
      typeof source.title === "string"
        ? source.title.trim()
        : typeof source.source_title === "string"
          ? source.source_title.trim()
          : "",
    sourceType,
    credibility,
    relation: RELATIONS.has(source.relation as ClaimSupport) ? (source.relation as ClaimSupport) : "supports",
    supportQuality: SUPPORT_QUALITY.has(source.support_quality as SupportQuality)
      ? (source.support_quality as SupportQuality)
      : "direct",
    publishedAt:
      typeof source.published_at === "string" && source.published_at.trim() ? source.published_at.trim() : null,
    isPrimary:
      typeof source.is_primary === "boolean" ? source.is_primary : sourceType === "official" || sourceType === "data",
    independenceGroup:
      typeof source.independence_group === "string" && source.independence_group.trim()
        ? source.independence_group.trim()
        : `source-${index + 1}`
  };
}

// Fail-closed validation: a malformed round throws rather than silently
// degrading to a guessed number.
export function validateRoundOutput(raw: unknown): AgentRoundOutput {
  if (!raw || typeof raw !== "object") throw new Error("agent output is not an object");
  const o = raw as Record<string, unknown>;
  const claimsRaw = Array.isArray(o.new_claims) ? o.new_claims : Array.isArray(o.new_evidence) ? o.new_evidence : null;
  if (!claimsRaw) throw new Error("new_claims missing or not an array");
  const newClaims = claimsRaw.map((e, i) => {
    const ev = e as Record<string, unknown>;
    if (typeof ev.claim !== "string" || !ev.claim.trim()) throw new Error(`claim[${i}].claim missing`);
    if (!STANCES.has(ev.stance as string)) throw new Error(`claim[${i}].stance invalid: ${ev.stance}`);
    if (!STRENGTHS.has(ev.strength as string)) throw new Error(`claim[${i}].strength invalid`);
    if (typeof ev.llr !== "number" || !Number.isFinite(ev.llr)) throw new Error(`claim[${i}].llr not a finite number`);
    const rawSources = Array.isArray(ev.sources) && ev.sources.length ? ev.sources : [ev];
    const sources = rankClaimSources(
      rawSources
        .map((source, sourceIndex) => parseClaimSource(source, ev, sourceIndex))
        .filter((source): source is ClaimSource => source !== null)
    );
    if (!sources.length) throw new Error(`claim[${i}] has no source URL`);
    const supportingSources = sources.filter((source) => source.relation === "supports");
    const best = supportingSources[0];
    if (!best) throw new Error(`claim[${i}] has no source that supports the factual claim`);
    const independent = new Set(sources.map((source) => source.independenceGroup)).size;
    const hasContradiction = sources.some((source) => source.relation === "contradicts");
    const derivedStatus: CrossCheckStatus = hasContradiction
      ? "contested"
      : independent >= 2
        ? "confirmed"
        : "single_source";
    const crossCheckStatus = CROSS_CHECK.has(ev.cross_check_status as CrossCheckStatus)
      ? (ev.cross_check_status as CrossCheckStatus)
      : derivedStatus;
    return {
      // When an older caller omits a semantic id, leave it empty so the
      // engine derives the dedupe key from the claim text. A positional id
      // such as claim-1 would incorrectly collide across research rounds.
      claim_id: cleanId(ev.claim_id, ""),
      focus_id: cleanId(ev.focus_id, "unassigned"),
      claim: ev.claim.trim(),
      libraryArticleId: typeof ev.library_article_id === "string" ? ev.library_article_id : undefined,
      libraryQuote: typeof ev.library_quote === "string" ? ev.library_quote : undefined,
      source_url: best.url,
      source_title: best.title,
      stance: ev.stance as AgentRoundOutput["newClaims"][number]["stance"],
      strength: ev.strength as AgentRoundOutput["newClaims"][number]["strength"],
      llr: ev.llr,
      rationale: typeof ev.rationale === "string" ? ev.rationale : "",
      cluster_id: typeof ev.cluster_id === "string" ? ev.cluster_id : "",
      source_type: best.sourceType,
      credibility: best.credibility,
      category: CLAIM_CATEGORIES.has(ev.category as ClaimCategory) ? (ev.category as ClaimCategory) : "current_state",
      resolution_relevance: RELEVANCE.has(ev.resolution_relevance as ResolutionRelevance)
        ? (ev.resolution_relevance as ResolutionRelevance)
        : "direct",
      cross_check_status: crossCheckStatus,
      selection_rationale: typeof ev.selection_rationale === "string" ? ev.selection_rationale.trim() : "",
      sources
    };
  });
  if (!CONFIDENCES.has(o.confidence as string)) throw new Error("confidence invalid");
  // (a) reflection is optional; keep only well-formed entries (target + new source + finite adj).
  const reflectionRaw = Array.isArray(o.reflection) ? o.reflection : [];
  const reflection = reflectionRaw
    .map((r) => r as Record<string, unknown>)
    .filter(
      (r) =>
        typeof r.target_url === "string" &&
        r.target_url.trim() &&
        typeof r.new_source_url === "string" &&
        r.new_source_url.trim() &&
        typeof r.llr_adjustment === "number" &&
        Number.isFinite(r.llr_adjustment)
    )
    .map((r) => ({
      target_url: r.target_url as string,
      llr_adjustment: r.llr_adjustment as number,
      reason: typeof r.reason === "string" ? r.reason : "",
      new_source_url: r.new_source_url as string
    }));
  return {
    round_summary: typeof o.round_summary === "string" ? o.round_summary : "",
    newClaims,
    reflection,
    confidence: o.confidence as AgentRoundOutput["confidence"],
    found_new_information: Boolean(o.found_new_information),
    notes: typeof o.notes === "string" ? o.notes : ""
  };
}

export interface RunAgentOptions {
  allowedTools?: string;
  model?: string;
  timeoutMs?: number;
  cwd?: string;
}

export async function runAgentRaw(prompt: string, opts: RunAgentOptions = {}): Promise<AgentRunResult> {
  // Auth is whatever the claude CLI can resolve from the inherited env, in its
  // own precedence: ANTHROPIC_API_KEY (API billing), CLAUDE_CODE_OAUTH_TOKEN
  // (long-lived subscription token from `claude setup-token` — the headless-
  // server path), or the CLI's stored interactive login. No key is required
  // here; an unauthenticated CLI fails the run with its own clear error.
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const allowedTools = opts.allowedTools ?? process.env.FORECAST_ALLOWED_TOOLS ?? "WebSearch WebFetch";
  const model = opts.model ?? process.env.FORECAST_MODEL ?? "";
  const research = signalDeskEnabled();
  const researchActive = research && researchToolNames(opts.allowedTools).length > 0;
  const timeoutMs = agentTimeoutMs(opts.timeoutMs);
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(research ? researchClaudeArgs(opts.allowedTools) : ["--allowedTools", allowedTools])
  ];
  if (model) args.push("--model", model);

  return await new Promise<AgentRunResult>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {})
      }
    });
    let stdout = "";
    let stderr = "";
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`agent timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const parsedStream = parseStreamJson(stdout);
      const jsonObject = extractJsonObject(parsedStream.finalText);
      const jsonError = jsonObject ? null : "no JSON object found in agent final text";
      resolve({
        rawFinalText: parsedStream.finalText,
        jsonObject,
        jsonError,
        searchQueries: parsedStream.searchQueries,
        searchResultUrls: parsedStream.searchResultUrls,
        readSourceUrls: parsedStream.readSourceUrls,
        researchReadings: parsedStream.researchReadings,
        retrievalAttempts: parsedStream.retrievalAttempts,
        costUsd: parsedStream.costUsd,
        resolvedModel: parsedStream.resolvedModel,
        usage: parsedStream.usage ?? undefined,
        costSource: parsedStream.costUsd == null ? "unavailable" : "provider_reported",
        costCoverage: parsedStream.costUsd == null ? "unavailable" : researchActive ? "partial" : "complete",
        agentRuntimeVersion: parsedStream.agentRuntimeVersion,
        numTurns: parsedStream.numTurns,
        exitCode: code ?? -1,
        stderrTail: stderr.slice(-800)
      });
    });
    child.stdin.write(researchActive ? `${RESEARCH_POLICY}\n\n${prompt}` : prompt);
    child.stdin.end();
  });
}
