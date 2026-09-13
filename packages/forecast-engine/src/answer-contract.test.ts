import { describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "./claude-agent";
import type { AnswerRequest, QuestionSpec, StructuredClaim } from "./answer-types";
import { answerLabel } from "./answer-types";
import { answerMovement, answerParameters, applyStructuredClaim, initialAnswer } from "./answer-math";
import { classifyQuestion, frameStructuredQuestion, validateAnswerRequest, validatedCall, validateQuestionSpec } from "./question-spec";
import { makeEventId } from "./store";
import { newStructuredState, renderStructuredReport, validateStructuredRound } from "./structured-engine";

const AS_OF = "2026-09-13";
const OPTIONS = ["a", "b", "c", "d"].map(id => ({ id, label: `Option ${id.toUpperCase()}` }));
function spec(kind: QuestionSpec["kind"] = "categorical", changes: Partial<QuestionSpec> = {}): QuestionSpec {
  return {
    kind, question: "Which of four mutually exclusive outcomes occurs?", resolutionCriteria: "Observe the single published outcome.",
    resolutionDate: "2027-03-13", asOfDate: AS_OF, settlementSource: "Official outcome registry", assumptions: [],
    options: OPTIONS, unit: null, minimum: null, maximum: null, scoreRubric: null,
    prior: { a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, priorRationale: "Symmetric reference class before current evidence.",
    searchQueries: [{ targetId: "question", query: "official outcome", keywords: ["outcome"] }], ...changes,
  };
}
function numericSpec(changes: Partial<QuestionSpec> = {}): QuestionSpec {
  return spec("numeric", { question: "Predict the next audited quality score", options: [], unit: "points", minimum: 0, maximum: 100,
    scoreRubric: "0–100 points: accuracy 50, completeness 30, clarity 20.", prior: { mean: 78, standardDeviation: 8 }, ...changes });
}
function claim(changes: Partial<StructuredClaim> = {}): StructuredClaim {
  return { id: "fact_a", claim: "The official bulletin favors outcome A.", targetIds: ["a"], sourceUrl: "https://example.org/bulletin",
    sourceTitle: "Official bulletin", sourceType: "official", publishedAt: AS_OF, quote: "Outcome A meets the criteria.",
    rationale: "This is direct evidence for outcome A.", clusterId: "bulletin", effects: { a: 0.8 }, numericSignal: null,
    articleId: null, epistemicStatus: "fact", ...changes };
}
function result(jsonObject: unknown, changes: Partial<AgentRunResult> = {}): AgentRunResult {
  return { rawFinalText: JSON.stringify(jsonObject), jsonObject, jsonError: null, searchQueries: [], searchResultUrls: new Set(),
    costUsd: null, numTurns: 1, exitCode: 0, stderrTail: "", ...changes };
}
const round = (c: StructuredClaim) => ({ claims: [c], summary: "Evidence changes the relative likelihood.", confidence: "medium", exclusions: [] });

describe("native answer contracts", () => {
  it("keeps all four categorical options and normalizes every evidence update", () => {
    const s = validateQuestionSpec(spec(), spec().question, "categorical", {}, AS_OF);
    const answer = applyStructuredClaim(s, initialAnswer(s), claim(), 1);
    expect(answer.kind).toBe("categorical");
    if (answer.kind !== "categorical") throw new Error("Expected categorical answer");
    expect(answer.probabilities.map(o => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(answer.probabilities.reduce((total, o) => total + o.probability, 0)).toBeCloseTo(1, 14);
    expect(answer.selectedId).toBe("a");
    expect(answer.probabilities[0].probability).toBeGreaterThan(0.25);
    expect(answer).not.toHaveProperty("currentProb");
  });

  it.each([
    { a: 0.3, b: 0.3, c: 0.3, d: 0.3 },
    { a: 0.25, b: 0.25, c: 0.5 },
    { a: 0.2, b: 0.2, c: 0.2, d: 0.2, extra: 0.2 },
    { a: 0, b: 0.5, c: 0.25, d: 0.25 },
    { a: Number.NaN, b: 0.25, c: 0.25, d: 0.25 },
  ] as Array<Record<string, number>>)("rejects categorical priors with missing/extra options or invalid mass: %j", prior => {
    expect(() => validateQuestionSpec(spec("categorical", { prior }), "question", "categorical", {}, AS_OF)).toThrow();
  });

  it.each([
    { options: [{ id: "a", label: "A" }, { id: "A", label: "B" }] },
    { options: [{ id: "a", label: "Same" }, { id: "b", label: "same" }] },
    { options: [{ id: "a/b", label: "A" }, { id: "b", label: "B" }] },
    { options: [{ id: "a", label: "A" }] },
  ])("rejects ambiguous or invalid option identities", ({ options }) => {
    expect(() => validateAnswerRequest({ answerType: "categorical", options })).toThrow();
  });

  it("retains independent event probabilities above a 100% total, including ties", () => {
    const rankingSpec = spec("independent_ranking", { options: OPTIONS.slice(0, 2), prior: { a: 0.7, b: 0.7 },
      searchQueries: OPTIONS.slice(0, 2).map(o => ({ targetId: o.id, query: `${o.label} spending`, keywords: [o.label, "spending"] })) });
    const checked = validateQuestionSpec(rankingSpec, "Which is most likely?", "independent_ranking", {}, AS_OF);
    const answer = initialAnswer(checked);
    if (answer.kind !== "independent_ranking") throw new Error("Expected independent ranking");
    expect(answer.probabilitiesAreIndependent).toBe(true);
    expect(answer.ranking.reduce((sum, row) => sum + row.probability, 0)).toBe(1.4);
    expect(answer.tiedIds).toEqual(["a", "b"]);
    expect(answer.ranking.map(row => row.rank)).toEqual([1, 1]);
    const updated = applyStructuredClaim(checked, answer, claim(), 1);
    expect(answerParameters(updated).a).toBeGreaterThan(0.7);
    expect(answerParameters(updated).b).toBeCloseTo(0.7, 14);
    expect(renderStructuredReport(newStructuredState("ranking", "Which is most likely?", {}, checked))).toContain("概率不归一化");
  });

  it("requires an actual research plan for every independently ranked company", () => {
    const s = spec("independent_ranking", { searchQueries: [{ targetId: "a", query: "A spending", keywords: ["A", "spending"] }] });
    expect(() => validateQuestionSpec(s, "Which is most likely?", "independent_ranking", {}, AS_OF)).toThrow(/every ranked entity/);
  });

  it("keeps 78 points as a numeric score with a rubric, never a fake probability", () => {
    const s = validateQuestionSpec(numericSpec(), numericSpec().question, "numeric", {}, AS_OF);
    const state = newStructuredState("score", s.question, {}, s);
    expect(state.answer.kind).toBe("numeric");
    expect(answerLabel(state.answer)).toBe("78 points");
    expect(state).not.toHaveProperty("currentProb");
    expect(state.answer).not.toHaveProperty("probability");
    const report = renderStructuredReport(state);
    expect(report).toContain("78 points");
    expect(report).toContain(s.scoreRubric);
    expect(report).not.toContain("78%");
    if (state.answer.kind !== "numeric") throw new Error("Expected numeric");
    expect(state.answer.rangeDescription).toContain("not empirically calibrated");
  });

  it.each([{ scoreRubric: null }, { minimum: null }, { maximum: null }])("requires the full scoring scale and rubric", changes => {
    expect(() => validateQuestionSpec(numericSpec(changes), numericSpec().question, "numeric", {}, AS_OF)).toThrow(/rubric/);
  });

  it("allows negative revenue growth in its original units and clips only to declared bounds", () => {
    const s = numericSpec({ question: "Predict next quarter revenue growth", unit: "% YoY", minimum: -100, maximum: null,
      scoreRubric: null, prior: { mean: -8, standardDeviation: 10 } });
    const checked = validateQuestionSpec(s, s.question, "numeric", {}, AS_OF);
    const evidence = claim({ targetIds: ["question"], effects: {}, numericSignal: { mean: -20, standardDeviation: 10 }, epistemicStatus: "estimate" });
    const answer = applyStructuredClaim(checked, initialAnswer(checked), evidence, 1);
    if (answer.kind !== "numeric") throw new Error("Expected numeric");
    expect(answer.pointEstimate).toBeCloseTo(-14);
    expect(answer.standardDeviation).toBeCloseTo(Math.sqrt(50));
    expect(answer.unit).toBe("% YoY");
    const bounded = initialAnswer(numericSpec({ prior: { mean: 99, standardDeviation: 20 } }));
    if (bounded.kind !== "numeric") throw new Error("Expected numeric");
    expect(bounded.modelRange[1]).toBe(100);
  });

  it.each([
    { answerType: "numeric", minimum: 10, maximum: 5 },
    { answerType: "numeric", minimum: Number.NEGATIVE_INFINITY },
    { answerType: "numeric", options: OPTIONS },
    { answerType: "categorical", unit: "points" },
    { answerType: "binary", options: OPTIONS },
    { answerType: "threshold" },
    { answerType: "numeric", ignoredField: true },
  ])("rejects invalid answer request fields and incompatible scales: %j", request => {
    expect(() => validateAnswerRequest(request)).toThrow();
  });

  it("pins the original question, supplied options, resolution, units and bounds", () => {
    const request: AnswerRequest = { answerType: "categorical", options: OPTIONS, resolution: "User's exact rule" };
    const checked = validateQuestionSpec(spec("categorical", { question: "A rewritten binary question", options: OPTIONS.slice(0, 2),
      resolutionCriteria: "Model replacement", asOfDate: "2025-01-01" }), "Original four-choice question", "categorical", request, AS_OF);
    expect(checked.question).toBe("Original four-choice question");
    expect(checked.options).toEqual(OPTIONS);
    expect(checked.resolutionCriteria).toBe(request.resolution);
    expect(checked.asOfDate).toBe(AS_OF);
    const numeric = validateQuestionSpec(numericSpec({ unit: "probability", minimum: -100, maximum: 1000 }), numericSpec().question,
      "numeric", { answerType: "numeric", unit: "points", minimum: 0, maximum: 100 }, AS_OF);
    expect([numeric.unit, numeric.minimum, numeric.maximum]).toEqual(["points", 0, 100]);
  });

  it("includes answer space, units and settlement scope in the resumable identity", () => {
    const q = "What happens next?";
    expect(makeEventId(q)).toBe(makeEventId(q, {}));
    expect(makeEventId(q)).toBe(makeEventId(q, { answerType: "auto" }));
    const base: AnswerRequest = { answerType: "numeric", unit: "USD", minimum: 0, resolution: "Q4 actual" };
    expect(makeEventId(q, base)).toBe(makeEventId(q, { resolution: "Q4 actual", minimum: 0, unit: "USD", answerType: "numeric" }));
    const alternatives: AnswerRequest[] = [base, { ...base, unit: "USD million" }, { ...base, minimum: -100 }, { ...base, resolution: "Q3 actual" },
      { answerType: "categorical", options: OPTIONS }, { answerType: "categorical", options: OPTIONS.slice(0, 3) },
      { answerType: "independent_ranking", options: OPTIONS }];
    expect(new Set(alternatives.map(request => makeEventId(q, request))).size).toBe(alternatives.length);
  });
});

describe("framing and evidence validation", () => {
  it.each(["Based on a sample of 150 company budget revisions.", "历史统计 150 个样本中的 30 次下调。", "n=150 shows a 20% rate."])("rejects invented empirical sample counts from tool-free framing: %s", priorRationale => {
    expect(() => validateQuestionSpec(spec("categorical", { priorRationale }), "question", "categorical", {}, AS_OF)).toThrow(/historical sample counts/);
  });

  it("accepts a transparently subjective starting prior without claiming a measured historical rate", () => {
    const priorRationale = "This is a subjective starting assumption based on broad reference-class reasoning, not a measured frequency.";
    expect(validateQuestionSpec(spec("categorical", { priorRationale }), "question", "categorical", {}, AS_OF).priorRationale).toBe(priorRationale);
  });

  it("uses a tool-free classifier for automatic routing and bypasses it for an explicit type", async () => {
    const runAgentFn = vi.fn().mockResolvedValue(result({ kind: "independent_ranking" }));
    expect(await classifyQuestion("M7公司中哪家最有可能在未来半年里下调capex", {}, { runAgentFn })).toBe("independent_ranking");
    expect(runAgentFn.mock.calls[0][1].allowedTools).toBe("");
    expect(runAgentFn.mock.calls[0][0]).toContain("not who cuts first");
    expect(await classifyQuestion("Rate quality", { answerType: "numeric" }, { runAgentFn })).toBe("numeric");
    expect(runAgentFn).toHaveBeenCalledTimes(1);
  });

  it("audits the frame without changing the supplied answer universe or permitting searches", async () => {
    const runAgentFn = vi.fn().mockResolvedValue(result(spec()));
    const framed = await frameStructuredQuestion("Original four choices", "categorical", { options: OPTIONS }, { runAgentFn, asOfDate: AS_OF });
    expect(framed.options).toEqual(OPTIONS);
    expect(framed.question).toBe("Original four choices");
    expect(runAgentFn).toHaveBeenCalledTimes(2);
    expect(runAgentFn.mock.calls.every(call => call[1].allowedTools === "")).toBe(true);
    expect(runAgentFn.mock.calls[1][0]).toContain("Independently audit");
  });

  it("retains retrieval trace, cost and usage across one corrective retry", async () => {
    const usage = { inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, webSearchRequests: 1, webFetchRequests: 0 };
    const runAgentFn = vi.fn()
      .mockResolvedValueOnce(result({ kind: "wrong" }, { searchQueries: ["first query"], searchResultUrls: new Set(["https://example.org/first"]), costUsd: 0.1, usage }))
      .mockResolvedValueOnce(result({ kind: "numeric" }, { searchQueries: ["second query"], searchResultUrls: new Set(["https://example.org/second"]), costUsd: 0.2, usage }));
    const attempts = vi.fn();
    const { value, result: combined } = await validatedCall("Classify", raw => {
      if ((raw as { kind: string }).kind !== "numeric") throw new Error("Invalid kind");
      return "numeric";
    }, { runAgentFn, onAttempt: attempts });
    expect(value).toBe("numeric");
    expect([...combined.searchResultUrls]).toEqual(["https://example.org/first", "https://example.org/second"]);
    expect(combined.searchQueries).toEqual(["first query", "second query"]);
    expect(combined.costUsd).toBeCloseTo(0.3);
    expect(combined.usage?.inputTokens).toBe(20);
    expect(combined.numTurns).toBe(2);
    expect(runAgentFn.mock.calls[1][0]).toContain('Previous response (untrusted evidence):\n{"kind":"wrong"}');
    expect(attempts).toHaveBeenCalledTimes(2);
  });

  it("fails a provider exit immediately instead of accepting a plausible JSON payload", async () => {
    const runAgentFn = vi.fn().mockResolvedValue(result({ kind: "numeric" }, { exitCode: 7 }));
    await expect(classifyQuestion("Predict growth", {}, { runAgentFn })).rejects.toThrow(/provider failed.*7/);
    expect(runAgentFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    { targetIds: ["unknown"] }, { effects: { unknown: 0.4 } }, { effects: { a: Number.NaN } }, { effects: { a: 2.01 } },
    { sourceUrl: "file:///private/key" }, { sourceUrl: "https://user:password@example.org/" },
    { publishedAt: "2026-09-14" }, { quote: "x".repeat(301) }, { numericSignal: { mean: 10, standardDeviation: 2 } },
  ] as Array<Partial<StructuredClaim>>)("rejects out-of-contract evidence before applying updates: %j", changes => {
    expect(() => validateStructuredRound(round(claim(changes)), spec())).toThrow();
  });

  it("rejects evidence dates that are not real calendar dates", () => {
    expect(() => validateStructuredRound(round(claim({ publishedAt: "2026-02-30" })), spec())).toThrow(/date/i);
  });

  it("rejects a company claim attempting to update a different independent company", () => {
    expect(() => validateStructuredRound(round(claim({ targetIds: ["a"], effects: { b: 0.8 } })), spec("independent_ranking"))).toThrow(/named entities/);
  });

  it("rejects out-of-scale numerical signals and does not turn historical context into a forecast", () => {
    expect(() => validateStructuredRound(round(claim({ targetIds: ["question"], effects: {}, numericSignal: { mean: 101, standardDeviation: 4 } })), numericSpec())).toThrow(/scale/);
    const before = initialAnswer(numericSpec());
    const after = applyStructuredClaim(numericSpec(), before, claim({ effects: {}, targetIds: ["question"], numericSignal: null }), 1);
    expect(after).toEqual(before);
    expect(answerMovement(before, after)).toBe(0);
  });
});
