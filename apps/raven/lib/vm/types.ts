// View-model types for the three Raven screens. Shape mirrors the design
// handoff's data module (raven-gta6-data.js) so the archived demo dossier and
// live engine runs render through one code path.
import type { StructuredForecastState } from "@autopoly/forecast-engine/answer-types";

// Only selected evidence and aggregate library coverage cross the UI boundary.
export interface StructuredDossierVM {
  answer: StructuredForecastState["answer"];
  questionSpec: StructuredForecastState["questionSpec"];
  summary: StructuredForecastState["summary"];
  evidence: StructuredForecastState["evidenceLedger"];
  rounds: StructuredForecastState["roundHistory"];
  library: { searched: number; read: number; used: number; gaps: string[] } | null;
}

export type Side = "support" | "counter" | "neutral";
export type Tier = "high" | "med" | "low";
export type SrcType = "official" | "data" | "academic" | "original_reporting" | "press" | "insider" | "secondary";
export type NetDir = "down" | "up" | "flat";

export interface EvidenceVM {
  id: string; // stable id — ledger entry id for live runs, eNN for the demo
  title: string;
  dom: string; // source domain shown next to the source-type icon
  url: string | null; // full source URL when known (live runs)
  srcType: SrcType;
  srcLabel: string;
  side: Side; // relative to the forecast lean, NOT to YES (see adapter)
  cred: Tier; // source credibility (shield)
  value: Tier; // evidence value (violet diamonds) — independent of cred
  from: string; // "38%"
  to: string; // "26%"
  d: number; // signed whole-percent delta
  revises: boolean; // reflection entries revise a prior source
  verified: boolean;
  takeaway: string; // one bold sentence
  analysis: string;
  claimId?: string;
  focusId?: string;
  crossCheck?: "confirmed" | "single_source" | "contested" | "unverified";
  qualityScore?: number;
  sourceCount?: number;
  supportingSources?: Array<{ title: string; url: string; qualityScore: number | null }>;
}

export interface ResearchFocusVM {
  id: string;
  question: string;
  whyItMatters: string;
  priority: "high" | "medium" | "low";
  preferredSources: string[];
  completionCriteria: string;
}

export interface ResearchPlanVM {
  archetype: string;
  modelKind: string;
  modelRationale: string;
  searchStrategy: string;
  minimumSearchQueries: number;
  focusAreas: ResearchFocusVM[];
  sourcePriorities: Array<{ rank: number; sourceClass: string; useWhen: string; rejectWhen: string }>;
}

export interface IterationVM {
  n: string; // "01"
  from: string;
  to: string;
  net: string; // "8%" (absolute)
  netDir: NetDir;
  note: string; // Raven's reasoning for the round
  evidence: EvidenceVM[];
  analystFolded?: number; // analyst notes the engine injected into this round
}

export interface DossierMeta {
  question: string;
  prob: string; // "7%"
  verdict: string; // "Very unlikely"
  quip: string;
  prior: string; // "38%"
  duration: string; // "33m 35s"
  sources: string; // "13"
  nSupport: string;
  nCounter: string;
  nNeutral: string;
  why: string; // one complete sentence
  confWhy: string;
  openUnc: string;
  resDate: string | null;
  normQ: string;
  criteria: string;
  priorWhy: string;
  assumptions: string;
  settlement: string;
  confidence: "high" | "medium" | "low";
}

export interface CoreSignal {
  id: string; // evidence id
  rank: string; // "Biggest move" | "Key reversal" | …
}

export interface TopCounter {
  id: string;
  resolution: string; // how the counter-signal was resolved (or why it stands)
}

export type DossierStatus = "complete" | "running" | "failed" | "unforecastable";

export interface DossierVM {
  structured?: StructuredDossierVM;
  id: string;
  status: DossierStatus;
  meta: DossierMeta;
  iterations: IterationVM[];
  core: CoreSignal[];
  topCounter: TopCounter | null;
  provider: string | null;
  isDemo: boolean;
  // Live-run extras (null for the archived demo)
  currentProb: number | null; // 0..1
  priorProb: number | null; // 0..1
  maxRounds: number;
  startedAtUtc: string | null;
  summaryParagraphs: string[]; // narrative paragraphs (may reference [NN] evidence indices)
  researchPlan?: ResearchPlanVM | null;
  probabilityModelExplanation?: string;
  scenarios?: Array<{ name: string; description: string; implication: string }>;
  monitoringSignals?: Array<{ signal: string; direction: "raises" | "lowers" | "mixed"; component: string }>;
  informationGaps?: Array<{ gap: string; importance: string; retrievalPath: string }>;
  glossary?: Array<{ term: string; definition: string }>;
}

export interface RunListItem {
  answerType?: "binary" | "categorical" | "numeric" | "independent_ranking";
  eventId: string;
  question: string;
  prob: string;
  status: DossierStatus;
  sources: number;
  updatedAtUtc: string;
  verdict: string;
  quip: string | null;
  duration: string;
  confidence: "high" | "medium" | "low";
  resDate: string | null;
}
