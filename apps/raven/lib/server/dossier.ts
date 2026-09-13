// Adapts the engine's ForecastState (packages/forecast-engine) into the
// design-shaped DossierVM the three screens render. The archived GTA 6 demo
// bypasses this and ships its hand-authored VM directly.

import type { ForecastState, LedgerEntry, RoundRecord } from "@autopoly/forecast-engine/types";
import {
  answerLabel,
  isStructuredForecast,
  type AnyForecastState,
  type StructuredForecastState
} from "@autopoly/forecast-engine/answer-types";
import { GTA6_DEMO, GTA6_DEMO_ID } from "../demo/gta6";
import {
  credWord,
  dirFor,
  domainOf,
  formatDuration,
  pct,
  srcLabelFor,
  strengthToValue,
  verdictFor
} from "../vm/format";
import type { DossierMeta, DossierStatus, DossierVM, EvidenceVM, IterationVM, RunListItem, Side } from "../vm/types";
import { listAnyStates, loadAnyState } from "./repo";
import type { Job } from "./run-manager";

// The engine may or may not have populated the newer optional fields
// (sourceType/credibility/provider/summary presentation fields) depending on
// when the run was produced — read them defensively.
type LedgerX = LedgerEntry;
type StateX = ForecastState & {
  provider?: string;
  summary?: (ForecastState["summary"] & { whySentence?: string; quip?: string; confidenceReason?: string }) | null;
};

const r100 = (p: number): number => Math.round(p * 100);

// Side is relative to the forecast's final lean: "support" backs the lean,
// "counter" cuts against it. With P(YES) below 50% the lean is NO, so
// probability-lowering evidence supports the forecast (green).
function sideFor(deltaWhole: number, leanYes: boolean): Side {
  if (deltaWhole === 0) return "neutral";
  const pushesYes = deltaWhole > 0;
  return pushesYes === leanYes ? "support" : "counter";
}

function reflectionTitle(entry: LedgerX): string {
  return entry.title.replace(/^reflection on\s*/i, "Revisits: ");
}

function toEvidence(entry: LedgerX, leanYes: boolean): EvidenceVM {
  const from = r100(entry.probBefore);
  const to = r100(entry.probAfter);
  const d = to - from;
  const isReflection = entry.kind === "reflection";
  const srcType = entry.sourceType ?? "press";
  return {
    id: entry.id,
    title: isReflection ? reflectionTitle(entry) : entry.title || domainOf(entry.url),
    dom: domainOf(entry.url),
    url: entry.url,
    srcType,
    srcLabel: srcLabelFor(srcType),
    side: sideFor(d, leanYes),
    cred: credWord(entry.credibility ?? "medium"),
    value: strengthToValue(entry.strength),
    from: `${from}%`,
    to: `${to}%`,
    d,
    revises: isReflection,
    verified: entry.verifiedInSearchTrace,
    takeaway: entry.claim,
    analysis: entry.rationale || entry.claim,
    claimId: entry.claimId,
    focusId: entry.focusId,
    crossCheck: entry.crossCheckStatus,
    qualityScore: entry.qualityScore,
    sourceCount: entry.sources?.length ?? 1,
    supportingSources: entry.sources?.map((source) => ({
      title: source.title || domainOf(source.url),
      url: source.url,
      qualityScore: source.qualityScore ?? null
    }))
  };
}

function toIteration(round: RoundRecord, ledger: LedgerX[], leanYes: boolean): IterationVM {
  const from = r100(round.priorProb);
  const to = r100(round.postProb);
  const net = to - from;
  return {
    n: String(round.round).padStart(2, "0"),
    from: `${from}%`,
    to: `${to}%`,
    net: `${Math.abs(net)}%`,
    netDir: dirFor(net),
    note: cleanPct(round.reasoning),
    evidence: ledger.filter((e) => e.firstSeenRound === round.round).map((e) => toEvidence(e, leanYes)),
    analystFolded: round.analystConsumedIds?.length ?? 0
  };
}

function statusFor(state: StateX): DossierStatus {
  if (state.status === "open") return "running";
  if (state.status === "aborted") return "failed";
  return "complete";
}

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?:\s|$)/);
  return (m ? m[0] : text).trim();
}

