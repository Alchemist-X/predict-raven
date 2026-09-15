// Final whole-forecast synthesis (after the last round).
//
// A multi-round run leaves the reader with per-round deltas but no overall read.
// This step asks the agent to synthesize the WHOLE forecast into a verdict: why
// the final probability landed where it did, the strongest factors each way, and
// the open uncertainties. RED LINE: it EXPLAINS the engine's number — it does not
// re-decide it, and it introduces no new evidence (synthesis only, no search).

import { runAgent } from "./agent";
import { extractJsonObject } from "./claude-agent";
import { languageDirective } from "./language";
import { applyResearchReview, parseResearchReview, researchReviewPrompt, modelVisibleSourceUrls, researchGapSources } from "./research-review";
import type { AgentRunResult, RunAgentOptions } from "./claude-agent";
import type { ForecastState, ForecastSummary } from "./types";

const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;
const signed = (pp: number): string => `${pp >= 0 ? "+" : ""}${pp.toFixed(1)}pp`;

function buildSummaryPrompt(state: ForecastState): string {
  // Numbered "evidence book": two-digit global index in ledger order, so the
  // verdict prose can cite [NN] and the UI can anchor-link narrative → source.
  const ledger =
    state.evidenceLedger.length === 0
      ? "(no evidence gathered)"
      : state.evidenceLedger
          .map(
            (e, i) =>
              `[${String(i + 1).padStart(2, "0")}] [quality ${e.qualityScore ?? "unscored"}, ${e.crossCheckStatus ?? "legacy"}, ${e.stance}, ${signed(e.deltaPp)}${
                e.kind === "reflection" ? ", reflection" : ""
              }] ${e.claim} — best source: ${e.title || e.url} (${e.url}); ${e.sources?.length ?? 1} selected source(s)`
          )
          .join("\n");

  const plan = state.researchPlan;
  return `You are compiling a decision-first forecasting report from a completed research record. Explain the engine's single final probability and the current evidence. Do not narrate iterations, earlier drafts, processing user feedback, or before/after probability changes. Do not change the number, do not introduce new evidence, do not search, and never offer an alternative probability or range.

EVENT: ${state.framing.normalizedQuestion}
RESOLUTION CRITERIA: ${state.framing.resolutionCriteria}
RESOLUTION DATE: ${state.framing.resolutionDate ?? "(open-ended)"}
FINAL P(YES): ${pct(state.currentProb)}
QUESTION TYPE: ${plan?.archetype ?? "not classified"}
SINGLE PROBABILITY MODEL: ${plan?.modelKind ?? "binary_bayesian"} — ${plan?.modelRationale ?? "one maintained binary estimate"}
EVENT DECOMPOSITION: ${plan?.decomposition.join(" | ") ?? "not available"}

EVIDENCE LEDGER (every counted source, numbered [NN], with its effect on P(YES)):
${ledger}

When the verdict prose references a specific source, cite it inline as [NN] — its two-digit index in the ledger above.

RULES:
- When comparing numbers, write the arithmetic explicitly (e.g. "32.57 of 60 ≈ 55%") — never a vague fraction like "roughly a third" without the division.
- Every key_factors_yes / key_factors_no item must describe a scenario that would actually satisfy (or block) the RESOLUTION CRITERIA; if a factor concerns an excluded/non-qualifying scenario, either omit it or explicitly mark it "(indirect)".
- Prefer the highest-quality, directly relevant, independently checked claims. Explain material source limitations instead of hiding them.
- Scenarios explain paths and implications; they must not contain replacement probability estimates.
- Monitoring signals must name an observable trigger and the model component it would affect.
- Information gaps must say how a human or future run could retrieve the missing evidence.

OUTPUT only a single JSON object — no prose, no code fence:
{
  "verdict": "1-2 paragraphs: the overall read — why P(YES) landed at ${pct(state.currentProb)}, the balance of evidence, citing sources inline as [NN]",
  "key_factors_yes": ["strongest factors pushing toward YES"],
  "key_factors_no": ["strongest factors pushing toward NO"],
  "main_uncertainties": "what is unresolved or could move this before the resolution date",
  "calibration_note": "if you think the computed probability is materially mis-calibrated, say so and why — but do NOT assert a different number as the answer; otherwise empty string",
  "why_sentence": "ONE complete, self-explaining sentence — the single reason the number landed where it did, naming the decisive evidence; no fragment",
  "quip": "one short dry human aside reacting to the verdict — personality, not advice",
  "confidence_reason": "one line on why confidence is high/medium/low",
  "probability_model_explanation": "plain-language explanation of the one adopted model and how the evidence enters it; no alternative number",
  "scenarios": [{"name":"...","description":"...","implication":"how this path affects the adopted forecast without assigning another probability"}],
  "monitoring_signals": [{"signal":"observable trigger","direction":"raises|lowers|mixed","component":"which part of the model changes"}],
  "information_gaps": [{"gap":"missing evidence","importance":"why it matters","retrieval_path":"how to obtain it"}],
  "glossary": [{"term":"an abbreviation or specialist term that had to be used","definition":"full plain-language meaning"}]
}
${researchReviewPrompt(state)}
If synthesis exposes a material unresolved question, request another research pass in research_gaps. Do not add unresearched assertions to the verdict. Use targetIds=["question"] for this binary event.
${languageDirective()}`;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

// New display fields are optional strings (default undefined); never throw on them.
function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function objectArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : [];
}

