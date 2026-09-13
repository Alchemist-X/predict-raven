import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "./claude-agent";
import type { ExpandedLibraryCoverage, QuestionSpec, StructuredClaim, StructuredForecastState } from "./answer-types";
import { answerParameters, initialAnswer } from "./answer-math";
import { applyStructuredRound, loadStructuredState, newStructuredState, runStructuredForecast, saveStructuredState, validateStructuredRound, validateStructuredState } from "./structured-engine";
import { eventDir, loadState } from "./store";

const OPTIONS = [{ id: "meta", label: "Meta" }, { id: "google", label: "Google" }];
function spec(changes: Partial<QuestionSpec> = {}): QuestionSpec {
  return { kind: "independent_ranking", question: "Which company is most likely to cut its capital budget?",
    resolutionCriteria: "A same-scope company budget cut by 2027-03-13; reclassifications and payment timing do not count.",
    resolutionDate: "2027-03-13", asOfDate: "2026-09-13", settlementSource: "Official company earnings release", assumptions: [],
    options: OPTIONS, unit: null, minimum: null, maximum: null, scoreRubric: null, prior: { meta: 0.3, google: 0.25 },
    priorRationale: "Reference class of budget revisions.", searchQueries: OPTIONS.map(o => ({ targetId: o.id, query: `${o.label} capex`, keywords: [o.label, "capex"] })), ...changes };
}
function claim(id: string, target: string, effect: number, changes: Partial<StructuredClaim> = {}): StructuredClaim {
  return { id, claim: `${target} evidence ${id}`, targetIds: [target], sourceUrl: `https://example.org/${id}`, sourceTitle: `Source ${id}`,
    sourceType: "official", publishedAt: "2026-09-12", quote: `The published fact ${id}.`, rationale: "This changes the chance of a genuine budget revision.",
    clusterId: id, effects: { [target]: effect }, numericSignal: null, articleId: null, epistemicStatus: "fact", ...changes };
}
function result(jsonObject: unknown, claims: StructuredClaim[] = [], changes: Partial<AgentRunResult> = {}): AgentRunResult {
  return { rawFinalText: JSON.stringify(jsonObject), jsonObject, jsonError: null, searchQueries: ["company budget"],
    searchResultUrls: new Set(claims.map(c => c.sourceUrl)), costUsd: null, numTurns: 1, exitCode: 0, stderrTail: "", ...changes };
}
const proposal = (claims: StructuredClaim[]) => ({ claims, summary: "Direct facts and counterevidence.", confidence: "medium", exclusions: [] });
const summary = { verdict: "The engine ranking is unchanged by this explanation.", keyFindings: ["Company evidence is not normalized across companies."], counterarguments: ["Budgets may be maintained."], uncertainties: ["Future guidance is unknown."] };
function state(s = spec()): StructuredForecastState {
  return newStructuredState("typed-regression", s.question, { answerType: s.kind }, s);
}
function coverage(): ExpandedLibraryCoverage {
  return { required: true, searchedAtUtc: "2026-09-13T00:00:00Z", queries: [{ targetId: "meta", query: "Meta capex", status: "ok", total: 1 }],
    readings: [{ articleId: "private-1", targetId: "meta", title: "Private research", url: "https://example.org/private-1", text: "An investor expects Meta capital spending to decline.",
      offset: 220, sha256: "digest", contentKind: "markdown", apiDate: "2026-09-12" }], usedArticleIds: [], exclusions: [] };
}

