// Round 0 — event framing (with a self-estimated prior and a skeptical audit).
//
// A free-text user prompt is not yet a well-posed forecastable event: the
// resolution window, the exact YES/NO bar, and the settlement source are all
// implicit. Before any probability is estimated, the agent (may WebSearch for
// dates/context) frames it explicitly AND states a base-rate prior from its own
// knowledge. Because a drifted YES/NO bar or a wrong forecastable verdict
// silently corrupts every downstream round (P0-1), a second, independent
// skeptical pass audits the frame and may correct it.

import { providerHasWebSearch, runAgent } from "./agent";
import { extractJsonObject } from "./claude-agent";
import { languageDirective } from "./language";
import { marketBlind, marketBlindDirective, mentionsMarketPricing } from "./market-blind";
import type { EventFraming } from "./types";

// Provider-aware research line: a search-less provider must not be told to
// WebSearch — it frames from its own knowledge and states uncertainty honestly.
const NO_WEB_LINE =
  "You have no web access; use your own knowledge and state uncertainty honestly in assumptions/framingCaveats.";

function pinnedResolutionDirective(userResolution: string | null): string {
  return userResolution
    ? `\nUSER-SPECIFIED RESOLUTION (authoritative — immutable rules):\n"${userResolution}"\nCopy it verbatim into resolution_criteria. Do not rewrite, translate, add, remove, or narrow its conditions, comparison operators, or timing. Other frame fields may clarify metadata only; they must not introduce rules that contradict or qualify this resolution.\n`
    : "";
}

function buildFramingPrompt(question: string, userResolution: string | null, hasWebSearch: boolean): string {
  const pinned = pinnedResolutionDirective(userResolution);
  const research = hasWebSearch
    ? "You MAY use WebSearch to look up dates, definitions, or context needed to frame this well."
    : NO_WEB_LINE;
  return `You are a forecasting question editor. The user gave a rough description of a future event they want a probability for. BEFORE any forecasting, turn it into a precise, well-posed BINARY (yes/no) question with explicit resolution, and state a base-rate prior.

USER PROMPT: "${question}"${pinned}
${research} Do not estimate the full evidence-based probability yet — only frame the question and give a BASE-RATE prior.

Produce:
- normalized_question: a crisp question answerable strictly YES or NO.
- resolution_criteria: exactly what counts as YES and what counts as NO, including edge cases.
- resolution_date: the date (YYYY-MM-DD) by which the event must occur for YES; infer a sensible one if unstated, null only if genuinely open-ended.
- settlement_source: the authoritative source that would confirm the real outcome.
- assumptions: assumptions you made (timezone, definitions, scope).
- forecastable: true if this can be sensibly forecast as a binary event with a checkable resolution; false if too vague/subjective/unresolvable.
- clarification_needed: if forecastable is false, what the user must specify; else "".
- prior_probability: your PRIOR P(YES) in [0,1] from GENERAL KNOWLEDGE / a reference class ONLY — the base rate BEFORE weighing specific current evidence (e.g. "a named product shipping by a pre-announced date ~0.55", "a specific bilateral ceasefire holding 6 months ~0.3"). Not 0.5 unless the reference class truly is a coin flip.
- prior_rationale: the reference class and why that base rate.
${marketBlindDirective()}${languageDirective()}
OUTPUT only a single JSON object, no prose, no code fence:
{"normalized_question":"...","resolution_criteria":"...","resolution_date":"2026-12-31","settlement_source":"...","assumptions":"...","forecastable":true,"clarification_needed":"","prior_probability":0.45,"prior_rationale":"..."}`;
}