export class InvalidResearchSummary extends Error {}
function summaryReview(o: Record<string, unknown>) {
  try { return parseResearchReview(o, ["question"]); }
  catch (error) { throw new InvalidResearchSummary(error instanceof Error ? error.message : "Invalid summary research review"); }
}

export function validateSummary(raw: unknown): ForecastSummary {
  if (!raw || typeof raw !== "object") throw new Error("summary output is not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.verdict !== "string" || !o.verdict.trim()) throw new Error("summary.verdict missing");
  return {
    ...(o.research_gaps !== undefined || o.gap_resolutions !== undefined ? {researchFollowup:summaryReview(o)} : {}),
    verdict: o.verdict.trim(),
    keyFactorsYes: strArray(o.key_factors_yes),
    keyFactorsNo: strArray(o.key_factors_no),
    mainUncertainties: typeof o.main_uncertainties === "string" ? o.main_uncertainties : "",
    calibrationNote: typeof o.calibration_note === "string" ? o.calibration_note : "",
    whySentence: optStr(o.why_sentence),
    quip: optStr(o.quip),
    confidenceReason: optStr(o.confidence_reason),
    probabilityModelExplanation: optStr(o.probability_model_explanation),
    scenarios: objectArray(o.scenarios)
      .map((x) => ({
        name: optStr(x.name) ?? "",
        description: optStr(x.description) ?? "",
        implication: optStr(x.implication) ?? ""
      }))
      .filter((x) => x.name && x.description),
    monitoringSignals: objectArray(o.monitoring_signals)
      .map((x) => {
        const direction: "raises" | "lowers" | "mixed" =
          x.direction === "raises" || x.direction === "lowers" || x.direction === "mixed" ? x.direction : "mixed";
        return {
          signal: optStr(x.signal) ?? "",
          direction,
          component: optStr(x.component) ?? ""
        };
      })
      .filter((x) => x.signal),
    informationGaps: objectArray(o.information_gaps)
      .map((x) => ({
        gap: optStr(x.gap) ?? "",
        importance: optStr(x.importance) ?? "",
        retrievalPath: optStr(x.retrieval_path) ?? ""
      }))
      .filter((x) => x.gap),
    glossary: objectArray(o.glossary)
      .map((x) => ({ term: optStr(x.term) ?? "", definition: optStr(x.definition) ?? "" }))
      .filter((x) => x.term && x.definition)
  };
}

export async function summarizeForecast(
  state: ForecastState,
  opts: { model?: string; runAgentFn?: (prompt: string, opts: RunAgentOptions) => Promise<AgentRunResult> } = {}
): Promise<ForecastSummary> {
  const prompt = buildSummaryPrompt(state);
  const callAgent = opts.runAgentFn ?? runAgent;
  const validate = (result: AgentRunResult) => {
    if (result.exitCode !== 0) throw new Error(`Summary provider failed with exit code ${result.exitCode}: ${result.stderrTail}`);
    const summary = validateSummary(result.jsonObject ?? extractJsonObject(result.rawFinalText));
    if (summary.researchFollowup) {
      try {
        applyResearchReview({researchGaps:state.researchGaps}, summary.researchFollowup, state.round,
          modelVisibleSourceUrls(state));
      } catch (error) { throw new InvalidResearchSummary(error instanceof Error ? error.message : "Invalid summary research review"); }
    }
    return summary;
  };
  // Synthesis can request another evidence pass, but cannot invent evidence itself.
  let res = await callAgent(prompt, { model: opts.model, allowedTools: "" });
  try {
    return validate(res);
  } catch {
    res = await callAgent(prompt, { model: opts.model, allowedTools: "" });
    return validate(res);
  }
}
