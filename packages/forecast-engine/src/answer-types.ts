// Native non-binary forecasts. Never synthesize a legacy currentProb for these.
import type { Confidence, ForecastState, ForecastStatus, SourceType } from "./types";

export type AnswerKind = "binary" | "categorical" | "numeric" | "independent_ranking";
export interface AnswerOption { id: string; label: string }
export interface AnswerRequest {
  answerType?: AnswerKind | "auto";
  options?: AnswerOption[];
  unit?: string;
  minimum?: number;
  maximum?: number;
  resolution?: string;
}
export interface QuestionSpec {
  kind: AnswerKind;
  question: string;
  resolutionCriteria: string;
  resolutionDate: string;
  asOfDate: string;
  settlementSource: string;
  assumptions: string[];
  options: AnswerOption[];
  unit: string | null;
  minimum: number | null;
  maximum: number | null;
  scoreRubric: string | null;
  prior: Record<string, number> | { mean: number; standardDeviation: number };
  priorRationale: string;
  searchQueries: Array<{ targetId: string; query: string; keywords: string[] }>;
}
export type StructuredAnswer =
  | { kind: "categorical"; selectedId: string; tiedIds: string[]; probabilities: Array<AnswerOption & { probability: number }> }
  | { kind: "independent_ranking"; selectedId: string; tiedIds: string[]; ranking: Array<AnswerOption & { rank: number; probability: number }>; probabilitiesAreIndependent: true }
  | { kind: "numeric"; pointEstimate: number; standardDeviation: number; unit: string; modelRange: [number, number]; rangeDescription: string };

export interface ExpandedLibraryReading {
  articleId: string; targetId: string; title: string; url: string; text: string;
  offset: number; sha256: string; contentKind: string; apiDate: string;
}
export interface ExpandedLibraryCoverage {
  required: boolean;
  searchedAtUtc: string;
  queries: Array<{ targetId: string; query: string; status: string; total: number | null; error?: string; coverage?: unknown }>;
  readings: ExpandedLibraryReading[];
  usedArticleIds: string[];
  exclusions: Array<{ articleId: string; reason: string }>;
  readingErrors?: Array<{ articleId: string; targetId: string; error: string }>;
}
export interface StructuredClaim {
  id: string;
  claim: string;
  targetIds: string[];
  sourceUrl: string;
  sourceTitle: string;
  sourceType: SourceType;
  publishedAt: string | null;
  quote: string;
  rationale: string;
  clusterId: string;
  effects: Record<string, number>;
  numericSignal: { mean: number; standardDeviation: number } | null;
  articleId: string | null;
  epistemicStatus: "fact" | "source_opinion" | "estimate";
}
export interface StructuredLedgerEntry extends StructuredClaim {
  round: number;
  verifiedInSearchTrace: boolean;
  effectiveWeight: number;
  before: StructuredAnswer;
  after: StructuredAnswer;
}
export interface StructuredRound {
  round: number;
  ts: string;
  before: StructuredAnswer;
  after: StructuredAnswer;
  newClaimCount: number;
  duplicateCount: number;
  confidence: Confidence;
  reasoning: string;
  searchQueries: string[];
  searchResultUrls: string[];
  costUsd: number | null;
}
export interface StructuredForecastState {
  schemaVersion: 2;
  eventId: string;
  eventText: string;
  request: AnswerRequest;
  questionSpec: QuestionSpec;
  createdAtUtc: string;
  updatedAtUtc: string;
  status: ForecastStatus;
  round: number;
  answer: StructuredAnswer;
  evidenceLedger: StructuredLedgerEntry[];
  roundHistory: StructuredRound[];
  expandedLibrary: ExpandedLibraryCoverage | null;
  summary: { verdict: string; keyFindings: string[]; counterarguments: string[]; uncertainties: string[] } | null;
  provider?: string;
  error?: string;
}
export type AnyForecastState = ForecastState | StructuredForecastState;
export function isStructuredForecast(state: unknown): state is StructuredForecastState {
  return !!state && typeof state === "object" && (state as { schemaVersion?: unknown }).schemaVersion === 2;
}

export function answerLabel(answer: StructuredAnswer): string {
  if (answer.kind === "numeric") return `${Number(answer.pointEstimate.toFixed(2))} ${answer.unit}`;
  const rows = answer.kind === "categorical" ? answer.probabilities : answer.ranking;
  const top = rows.find(row => row.id === answer.selectedId);
  return top ? `${top.label} · ${(top.probability * 100).toFixed(1)}%` : "";
}