function buildAuditPrompt(
  question: string,
  frame: EventFraming,
  hasWebSearch: boolean,
  userResolution: string | null,
  violationNotice = ""
): string {
  const research = hasWebSearch ? "You MAY WebSearch to check dates/definitions." : NO_WEB_LINE;
  const auditInstruction = userResolution
    ? "Audit the frame independently while preserving the USER-SPECIFIED RESOLUTION verbatim. Correct other fields only when consistent with those immutable rules. If the user's rules have ambiguities or raise concerns, report them in framing_caveats without changing the rules."
    : "Re-derive the frame independently. Return a CORRECTED frame (keep it if already correct), PLUS an honest audit. Be strict: if the resolution bar is ambiguous or unfaithful to the user's intent, fix it and say so in framing_caveats.";
  return `You are a SKEPTICAL forecasting-question auditor. Another editor framed a user's prompt into a binary question. Your job is to catch errors that would make the whole forecast quantify the WRONG question: an ambiguous or drifted YES/NO bar, an inverted edge case, a wrong resolution date, a mis-judged forecastable verdict, or a base-rate prior that ignores the reference class. ${research}

ORIGINAL USER PROMPT: "${question}"${pinnedResolutionDirective(userResolution)}
PROPOSED FRAME:
- normalized_question: ${frame.normalizedQuestion}
- resolution_criteria: ${frame.resolutionCriteria}
- resolution_date: ${frame.resolutionDate ?? "(none)"}
- forecastable: ${frame.forecastable}
- prior_probability: ${frame.priorProbability}
- prior_rationale: ${frame.priorRationale}
${violationNotice}
${auditInstruction}
${marketBlindDirective()}${languageDirective()}
OUTPUT only a single JSON object, no prose, no code fence:
{"normalized_question":"...","resolution_criteria":"...","resolution_date":"2026-12-31","settlement_source":"...","assumptions":"...","forecastable":true,"clarification_needed":"","prior_probability":0.45,"prior_rationale":"...","framing_caveats":"edge cases / ambiguities the user should know, or '' if none","framing_confidence":"high|medium|low"}`;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

function coreFraming(raw: unknown): Omit<EventFraming, "framingCaveats" | "framingConfidence"> {
  if (!raw || typeof raw !== "object") throw new Error("framing output is not an object");
  const o = raw as Record<string, unknown>;
  if (typeof o.normalized_question !== "string" || !o.normalized_question.trim())
    throw new Error("framing.normalized_question missing");
  if (typeof o.resolution_criteria !== "string" || !o.resolution_criteria.trim())
    throw new Error("framing.resolution_criteria missing");
  if (typeof o.forecastable !== "boolean") throw new Error("framing.forecastable must be boolean");
  const rd = o.resolution_date;
  const resolutionDate =
    typeof rd === "string" && rd.trim() && rd.trim().toLowerCase() !== "null" ? rd.trim() : null;
  return {
    normalizedQuestion: o.normalized_question.trim(),
    resolutionCriteria: o.resolution_criteria.trim(),
    resolutionDate,
    settlementSource: typeof o.settlement_source === "string" ? o.settlement_source : "",
    assumptions: typeof o.assumptions === "string" ? o.assumptions : "",
    forecastable: o.forecastable,
    clarificationNeeded: typeof o.clarification_needed === "string" ? o.clarification_needed : "",
    priorProbability: num(o.prior_probability, 0.5),
    priorRationale: typeof o.prior_rationale === "string" ? o.prior_rationale : "",
  };
}

export function validateFraming(raw: unknown): EventFraming {
  return { ...coreFraming(raw), framingCaveats: "", framingConfidence: "medium" };
}

const CONF = new Set(["high", "medium", "low"]);
export function validateAudit(raw: unknown): EventFraming {
  const core = coreFraming(raw);
  const o = raw as Record<string, unknown>;
  const conf = CONF.has(o.framing_confidence as string)
    ? (o.framing_confidence as EventFraming["framingConfidence"])
    : "medium";
  return {
    ...core,
    framingCaveats: typeof o.framing_caveats === "string" ? o.framing_caveats : "",
    framingConfidence: conf,
  };
}

export interface FrameResult {
  framing: EventFraming;
  searchQueries: string[];
  costUsd: number | null;
  // Market-blind mode only: the prior rationale still reads market-price-
  // anchored after one corrective re-audit — the edge computed downstream from
  // this forecast should be treated as contaminated.
  priorSuspect: boolean;
}

async function runValidated<T>(
  prompt: string,
  validate: (raw: unknown) => T,
  model?: string
): Promise<{ value: T; searchQueries: string[]; costUsd: number | null }> {
  let res = await runAgent(prompt, { model });
  try {
    return { value: validate(res.jsonObject ?? extractJsonObject(res.rawFinalText)), searchQueries: res.searchQueries, costUsd: res.costUsd };
  } catch {
    res = await runAgent(prompt, { model });
    return { value: validate(res.jsonObject ?? extractJsonObject(res.rawFinalText)), searchQueries: res.searchQueries, costUsd: res.costUsd };
  }
}

export async function frameEvent(
  question: string,
  opts: { userResolution?: string | null; model?: string } = {}
): Promise<FrameResult> {
  const hasWebSearch = providerHasWebSearch();
  const userResolution = opts.userResolution?.trim() || null;
  // Enforce the user's rules after every validated model response, including
  // retries. Prompts alone cannot prevent an editor or auditor from drifting.
  const pinResolution = (frame: EventFraming): EventFraming =>
    userResolution === null ? frame : { ...frame, resolutionCriteria: userResolution };
  const validatePinnedFraming = (raw: unknown) => pinResolution(validateFraming(raw));
  const validatePinnedAudit = (raw: unknown) => pinResolution(validateAudit(raw));
  // Pass 1: frame + base-rate prior.
  const first = await runValidated(buildFramingPrompt(question, userResolution, hasWebSearch), validatePinnedFraming, opts.model);
  // Pass 2 (P0-1): independently audit the frame, preserving any pinned rules.
  let audited = await runValidated(buildAuditPrompt(question, first.value, hasWebSearch, userResolution), validatePinnedAudit, opts.model);
  let totalCost = (first.costUsd ?? 0) + (audited.costUsd ?? 0);
  let allQueries = [...first.searchQueries, ...audited.searchQueries];
  let priorSuspect = false;

  // Market-blind guard (review 2026-07-06): the audit pass itself was a prior
  // contaminator — it looked up the live market price and "corrected" the prior
  // to it. When the audited rationale reads market-anchored, re-run the audit
  // ONCE with an explicit violation notice; if it still does, keep the frame
  // but flag it so downstream consumers can discount the edge.
  if (marketBlind() && mentionsMarketPricing(audited.value.priorRationale)) {
    const notice =
      "\nVIOLATION NOTICE: the previous audit's prior_rationale anchored on prediction-market prices, which is forbidden here. Re-derive prior_probability STRICTLY from a reference class of comparable past events — no market prices, odds, or implied probabilities.\n";
    const retried = await runValidated(
      buildAuditPrompt(question, first.value, hasWebSearch, userResolution, notice),
      validatePinnedAudit,
      opts.model
    );
    totalCost += retried.costUsd ?? 0;
    allQueries = [...allQueries, ...retried.searchQueries];
    audited = retried;
    priorSuspect = mentionsMarketPricing(audited.value.priorRationale);
  }

  return {
    framing: audited.value,
    searchQueries: allQueries,
    costUsd: totalCost,
    priorSuspect,
  };
}