// Content rule: every probability reads as a whole percent. LLM prose tends to
// echo the engine's "25.0%" — strip the lossless ".0" (never round real
// decimals, that would misquote the model).
function cleanPct(text: string): string {
  return text.replace(/(\d+)\.0%/g, "$1%");
}

export function adaptState(state: AnyForecastState, job: Job | null): DossierVM {
  if (isStructuredForecast(state)) return adaptStructuredState(state, job);
  const leanYes = state.currentProb >= 0.5;
  const ledger = state.evidenceLedger as LedgerX[];
  const iterations = state.roundHistory.map((r) => toIteration(r, ledger, leanYes));
  const allEvidence = iterations.flatMap((it) => it.evidence);

  const nSupport = allEvidence.filter((e) => e.side === "support").length;
  const nCounter = allEvidence.filter((e) => e.side === "counter").length;
  const nNeutral = allEvidence.filter((e) => e.side === "neutral").length;

  const summary = state.summary;
  const lastRound = state.roundHistory[state.roundHistory.length - 1];
  const confidence = lastRound?.confidence ?? "medium";

  const meta: DossierMeta = {
    question: state.framing.normalizedQuestion || state.eventText,
    prob: pct(state.currentProb),
    verdict: verdictFor(state.currentProb),
    quip: summary?.quip ?? "",
    prior: pct(state.framing.priorProbability),
    duration: formatDuration(state.createdAtUtc, state.updatedAtUtc),
    sources: String(
      new Set(
        ledger.flatMap((entry) => (entry.sources?.length ? entry.sources.map((source) => source.url) : [entry.url]))
      ).size
    ),
    nSupport: String(nSupport),
    nCounter: String(nCounter),
    nNeutral: String(nNeutral),
    why: cleanPct(summary?.whySentence ?? (summary ? firstSentence(summary.verdict) : "")),
    confWhy: cleanPct(summary?.confidenceReason ?? ""),
    openUnc: cleanPct(summary?.mainUncertainties ?? ""),
    resDate: state.framing.resolutionDate,
    normQ: state.framing.normalizedQuestion,
    criteria: state.framing.resolutionCriteria,
    priorWhy: state.framing.priorRationale,
    assumptions: state.framing.assumptions,
    settlement: state.framing.settlementSource,
    confidence
  };

  // Core signals: the biggest mover, the strongest reversal (if any), then the
  // next biggest mover — matching the demo's "Biggest move / Key reversal /
  // On the record" pattern with computable stand-ins.
  const movers = [...allEvidence]
    .filter((e) => e.d !== 0)
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0) || Math.abs(b.d) - Math.abs(a.d));
  const core: DossierVM["core"] = [];
  const used = new Set<string>();
  const take = (ev: EvidenceVM | undefined, rank: string) => {
    if (ev && !used.has(ev.id)) {
      used.add(ev.id);
      core.push({ id: ev.id, rank });
    }
  };
  take(movers[0], "Biggest move");
  take(
    movers.find((e) => e.revises),
    "Key reversal"
  );
  take(
    movers.find((e) => e.srcType === "official" && !used.has(e.id)),
    "On the record"
  );
  for (const m of movers) {
    if (core.length >= 3) break;
    take(m, "Strong signal");
  }

  const topCounterEv = movers.find((e) => e.side === "counter");
  const topCounter = topCounterEv
    ? {
        id: topCounterEv.id,
        resolution: "The strongest signal against the current lean — weigh it before trusting the number."
      }
    : null;

  return {
    id: state.eventId,
    status: statusFor(state),
    meta,
    iterations,
    core,
    topCounter,
    provider: state.provider ?? job?.provider ?? null,
    isDemo: false,
    currentProb: state.currentProb,
    priorProb: state.framing.priorProbability,
    maxRounds: Math.max(job?.maxRounds ?? 3, state.roundHistory.length),
    startedAtUtc: state.createdAtUtc,
    summaryParagraphs: summary ? summary.verdict.split(/\n\n+/).filter(Boolean).map(cleanPct) : [],
    researchPlan: state.researchPlan
      ? {
          archetype: state.researchPlan.archetype,
          modelKind: state.researchPlan.modelKind,
          modelRationale: state.researchPlan.modelRationale,
          searchStrategy: state.researchPlan.searchStrategy,
          minimumSearchQueries: state.researchPlan.minimumSearchQueries,
          focusAreas: state.researchPlan.focusAreas,
          sourcePriorities: state.researchPlan.sourcePriorities
        }
      : null,
    probabilityModelExplanation: summary?.probabilityModelExplanation,
    scenarios: summary?.scenarios,
    monitoringSignals: summary?.monitoringSignals,
    informationGaps: summary?.informationGaps,
    glossary: summary?.glossary
  };
}

