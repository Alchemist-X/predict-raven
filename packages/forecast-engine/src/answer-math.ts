// Engine-owned updates: normalized categorical weights, independent logits,
// or normal precision updates for numerical forecasts. No fake binary scalar.
import type { QuestionSpec, StructuredAnswer, StructuredClaim } from "./answer-types";

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
const boundProbability = (p: number) => Math.max(0.001, Math.min(0.999, p));
export function fromParameters(spec: QuestionSpec, parameters: Record<string, number>): StructuredAnswer {
  if (spec.kind === "numeric") {
    const mean = parameters.mean, sd = parameters.standardDeviation;
    const clip = (n: number) => Math.max(spec.minimum ?? -Infinity, Math.min(spec.maximum ?? Infinity, n));
    return {kind: "numeric", pointEstimate: clip(mean), standardDeviation: sd, unit: spec.unit!,
      modelRange: [clip(mean - 1.2815515655 * sd), clip(mean + 1.2815515655 * sd)],
      rangeDescription: "Normal-model 10th–90th percentile range, clipped to the declared scale; assumption-based, not empirically calibrated."};
  }
  const ordered = spec.options.map(option => ({...option, probability: parameters[option.id]})).sort((a, b) => b.probability - a.probability || a.id.localeCompare(b.id));
  const tiedIds = ordered.filter(row => Math.abs(row.probability - ordered[0].probability) < 1e-12).map(row => row.id);
  if (spec.kind === "categorical") return {kind: "categorical", selectedId: ordered[0].id, tiedIds, probabilities: spec.options.map(option => ({...option, probability: parameters[option.id]}))};
  if (spec.kind !== "independent_ranking") throw new Error("Binary questions must use the binary engine");
  return {kind: "independent_ranking", selectedId: ordered[0].id, tiedIds, probabilitiesAreIndependent: true,
    ranking: ordered.map((row, i) => ({...row, rank: ordered.findIndex(r => Math.abs(r.probability - row.probability) < 1e-12) + 1}))};
}
export function answerParameters(answer: StructuredAnswer): Record<string, number> {
  if (answer.kind === "numeric") return {mean: answer.pointEstimate, standardDeviation: answer.standardDeviation};
  return Object.fromEntries((answer.kind === "categorical" ? answer.probabilities : answer.ranking).map(row => [row.id, row.probability]));
}
export function initialAnswer(spec: QuestionSpec): StructuredAnswer { return fromParameters(spec, spec.prior); }
export function applyStructuredClaim(spec: QuestionSpec, before: StructuredAnswer, claim: StructuredClaim, weight: number): StructuredAnswer {
  if (weight === 0) return structuredClone(before);
  const p = answerParameters(before);
  if (spec.kind === "numeric") {
    if (!claim.numericSignal || weight <= 0) return structuredClone(before);
    const precision = 1 / (p.standardDeviation ** 2), newPrecision = weight / (claim.numericSignal.standardDeviation ** 2);
    return fromParameters(spec, {mean: (p.mean * precision + claim.numericSignal.mean * newPrecision) / (precision + newPrecision), standardDeviation: Math.sqrt(1 / (precision + newPrecision))});
  }
  const effect = (id: string) => Math.max(-1, Math.min(1, claim.effects[id] ?? 0)) * weight;
  if (spec.kind === "independent_ranking") return fromParameters(spec, Object.fromEntries(spec.options.map(o => [o.id, boundProbability(logistic(logit(p[o.id]) + effect(o.id)))])));
  const logs = spec.options.map(o => Math.log(p[o.id]) + effect(o.id));
  const max = Math.max(...logs), weights = logs.map(x => Math.exp(x - max)), sum = weights.reduce((a, b) => a + b, 0);
  return fromParameters(spec, Object.fromEntries(spec.options.map((o, i) => [o.id, weights[i] / sum])));
}
export function answerMovement(a: StructuredAnswer, b: StructuredAnswer): number {
  if (a.kind === "numeric" && b.kind === "numeric") return Math.abs(a.pointEstimate - b.pointEstimate) / Math.max(a.standardDeviation, 1e-9);
  const x = answerParameters(a), y = answerParameters(b);
  return Math.max(...Object.keys(x).map(id => Math.abs(x[id] - y[id])));
}
