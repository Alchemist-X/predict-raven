// Builds the public answer payload from the engine's persisted ForecastState.
// This is the API's contract: probability + reasoning + evidence. The engine's
// internal credibleInterval band is deliberately NEVER exposed (user decision
// 2026-07-02: no interval claims on user-facing surfaces until calibrated).

import type { ForecastState, AnyForecastState } from "./repo";
import {
  answerLabel,
  isStructuredForecast,
  type AnswerKind,
  type StructuredAnswer,
  type StructuredForecastState
} from "@autopoly/forecast-engine/answer-types";
import type { Job } from "./run-manager";

export type AnswerStatus = "running" | "done" | "unforecastable" | "error" | "aborted";

export interface EvidenceItem {
  n: number;
  title: string;
  url: string;
  claim: string;
  stance: string;
  strength: string;
  sourceType: string;
  credibility: string;
  deltaPp: number;
  verified: boolean;
  round: number;
  kind: string;
}

export interface RoundItem {
  round: number;
  fromProb: number;
  toProb: number;
  netPp: number;
  dominantDriver: string | null;
  newSources: number;
  confidence: string;
}

export interface ForecastAnswer {
  answerType: AnswerKind | null;
  answer: StructuredAnswer | null;
  answerLabel: string | null;
  structured: StructuredDetails | null;
  id: string;
  status: AnswerStatus;
  question: string;
  normalizedQuestion: string | null;
  probability: number | null;
  probabilityPct: string | null;
  verdict: string | null;
  confidence: string | null;
  analysis: {
    whySentence: string | null;
    verdict: string | null;
    keyFactorsYes: string[];
    keyFactorsNo: string[];
    mainUncertainties: string | null;
    confidenceReason: string | null;
    prior: number | null;
    priorRationale: string | null;
    rounds: RoundItem[];
  } | null;
  framing: {
    resolutionCriteria: string;
    resolutionDate: string | null;
    settlementSource: string;
    assumptions: string;
  } | null;
  evidence: EvidenceItem[];
  provider: string | null;
  rounds: number;
  createdAtUtc: string | null;
  updatedAtUtc: string | null;
  jobLogTail: string[] | null;
  links: { json: string; text: string; pdf: string };
}

// Never expose expandedLibrary.readings: those contain private article bodies.
export interface StructuredDetails {
  questionSpec: StructuredForecastState["questionSpec"];
  summary: StructuredForecastState["summary"];
  evidence: StructuredForecastState["evidenceLedger"];
  rounds: StructuredForecastState["roundHistory"];
  library: { required: boolean; queryCount: number; readCount: number; usedCount: number; gaps: string[] } | null;
}

export function verdictFor(p: number): string {
  if (p < 0.1) return "Very unlikely";
  if (p < 0.25) return "Unlikely";
  if (p < 0.45) return "Leaning no";
  if (p < 0.55) return "Too close to call";
  if (p < 0.75) return "Leaning yes";
  if (p < 0.9) return "Likely";
  return "Very likely";
}

export const pct = (p: number): string => `${Math.round(p * 100)}%`;

// Status precedence must respect RECENCY, not just the in-memory job: the
// artifacts volume is shared with the raven app container (separate job maps),
// so a newer on-disk state must beat a stale terminal job — and a terminal
// state must beat a synthetic "reattached" running job (see run-manager).
export function answerStatus(
  state: AnyForecastState | null,
  job: Job | null,
  stateMtime?: number | null
): AnswerStatus {
  if (!state) {
    if (!job) return "error";
    return job.status === "done" ? "done" : job.status;
  }

  const jobStart = job ? Date.parse(job.startedAtUtc) : NaN;
  const stateUpdated = Date.parse(state.updatedAtUtc);
  const stateTerminal = state.status !== "open";

  if (stateTerminal) {
    // A job started AFTER the last state write is a newer attempt (e.g. a
    // --fresh rerun that hasn't written state yet) — report that attempt.
    if (job && Number.isFinite(jobStart) && jobStart > stateUpdated && job.status !== "done") {
      return job.status;
    }
    return state.status === "aborted" ? "aborted" : "done";
  }

  // state is "open": someone is (or was) mid-run.
  if (job?.status === "running") return "running";
  if (job && (job.status === "error" || job.status === "unforecastable")) {
    // State writes newer than our job's end mean another container owns the
    // run now — don't let our dead job shadow it.
    const jobEnd = job.endedAtUtc ? Date.parse(job.endedAtUtc) : jobStart;
    if (stateMtime != null && Number.isFinite(jobEnd) && stateMtime > jobEnd) return "running";
    return job.status;
  }
  return "running";
}

// Engine stdout is exposed for failed runs so callers can see WHY — but never
// the internal probability band (policy 2026-07-02) or anything key-shaped.
export function sanitizeLogTail(lines: string[]): string[] {
  return lines
    .filter((l) => !/internal band/i.test(l))
    .map((l) => l.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/Bearer\s+\S+/gi, "Bearer ***"));
}