function adaptStructuredState(state: StructuredForecastState, job: Job | null): DossierVM {
  const spec = state.questionSpec;
  const library = state.expandedLibrary;
  return {
    id: state.eventId,
    status: state.status === "open" ? "running" : state.status === "aborted" ? "failed" : "complete",
    meta: {
      question: spec.question,
      prob: answerLabel(state.answer),
      verdict: "",
      quip: "",
      prior: "",
      duration: formatDuration(state.createdAtUtc, state.updatedAtUtc),
      sources: String(new Set(state.evidenceLedger.map((entry) => entry.sourceUrl)).size),
      nSupport: "0",
      nCounter: "0",
      nNeutral: "0",
      why: state.summary?.verdict ?? "",
      confWhy: "",
      openUnc: state.summary?.uncertainties.join("\n") ?? "",
      resDate: spec.resolutionDate,
      normQ: spec.question,
      criteria: spec.resolutionCriteria,
      priorWhy: spec.priorRationale,
      assumptions: spec.assumptions.join("\n"),
      settlement: spec.settlementSource,
      confidence: state.roundHistory.at(-1)?.confidence ?? "low"
    },
    structured: {
      answer: state.answer,
      questionSpec: spec,
      summary: state.summary,
      evidence: state.evidenceLedger,
      rounds: state.roundHistory,
      library: library
        ? {
            searched: library.queries.length,
            read: library.readings.length,
            used: library.usedArticleIds.length,
            gaps: library.queries
              .filter((query) => query.error || query.status !== "ok")
              .map((query) => `${query.targetId}: ${query.error ?? query.status}`)
          }
        : null
    },
    iterations: [],
    core: [],
    topCounter: null,
    provider: state.provider ?? job?.provider ?? null,
    isDemo: false,
    currentProb: null,
    priorProb: null,
    maxRounds: Math.max(job?.maxRounds ?? 3, state.round),
    startedAtUtc: state.createdAtUtc,
    summaryParagraphs: state.summary?.verdict.split(/\n\n+/).filter(Boolean) ?? [],
    researchPlan: null
  };
}

export function getDossier(id: string, job: Job | null): DossierVM | null {
  if (id === GTA6_DEMO_ID) return GTA6_DEMO;
  const state = loadAnyState(id);
  if (!state) return null;
  return adaptState(state, job);
}

export function listRuns(): RunListItem[] {
  const items: RunListItem[] = listAnyStates().map((s) => {
    if (isStructuredForecast(s)) {
      return {
        eventId: s.eventId,
        answerType: s.answer.kind,
        question: s.questionSpec.question,
        prob: answerLabel(s.answer),
        status: s.status === "open" ? "running" : s.status === "aborted" ? "failed" : "complete",
        sources: new Set(s.evidenceLedger.map((entry) => entry.sourceUrl)).size,
        updatedAtUtc: s.updatedAtUtc,
        verdict: "",
        quip: null,
        duration: formatDuration(s.createdAtUtc, s.updatedAtUtc),
        confidence: s.roundHistory.at(-1)?.confidence ?? "low",
        resDate: s.questionSpec.resolutionDate
      };
    }
    const summary = s.summary;
    return {
      eventId: s.eventId,
      question: s.framing?.normalizedQuestion || s.eventText,
      prob: pct(s.currentProb),
      status: s.status === "open" ? "running" : s.status === "aborted" ? "failed" : "complete",
      sources: new Set(
        s.evidenceLedger.flatMap((entry) =>
          entry.sources?.length ? entry.sources.map((source) => source.url) : [entry.url]
        )
      ).size,
      updatedAtUtc: s.updatedAtUtc,
      verdict: verdictFor(s.currentProb),
      quip: summary?.quip ?? null,
      duration: formatDuration(s.createdAtUtc, s.updatedAtUtc),
      confidence: s.roundHistory[s.roundHistory.length - 1]?.confidence ?? "medium",
      resDate: s.framing?.resolutionDate ?? null
    };
  });
  return items;
}