let tempRoot: string;
beforeEach(() => {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), "raven-typed-engine-test-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", tempRoot);
  vi.stubEnv("FORECAST_MARKET_BLIND", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("evidence updates and durable replay", () => {
  it("updates each company independently across rounds and suppresses repeated facts", () => {
    const s = state();
    const firstClaims = [claim("meta-1", "meta", 0.6), claim("google-1", "google", -0.4)];
    const first = applyStructuredRound(s, validateStructuredRound(proposal(firstClaims), s.questionSpec), result({}, firstClaims));
    const afterFirst = structuredClone(s.answer);
    const secondClaims = [firstClaims[0], claim("renamed-duplicate", "meta", 1, { claim: firstClaims[0].claim.toUpperCase() }), claim("google-2", "google", 0.5)];
    const second = applyStructuredRound(s, validateStructuredRound(proposal(secondClaims), s.questionSpec), result({}, secondClaims));
    expect(first.newClaimCount).toBe(2);
    expect(second.newClaimCount).toBe(1);
    expect(second.duplicateCount).toBe(2);
    expect(second.before).toEqual(afterFirst);
    expect(s.evidenceLedger).toHaveLength(3);
    expect(answerParameters(s.answer).meta).toBeCloseTo(answerParameters(afterFirst).meta, 14);
    expect(answerParameters(s.answer).google).toBeGreaterThan(answerParameters(afterFirst).google);
    expect(validateStructuredState(s)).toBe(s);
    saveStructuredState(s);
    expect(loadStructuredState(s.eventId)).toEqual(s);
    expect(loadState(s.eventId)).toBeNull();
    expect(JSON.parse(readFileSync(path.join(eventDir(s.eventId), "state.json"), "utf8"))).not.toHaveProperty("currentProb");
  });

  it("discounts repeated source clusters rather than treating them as independent support", () => {
    const s = state();
    const claims = [claim("one", "meta", 1, { clusterId: "same-announcement" }), claim("two", "meta", 1, { clusterId: "same-announcement" })];
    applyStructuredRound(s, validateStructuredRound(proposal(claims), s.questionSpec), result({}, claims));
    expect(s.evidenceLedger.map(entry => entry.effectiveWeight)).toEqual([1, 0.5]);
    expect(validateStructuredState(s)).toBe(s);
  });

  it("leaves the exact prior unchanged for untraced and market-price evidence", () => {
    const s = state(spec({ prior: { meta: 0.00001, google: 0.99999 } }));
    const original = structuredClone(s.answer);
    const untraced = claim("missing-trace", "meta", 1);
    applyStructuredRound(s, validateStructuredRound(proposal([untraced]), s.questionSpec), result({}));
    expect(s.answer).toEqual(original);
    expect(s.evidenceLedger[0].verifiedInSearchTrace).toBe(false);
    expect(s.evidenceLedger[0].effectiveWeight).toBe(0);
    const market = claim("market-price", "google", -1, { sourceUrl: "https://polymarket.com/event/example-market" });
    applyStructuredRound(s, validateStructuredRound(proposal([market]), s.questionSpec), result({}, [market]));
    expect(s.answer).toEqual(original);
    expect(s.evidenceLedger[1].effectiveWeight).toBe(0);
  });

  it("uses actual pre-read library quotes in the ledger and does not count a fabricated article id as use", () => {
    const s = state();
    s.expandedLibrary = coverage();
    const read = claim("private-fact", "meta", 0.2, { sourceUrl: "https://example.org/private-1", quote: "An investor expects Meta capital spending to decline.", articleId: "private-1", epistemicStatus: "source_opinion" });
    const fabricated = claim("fabricated", "google", 0.5, { articleId: "invented-id" });
    applyStructuredRound(s, validateStructuredRound(proposal([read, fabricated]), s.questionSpec), result({}));
    expect(s.evidenceLedger[0].effectiveWeight).toBe(1);
    expect(s.evidenceLedger[0].epistemicStatus).toBe("source_opinion");
    expect(s.expandedLibrary.usedArticleIds).toEqual(["private-1"]);
    expect(s.evidenceLedger[1].effectiveWeight).toBe(0);
  });

  it("rejects a modified final answer even if the JSON structure remains valid", () => {
    const s = state();
    const claims = [claim("meta-1", "meta", 0.6)];
    applyStructuredRound(s, validateStructuredRound(proposal(claims), s.questionSpec), result({}, claims));
    const bad = structuredClone(s);
    if (bad.answer.kind !== "independent_ranking") throw new Error("Expected ranking");
    bad.answer.ranking[0].probability = 0.9;
    expect(() => validateStructuredState(bad)).toThrow(/answer.*history/);
  });

  it("rejects tampering with an intermediate round even when adjacent round boundaries are made continuous", () => {
    const s = state();
    for (const [id, effect] of [["first", 0.6], ["second", 0.4]] as const) {
      const claims = [claim(id, "meta", effect)];
      applyStructuredRound(s, validateStructuredRound(proposal(claims), s.questionSpec), result({}, claims));
    }
    const bad = structuredClone(s);
    bad.roundHistory[0].after = structuredClone(s.answer);
    bad.roundHistory[1].before = structuredClone(s.answer);
    expect(() => validateStructuredState(bad)).toThrow(/evidence ledger/);
    const wrongRound = structuredClone(s);
    wrongRound.evidenceLedger[0].round = 2;
    expect(() => validateStructuredState(wrongRound)).toThrow();
  });

  it("rejects changed evidence before/after values and out-of-range evidence weights", () => {
    const s = state();
    const claims = [claim("meta-1", "meta", 0.6)];
    applyStructuredRound(s, validateStructuredRound(proposal(claims), s.questionSpec), result({}, claims));
    const bad = structuredClone(s);
    bad.evidenceLedger[0].after = initialAnswer(s.questionSpec);
    expect(() => validateStructuredState(bad)).toThrow(/does not replay/);
    bad.evidenceLedger[0].effectiveWeight = 4;
    expect(() => validateStructuredState(bad)).toThrow(/evidence weight/);
  });

  it("does not treat malformed persisted typed JSON as a valid binary or structured forecast", () => {
    const s = state();
    saveStructuredState(s);
    writeFileSync(path.join(eventDir(s.eventId), "state.json"), '{"schemaVersion":2,"questionSpec":null}');
    expect(loadState(s.eventId)).toBeNull();
    expect(() => loadStructuredState(s.eventId)).toThrow(/structured question/);
    writeFileSync(path.join(eventDir(s.eventId), "state.json"), "{truncated");
    expect(() => loadStructuredState(s.eventId)).toThrow();
  });
});

describe("native typed research loop", () => {
  it("runs multiple rounds with real state persistence, library provenance and a separate explanation", async () => {
    const s = state();
    const library = coverage();
    const privateClaim = claim("private-fact", "meta", 0.4, { sourceUrl: library.readings[0].url, quote: "An investor expects Meta capital spending to decline.", articleId: "private-1", epistemicStatus: "source_opinion" });
    const first = [privateClaim, claim("google-official", "google", -0.3)];
    const second = [claim("meta-countercase", "meta", -0.4)];
    const runAgentFn = vi.fn().mockResolvedValueOnce(result(proposal(first), [first[1]]))
      .mockResolvedValueOnce(result(proposal(second), second)).mockResolvedValueOnce(result(summary));
    const collectLibraryFn = vi.fn().mockResolvedValue(library);
    const output = await runStructuredForecast(s, { maxRounds: 2, runAgentFn, collectLibraryFn });
    expect(output.round).toBe(2);
    expect(output.status).toBe("max_rounds");
    expect(output.summary).toEqual(summary);
    expect(output.expandedLibrary?.usedArticleIds).toEqual(["private-1"]);
    expect(output.evidenceLedger[0].verifiedInSearchTrace).toBe(true);
    expect(output.roundHistory[1].before).toEqual(output.roundHistory[0].after);
    expect(collectLibraryFn).toHaveBeenCalledTimes(1);
    expect(runAgentFn).toHaveBeenCalledTimes(3);
    expect(runAgentFn.mock.calls[0][0]).toContain("MANDATORY EXPANDED RESOURCE LIBRARY");
    expect(runAgentFn.mock.calls[1][0]).toContain("Prioritize the strongest countercase");
    expect(runAgentFn.mock.calls[2][1].allowedTools).toBe("");
    expect(loadStructuredState(s.eventId)).toEqual(output);
    expect(readdirSync(eventDir(s.eventId))).toEqual(expect.arrayContaining(["round-1-attempt-1.json", "round-2-attempt-1.json", "state.json", "report.md"]));
  });

  it("performs a genuine no-op resume when maxRounds has already been reached", async () => {
    const s = state();
    const claims = [claim("meta-1", "meta", 0.4), claim("google-1", "google", -0.4)];
    applyStructuredRound(s, validateStructuredRound(proposal(claims), s.questionSpec), result({}, claims));
    const snapshot = JSON.stringify(s);
    const runAgentFn = vi.fn();
    const collectLibraryFn = vi.fn();
    expect(await runStructuredForecast(s, { maxRounds: 1, runAgentFn, collectLibraryFn })).toBe(s);
    expect(JSON.stringify(s)).toBe(snapshot);
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(collectLibraryFn).not.toHaveBeenCalled();
  });

  it("aborts before model research if required library collection fails and preserves the error", async () => {
    const s = state();
    const runAgentFn = vi.fn();
    const collectLibraryFn = vi.fn().mockRejectedValue(new Error("Required library gateway is disabled"));
    await expect(runStructuredForecast(s, { runAgentFn, collectLibraryFn })).rejects.toThrow(/gateway/);
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(loadStructuredState(s.eventId)).toMatchObject({ status: "aborted", round: 0, error: "Required library gateway is disabled" });
  });

  it("archives a failing provider attempt and the resumable aborted state", async () => {
    const s = state();
    const runAgentFn = vi.fn().mockResolvedValue(result(proposal([]), [], { exitCode: 9, stderrTail: "Provider unavailable" }));
    await expect(runStructuredForecast(s, { runAgentFn, collectLibraryFn: vi.fn().mockResolvedValue(null) })).rejects.toThrow(/provider failed.*9/);
    expect(runAgentFn).toHaveBeenCalledTimes(1);
    expect(loadStructuredState(s.eventId)).toMatchObject({ status: "aborted", round: 0 });
    const archived = JSON.parse(readFileSync(path.join(eventDir(s.eventId), "round-1-attempt-1.json"), "utf8"));
    expect(archived).toMatchObject({ exitCode: 9, stderrTail: "Provider unavailable" });
  });

  it("corrects a malformed response once and preserves the first attempt's retrieval trace", async () => {
    const s = state();
    const claims = [claim("meta-1", "meta", 0.6), claim("google-1", "google", -0.4)];
    const runAgentFn = vi.fn()
      .mockResolvedValueOnce(result({ ...proposal(claims), confidence: "invalid" }, claims))
      .mockResolvedValueOnce(result(proposal(claims)))
      .mockResolvedValueOnce(result(summary));
    await runStructuredForecast(s, { maxRounds: 1, runAgentFn, collectLibraryFn: vi.fn().mockResolvedValue(null) });
    expect(s.evidenceLedger.every(e => e.verifiedInSearchTrace && e.effectiveWeight === 1)).toBe(true);
    expect(runAgentFn).toHaveBeenCalledTimes(3);
    expect(readdirSync(eventDir(s.eventId))).toContain("round-1-attempt-2.json");
  });

  it("does not claim convergence while every source remains unverified", async () => {
    const s = state();
    const batches = [1, 2, 3].map(i => [claim(`meta-${i}`, "meta", 0.3), claim(`google-${i}`, "google", -0.3)]);
    const runAgentFn = vi.fn();
    batches.forEach(claims => runAgentFn.mockResolvedValueOnce(result(proposal(claims))));
    runAgentFn.mockResolvedValueOnce(result(summary));
    await runStructuredForecast(s, { maxRounds: 3, runAgentFn, collectLibraryFn: vi.fn().mockResolvedValue(null) });
    expect(s.round).toBe(3);
    expect(s.status).toBe("max_rounds");
    expect(s.answer).toEqual(initialAnswer(s.questionSpec));
    expect(s.evidenceLedger.every(e => e.effectiveWeight === 0)).toBe(true);
  });

  it("stops after an empty second round without counting duplicate support again", async () => {
    const s = state();
    const first = [claim("meta-1", "meta", 0.4), claim("google-1", "google", -0.3)];
    const runAgentFn = vi.fn().mockResolvedValueOnce(result(proposal(first), first))
      .mockResolvedValueOnce(result(proposal(first), first)).mockResolvedValueOnce(result(summary));
    await runStructuredForecast(s, { maxRounds: 3, runAgentFn, collectLibraryFn: vi.fn().mockResolvedValue(null) });
    expect(s.round).toBe(2);
    expect(s.status).toBe("no_new_info");
    expect(s.roundHistory[1]).toMatchObject({ newClaimCount: 0, duplicateCount: 2 });
    expect(s.roundHistory[1].after).toEqual(s.roundHistory[0].after);
    expect(validateStructuredState(s)).toBe(s);
  });

  it("rejects a round that omits a compared company even if the included source is valid", async () => {
    const s = state();
    const claims = [claim("meta-only", "meta", 0.3)];
    const runAgentFn = vi.fn().mockResolvedValue(result(proposal(claims), claims));
    await expect(runStructuredForecast(s, { maxRounds: 1, runAgentFn, collectLibraryFn: vi.fn().mockResolvedValue(null) })).rejects.toThrow(/Every ranked entity/);
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(s.round).toBe(0);
    expect(s.status).toBe("aborted");
  });
});