function roundItems(state: ForecastState): RoundItem[] {
  return state.roundHistory.map((r) => ({
    round: r.round,
    fromProb: r.priorProb,
    toProb: r.postProb,
    netPp: Math.round((r.postProb - r.priorProb) * 1000) / 10,
    dominantDriver: r.whyChanged?.dominantTitle ?? null,
    newSources: r.newSourceCount,
    confidence: r.confidence
  }));
}

function evidenceItems(state: ForecastState): EvidenceItem[] {
  return state.evidenceLedger.map((e, i) => ({
    n: i + 1,
    title: e.title,
    url: e.url,
    claim: e.claim,
    stance: e.stance,
    strength: e.strength,
    sourceType: e.sourceType,
    credibility: e.credibility,
    deltaPp: Math.round(e.deltaPp * 10) / 10,
    verified: e.verifiedInSearchTrace,
    round: e.firstSeenRound,
    kind: e.kind
  }));
}

export function buildAnswer(
  id: string,
  state: AnyForecastState | null,
  job: Job | null,
  baseUrl: string,
  stateMtime?: number | null
): ForecastAnswer {
  const status = answerStatus(state, job, stateMtime);
  const lastRound = state?.roundHistory[state.roundHistory.length - 1] ?? null;
  const showJobLog = status === "error" || status === "unforecastable";
  if (isStructuredForecast(state)) {
    const library = state.expandedLibrary;
    return {
      id,
      status,
      question: state.eventText,
      normalizedQuestion: state.questionSpec.question,
      answerType: state.answer.kind,
      answer: state.answer,
      answerLabel: answerLabel(state.answer),
      structured: {
        questionSpec: state.questionSpec,
        summary: state.summary,
        evidence: state.evidenceLedger,
        rounds: state.roundHistory,
        library: library
          ? {
              required: library.required,
              queryCount: library.queries.length,
              readCount: library.readings.length,
              usedCount: library.usedArticleIds.length,
              gaps: library.queries
                .filter((query) => query.error || query.status !== "ok")
                .map((query) => `${query.targetId}: ${query.error ?? query.status}`)
                .concat((library.readingErrors ?? []).map(read => `${read.targetId}: ${read.articleId}: ${read.error}`))
            }
          : null
      },
      probability: null,
      probabilityPct: null,
      verdict: state.summary?.verdict ?? null,
      confidence: lastRound?.confidence ?? null,
      analysis: null,
      framing: {
        resolutionCriteria: state.questionSpec.resolutionCriteria,
        resolutionDate: state.questionSpec.resolutionDate,
        settlementSource: state.questionSpec.settlementSource,
        assumptions: state.questionSpec.assumptions.join("\n")
      },
      evidence: [],
      provider: state.provider ?? job?.provider ?? null,
      rounds: state.round,
      createdAtUtc: state.createdAtUtc,
      updatedAtUtc: state.updatedAtUtc,
      jobLogTail: showJobLog && job ? sanitizeLogTail(job.log.slice(-15)) : null,
      links: {
        json: `${baseUrl}/v1/forecasts/${id}`,
        text: `${baseUrl}/v1/forecasts/${id}/text`,
        pdf: `${baseUrl}/v1/forecasts/${id}/pdf`
      }
    };
  }
  return {
    answerType: state ? "binary" : null,
    answer: null,
    answerLabel: state ? pct(state.currentProb) : null,
    structured: null,
    id,
    status,
    question: state?.eventText ?? job?.question ?? "",
    normalizedQuestion: state?.framing.normalizedQuestion ?? null,
    probability: state ? state.currentProb : null,
    probabilityPct: state ? pct(state.currentProb) : null,
    verdict: state ? verdictFor(state.currentProb) : null,
    confidence: lastRound?.confidence ?? null,
    analysis: state
      ? {
          whySentence: state.summary?.whySentence ?? null,
          verdict: state.summary?.verdict ?? null,
          keyFactorsYes: state.summary?.keyFactorsYes ?? [],
          keyFactorsNo: state.summary?.keyFactorsNo ?? [],
          mainUncertainties: state.summary?.mainUncertainties ?? null,
          confidenceReason: state.summary?.confidenceReason ?? null,
          prior: state.framing.priorProbability,
          priorRationale: state.framing.priorRationale,
          rounds: roundItems(state)
        }
      : null,
    framing: state
      ? {
          resolutionCriteria: state.framing.resolutionCriteria,
          resolutionDate: state.framing.resolutionDate,
          settlementSource: state.framing.settlementSource,
          assumptions: state.framing.assumptions
        }
      : null,
    evidence: state ? evidenceItems(state) : [],
    provider: state?.provider ?? job?.provider ?? null,
    rounds: state?.round ?? 0,
    createdAtUtc: state?.createdAtUtc ?? job?.startedAtUtc ?? null,
    updatedAtUtc: state?.updatedAtUtc ?? null,
    jobLogTail: showJobLog && job ? sanitizeLogTail(job.log.slice(-15)) : null,
    links: {
      json: `${baseUrl}/v1/forecasts/${id}`,
      text: `${baseUrl}/v1/forecasts/${id}/text`,
      pdf: `${baseUrl}/v1/forecasts/${id}/pdf`
    }
  };
}
