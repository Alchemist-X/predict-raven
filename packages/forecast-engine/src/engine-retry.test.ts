import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractToolUrls, validateRoundOutput } from "./claude-agent";
import type { AgentRunResult, AgentUsage } from "./claude-agent";
import { newForecastState, runForecast } from "./engine";
import type { EventFraming } from "./types";

vi.mock("./agent", () => ({ providerHasWebSearch: () => false, runAgent: vi.fn() }));
vi.mock("./summary", () => ({ summarizeForecast: async () => ({
  verdict: "Summary", keyFactorsYes: [], keyFactorsNo: [], mainUncertainties: "", calibrationNote: ""
}) }));

const frame: EventFraming = {
  normalizedQuestion: "Will the issuer revise its annual plan?", resolutionCriteria: "An official revision counts.",
  resolutionDate: "2027-03-06", settlementSource: "Official filing", assumptions: "", forecastable: true,
  clarificationNeeded: "", priorProbability: 0.5, priorRationale: "Base rate", framingCaveats: "", framingConfidence: "medium"
};
const OLD = "https://issuer.example/filing";
const NEW = "https://registry.example/record";
const FAILED = "https://private.example/failed-read";
const source = (url: string, relation = "supports") => ({
  url, title: "Record", source_type: "official", credibility: "high", relation,
  support_quality: "direct", independence_group: new URL(url).hostname
});
const supported = () => ({
  claim_id: "unchanged-plan", claim: "The issuer published an unchanged plan.", stance: "supports_no", strength: "weak",
  llr: -0.2, sources: [source(OLD)], rationale: "The plan has not changed.", cluster_id: "current-plan"
});
const background = () => ({
  claim_id: "disclosure-calendar", claim: "An annual update is expected during the observation window.",
  stance: "neutral", strength: "weak", llr: 0, resolution_relevance: "context", sources: [source(OLD, "context")]
});
const round = (claims: unknown[], notes = "") => ({
  round_summary: "Research complete", new_claims: claims, reflection: [], confidence: "medium",
  found_new_information: claims.length > 0, notes
});
const usage = (n: number): AgentUsage => ({
  inputTokens: n * 100, outputTokens: n * 20, cacheCreationInputTokens: n * 3,
  cacheReadInputTokens: n * 4, webSearchRequests: n, webFetchRequests: n * 2
});
const result = (out: unknown, urls: string[], overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  rawFinalText: JSON.stringify(out), jsonObject: out, jsonError: null, searchQueries: ["issuer plan"],
  searchResultUrls: new Set(urls), costUsd: 0.1, usage: usage(1), numTurns: 1, exitCode: 0, stderrTail: "", ...overrides
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forecast-retry-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
  vi.stubEnv("FORECAST_MARKET_BLIND", "0");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const state = () => newForecastState({ eventId: "retry-event", eventText: "Research the annual plan", framing: frame });

describe("round validation retry", () => {
  it("returns the specific error and full previous output, retains genuine sources, and sums both calls", async () => {
    const invalid = round([supported(), background()]);
    const before = structuredClone(invalid);
    expect(() => validateRoundOutput(invalid)).toThrow("claim[1] has no source that supports the factual claim");
    const corrected = round([{ ...supported(), sources: [source(OLD), source(NEW), source(FAILED, "context")] }],
      "The unverified disclosure calendar remains background, not a weighted claim.");

    // The real MCP trace extractor rejects an error result even if it names a
    // URL. Neither the retry payload nor the claim's URL makes it verified.
    const wire = (id: string, url: string, error = false) => [
      { type: "assistant", message: { content: [{ type: "tool_use", id, name: "mcp__raven_research__fetch_page", input: { url } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: error,
        content: [{ type: "text", text: JSON.stringify(error ? { error: "403", source_urls: [url] } : { source_urls: [url] }) }] }] } }
    ];
    const trace = extractToolUrls([...wire("old", OLD), ...wire("failed", FAILED, true)].map(r => JSON.stringify(r)).join("\n"));
    const agent = vi.fn().mockResolvedValueOnce(result(invalid, [...trace], {
      costUsd: 0.7, searchQueries: ["issuer plan", "issuer sources"]
    })).mockResolvedValueOnce(result(corrected, [NEW], {
      costUsd: 0.2, usage: usage(2), searchQueries: ["issuer plan", "updated registry"]
    }));
    const logs: string[] = [];

    const out = await runForecast(state(), { maxRounds: 1, runAgentFn: agent, onLog: text => logs.push(text) });

    expect(agent).toHaveBeenCalledTimes(2);
    const retryPrompt = agent.mock.calls[1][0];
    expect(retryPrompt).toContain("Validation error: claim[1] has no source that supports the factual claim");
    expect(retryPrompt).toContain(JSON.stringify(invalid, null, 2));
    expect(retryPrompt).toContain("move that unsupported background to notes");
    expect(retryPrompt).toContain("do not simply change a context label to supports");
    expect(logs.join("\n")).toContain("claim[1] has no source that supports the factual claim");
    expect(out.evidenceLedger).toHaveLength(1);
    const sources = out.evidenceLedger[0].sources!;
    expect(sources.find(s => s.url === OLD)?.verifiedInSearchTrace).toBe(true);
    expect(sources.find(s => s.url === NEW)?.verifiedInSearchTrace).toBe(true);
    expect(sources.find(s => s.url === FAILED)?.verifiedInSearchTrace).toBe(false);
    expect(out.roundHistory[0].searchResultUrlCount).toBe(2);
    expect(out.roundHistory[0].searchQueries).toEqual(["issuer plan", "issuer sources", "updated registry"]);
    expect(out.roundHistory[0].costUsd).toBeCloseTo(0.9);
    expect(out.roundHistory[0].usage).toEqual(usage(3));
    expect(JSON.parse(readFileSync(join(root, "forecasts/retry-event/state.json"), "utf8")).roundHistory[0].usage).toEqual(usage(3));
    expect(readFileSync(join(root, "forecasts/retry-event/invalid-round-1-attempt-1.txt"), "utf8")).toContain(JSON.stringify(invalid));
    expect(invalid).toEqual(before);
  });

  it("keeps the exact second validation error and aborts without accepting either attempt", async () => {
    const invalid = round([background()]);
    const second = round([{ ...supported(), llr: "not-a-number" }]);
    const agent = vi.fn().mockResolvedValueOnce(result(invalid, [OLD])).mockResolvedValueOnce(result(second, [NEW]));
    const current = state();

    await expect(runForecast(current, { maxRounds: 1, runAgentFn: agent }))
      .rejects.toThrow("round 1 aborted: agent output invalid after retry: claim[0].llr not a finite number");

    expect(current.status).toBe("aborted");
    expect(current.round).toBe(0);
    expect(current.currentProb).toBe(0.5);
    expect(current.evidenceLedger).toEqual([]);
    expect(current.roundHistory).toEqual([]);
    expect(agent).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(root, "forecasts/retry-event/invalid-round-1-attempt-1.txt"), "utf8")).toContain("has no source that supports");
    const finalDiagnostic = readFileSync(join(root, "forecasts/retry-event/invalid-round-1.txt"), "utf8");
    expect(finalDiagnostic).toContain("claim[0].llr not a finite number");
    expect(finalDiagnostic).toContain(JSON.stringify(second));
  });

  it("feeds invalid JSON back as data with the parse error, without fabricating usage or cost", async () => {
    const raw = '{"round_summary":"the "quoted" text"}';
    const agent = vi.fn().mockResolvedValueOnce(result(null, [OLD], {
      rawFinalText: raw, jsonError: "Invalid JSON at character 23", costUsd: null, usage: undefined
    })).mockResolvedValueOnce(result(round([supported()]), []));

    const out = await runForecast(state(), { maxRounds: 1, runAgentFn: agent });

    expect(agent.mock.calls[1][0]).toContain("Invalid JSON at character 23; agent output is not an object");
    expect(agent.mock.calls[1][0]).toContain(JSON.stringify(raw));
    expect(out.evidenceLedger[0].verifiedInSearchTrace).toBe(true);
    expect(out.roundHistory[0].costUsd).toBeNull();
    expect(out.roundHistory[0].usage).toBeUndefined();
  });

  it("keeps an initially valid single call unchanged", async () => {
    const valid = round([supported()]);
    const agent = vi.fn().mockResolvedValue(result(valid, [OLD], { costUsd: 0.45 }));

    const out = await runForecast(state(), { maxRounds: 1, runAgentFn: agent });

    expect(agent).toHaveBeenCalledTimes(1);
    expect(agent.mock.calls[0][0]).not.toContain("VALIDATION RETRY");
    expect(out.evidenceLedger).toHaveLength(1);
    expect(out.roundHistory[0].costUsd).toBe(0.45);
    expect(out.roundHistory[0].usage).toEqual(usage(1));
    expect(out.roundHistory[0].searchQueries).toEqual(["issuer plan"]);
    expect(out.roundHistory[0].searchResultUrlCount).toBe(1);
  });
});
