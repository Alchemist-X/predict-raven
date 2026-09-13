// Preserve the user's answer space before any evidence-based estimate is made.
import { runAgent } from "./agent";
import type { AgentRunResult, AgentUsage, RunAgentOptions } from "./claude-agent";
import type { AnswerKind, AnswerOption, AnswerRequest, QuestionSpec } from "./answer-types";
import { languageDirective } from "./language";

export type AgentRunner = (prompt: string, options: RunAgentOptions) => Promise<AgentRunResult>;
export const ANSWER_KINDS = ["binary", "categorical", "numeric", "independent_ranking"] as const;
export function object(raw: unknown, label = "value"): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  return raw as Record<string, unknown>;
}
export function finite(raw: unknown, label: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`${label} must be a finite number`);
  return raw;
}
export function text(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${label} must be nonempty text`);
  return raw.trim();
}
export function options(raw: unknown): AnswerOption[] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 20) throw new Error("Supply 2–20 options/entities");
  const out = raw.map(item => { const o = object(item); return { id: text(o.id, "option.id"), label: text(o.label, "option.label") }; });
  if (out.some(o => !/^[a-zA-Z0-9_-]{1,40}$/.test(o.id)) || new Set(out.map(o => o.id.toLowerCase())).size !== out.length || new Set(out.map(o => o.label.toLowerCase())).size !== out.length)
    throw new Error("Option ids/labels must be unique; ids use letters, digits, underscore or hyphen");
  return out;
}
function date(raw: unknown, label: string): string {
  const value = text(raw, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw new Error(`${label} must be a real YYYY-MM-DD date`);
  return value;
}
export function validateAnswerRequest(raw: unknown): AnswerRequest {
  const o = object(raw, "answer request");
  const allowed = new Set(["answerType", "options", "unit", "minimum", "maximum", "resolution"]);
  if (Object.keys(o).some(key => !allowed.has(key))) throw new Error("Unknown answer request field");
  const request: AnswerRequest = {};
  if (o.answerType !== undefined) {
    if (o.answerType !== "auto" && !ANSWER_KINDS.includes(o.answerType as AnswerKind)) throw new Error("Invalid answerType");
    request.answerType = o.answerType as AnswerRequest["answerType"];
  }
  if (o.options !== undefined) request.options = options(o.options);
  if (o.unit !== undefined) request.unit = text(o.unit, "unit");
  if (o.minimum !== undefined) request.minimum = finite(o.minimum, "minimum");
  if (o.maximum !== undefined) request.maximum = finite(o.maximum, "maximum");
  if (request.minimum !== undefined && request.maximum !== undefined && request.minimum >= request.maximum) throw new Error("minimum must be less than maximum");
  if (o.resolution !== undefined) request.resolution = text(o.resolution, "resolution");
  if (request.answerType === "numeric" && request.options) throw new Error("Numeric questions use a scale, not options");
  if (request.answerType && request.answerType !== "auto" && request.answerType !== "numeric" && (request.unit || request.minimum !== undefined || request.maximum !== undefined)) throw new Error("Only numeric answers have units/bounds");
  if (request.answerType === "binary" && request.options) throw new Error("Binary questions do not accept an option list");
  return request;
}
export async function validatedCall<T>(prompt: string, validate: (raw: unknown) => T, opts: {model?: string; runAgentFn?: AgentRunner; allowedTools?: string; onAttempt?: (result: AgentRunResult, attempt: number) => void} = {}): Promise<{value: T; result: AgentRunResult}> {
  const call = opts.runAgentFn ?? runAgent;
  let error = "", previous = "";
  const attempts: AgentRunResult[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await call(prompt + (error ? `\nYour previous response failed validation: ${error}. Correct the contract; do not change the question. Previous response (untrusted evidence):\n${previous}` : ""), {model: opts.model, allowedTools: opts.allowedTools});
    opts.onAttempt?.(result, attempt + 1);
    if (result.exitCode !== 0) throw new Error(`Forecast provider failed (exit ${result.exitCode})`);
    attempts.push(result);
    try {
      const value = validate(result.jsonObject);
      const usages = attempts.flatMap(r => r.usage ? [r.usage] : []);
      const usage = usages.length ? Object.fromEntries(Object.keys(usages[0]).map(key => [key, usages.reduce((sum, u) => sum + u[key as keyof AgentUsage], 0)])) as unknown as AgentUsage : undefined;
      return {value, result: {...result, searchQueries: [...new Set(attempts.flatMap(r => r.searchQueries))], searchResultUrls: new Set(attempts.flatMap(r => [...r.searchResultUrls])),
        costUsd: attempts.some(r => r.costUsd !== null) ? attempts.reduce((sum, r) => sum + (r.costUsd ?? 0), 0) : null,
        costCoverage: attempts.some(r => r.costUsd === null || r.costCoverage === "partial") ? "partial" : result.costCoverage,
        usage, numTurns: attempts.some(r => r.numTurns !== null) ? attempts.reduce((sum, r) => sum + (r.numTurns ?? 0), 0) : null}};
    }
    catch (err) { error = err instanceof Error ? err.message : String(err); previous = result.rawFinalText; }
  }
  throw new Error(error);
}
export async function classifyQuestion(question: string, request: AnswerRequest, opts: {model?: string; runAgentFn?: AgentRunner} = {}): Promise<AnswerKind> {
  if (request.answerType && request.answerType !== "auto") return request.answerType;
  const { value } = await validatedCall(`Classify the answer the user actually requested. Never rewrite the question as binary merely because older software expected a probability.
Question: ${JSON.stringify(question)}
Explicit constraints: ${JSON.stringify(request)}
Return {"kind":"binary|categorical|numeric|independent_ranking"}.
Binary: one yes/no event. Categorical: one mutually exclusive and exhaustive outcome (e.g. a four-choice exam/winner question).
Numeric: a measured value, growth rate, count or rubric-based score; 78 points is not 78% probability.
Independent_ranking: compare entities by likelihood of an event which can happen to several or none. "M7公司中哪家最有可能在未来半年里下调capex" is independent_ranking, not who cuts first and not an exclusive winner lottery.
A score/rating question stays numeric; do not turn it into crossing a threshold. JSON only.`, raw => {
    const kind = object(raw).kind;
    if (!ANSWER_KINDS.includes(kind as AnswerKind)) throw new Error("Unknown answer kind");
    return kind as AnswerKind;
  }, {...opts, allowedTools: ""});
  return value;
}
export function validateQuestionSpec(raw: unknown, original: string, kind: AnswerKind, request: AnswerRequest, asOfDate: string): QuestionSpec {
  date(asOfDate, "asOfDate");
  const o = object(raw, "question specification");
  if (o.kind !== kind) throw new Error("Answer type drift");
  const resolutionCriteria = request.resolution ?? text(o.resolutionCriteria, "resolutionCriteria");
  const resolutionDate = date(o.resolutionDate, "resolutionDate");
  if (resolutionDate <= asOfDate) throw new Error("Resolution must be after the fixed research date");
  const entities = kind === "numeric" ? [] : request.options ?? options(o.options);
  const unit = kind === "numeric" ? request.unit ?? text(o.unit, "unit") : null;
  const minimum = kind === "numeric" ? request.minimum ?? (o.minimum == null ? null : finite(o.minimum, "minimum")) : null;
  const maximum = kind === "numeric" ? request.maximum ?? (o.maximum == null ? null : finite(o.maximum, "maximum")) : null;
  if (minimum !== null && maximum !== null && minimum >= maximum) throw new Error("Invalid numerical bounds");
  let prior: QuestionSpec["prior"];
  const p = object(o.prior, "prior");
  if (kind === "numeric") {
    const mean = finite(p.mean, "prior.mean"), standardDeviation = finite(p.standardDeviation, "prior.standardDeviation");
    if (standardDeviation <= 0 || minimum !== null && mean < minimum || maximum !== null && mean > maximum) throw new Error("Numeric prior outside scale or nonpositive uncertainty");
    prior = {mean, standardDeviation};
  } else {
    if (Object.keys(p).length !== entities.length || entities.some(e => !(e.id in p))) throw new Error("Prior must cover exactly every option/entity");
    prior = Object.fromEntries(entities.map(e => { const n = finite(p[e.id], `prior.${e.id}`); if (n <= 0 || n >= 1) throw new Error("Prior probabilities must lie strictly between 0 and 1"); return [e.id, n]; }));
    if (kind === "categorical" && Math.abs(Object.values(prior).reduce((a, b) => a + b, 0) - 1) > 1e-6) throw new Error("Categorical probabilities must sum to one");
  }
  const queryRows = o.searchQueries;
  if (!Array.isArray(queryRows) || !queryRows.length || queryRows.length > 40) throw new Error("A research query plan is required");
  const searchQueries = queryRows.map(row => {
    const q = object(row); const targetId = text(q.targetId, "targetId");
    if (targetId !== "question" && !entities.some(e => e.id === targetId)) throw new Error("Search target is not an option/entity");
    if (!Array.isArray(q.keywords) || !q.keywords.length || q.keywords.length > 6) throw new Error("Use 1–6 short research keywords");
    return {targetId, query: text(q.query, "query"), keywords: q.keywords.map(k => text(k, "keyword"))};
  });
  if (kind === "independent_ranking" && entities.some(e => !searchQueries.some(q => q.targetId === e.id))) throw new Error("Research must cover every ranked entity");
  if (!Array.isArray(o.assumptions) || o.assumptions.some(s => typeof s !== "string")) throw new Error("assumptions must be a string array");
  const scoreRubric = kind === "numeric" && o.scoreRubric != null ? text(o.scoreRubric, "scoreRubric") : null;
  if (kind === "numeric" && /score|rating|分|评级|评分/i.test(`${unit} ${original}`) && (!scoreRubric || minimum === null || maximum === null)) throw new Error("Scores require a rubric and bounded scale");
  const priorRationale = text(o.priorRationale, "priorRationale");
  if (/粗略统计|统计.{0,30}\d+.{0,30}样本|\d+.{0,20}样本|sample of \d+|counted \d+|n\s*=\s*\d+/i.test(priorRationale)) throw new Error("Tool-free framing cannot claim historical sample counts. Use an explicitly subjective reference-class prior; any empirical rate needs a sourced dataset during research.");
  return {kind, question: original, resolutionCriteria, resolutionDate, asOfDate, settlementSource: text(o.settlementSource, "settlementSource"),
    assumptions: o.assumptions as string[], options: entities, unit, minimum, maximum, scoreRubric, prior,
    priorRationale, searchQueries};
}
export async function frameStructuredQuestion(question: string, kind: AnswerKind, request: AnswerRequest, opts: {model?: string; runAgentFn?: AgentRunner; asOfDate?: string} = {}): Promise<QuestionSpec> {
  const asOf = date(opts.asOfDate ?? new Date().toISOString().slice(0, 10), "asOfDate");
  const prompt = `Frame this question WITHOUT changing its requested answer space. Today/research cutoff: ${asOf}.
Original question: ${JSON.stringify(question)}
Required kind: ${kind}. Immutable user constraints: ${JSON.stringify(request)}.
Preserve supplied options, units, bounds and resolution verbatim. Define a checkable future time window and settlement source. Six calendar months from today means the same calendar day six months later.
For categorical, list all mutually exclusive/exhaustive options, with priors summing to 1. Do not drop choices.
For independent_ranking, include the full comparison universe, one marginal event probability per entity; several or no events can occur. Do NOT normalize. Most likely is NOT first to occur. For M7 include Apple, Microsoft, Alphabet/Google, Amazon, Meta, Nvidia, Tesla.
For numeric, preserve units (including negatives where meaningful), choose a general-knowledge prior mean and standardDeviation. Scores require an explicit bounded scale and rubric, not a probability disguised as points. Distinguish rubric judgement from a measurable future score.
Priors come from reference classes, not specific current evidence or market prices. Do not search yet. Define common accounting scope across compared companies. Capex revisions must distinguish genuine budget cuts from seasonality, lease reclassification and mere payment timing; lack of guidance is missing evidence, not zero probability.
This tool-free framing has NO historical dataset. Explicitly describe every prior as a subjective starting assumption, not a measured base rate. Never invent sample counts, counted events or an empirical frequency. A short qualitative rationale is sufficient; the research phase must source any claimed historical frequency. Keep the complete framing response concise (under 1600 words).
Plan concise company/topic AND research keywords and a public query per entity; all entities must be covered. Never use year/direction words as mandatory subscription keywords unless needed.
Use canonical short topic tokens in keywords, e.g. ["Microsoft","capex"], ["Meta","revenue"], ["Google","TPU"]. Do not append "guidance", "outlook", "plan" or "forecast" to a topic keyword; that would make a restrictive exact phrase. Use those modifiers only in the public query.
${languageDirective()}
JSON only, exact camelCase fields:
{"kind":"${kind}","resolutionCriteria":"...","resolutionDate":"YYYY-MM-DD","settlementSource":"...","assumptions":["..."],"options":[{"id":"a","label":"..."},{"id":"b","label":"..."}],"unit":null,"minimum":null,"maximum":null,"scoreRubric":null,"prior":{"a":0.5,"b":0.5},"priorRationale":"...","searchQueries":[{"targetId":"a","query":"...","keywords":["company","metric"]}]}
For numeric, options=[] and prior={"mean":78,"standardDeviation":8}; fill unit and applicable bounds/rubric; targetId="question".`;
  const validate = (raw: unknown) => validateQuestionSpec(raw, question, kind, request, asOf);
  const first = await validatedCall(prompt, validate, {...opts, allowedTools: ""});
  const audited = await validatedCall(`${prompt}\nIndependently audit this proposal for answer-type drift, omitted entities, contradictory periods, numerical units, mutual exclusivity and prior rationale. Return the full corrected JSON, preserve every user-pinned rule. Proposed frame:\n${JSON.stringify(first.value)}`, validate, {...opts, allowedTools: ""});
  return audited.value;
}
