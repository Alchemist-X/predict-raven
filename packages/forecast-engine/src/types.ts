// Shared types for the iterative binary forecaster.
//
// One forecast tracks ONE binary (yes/no) event. Its probability is maintained
// across multiple rounds: each round the agent searches for NEW evidence and
// proposes one log-likelihood ratio per atomic claim; the engine threads those
// through a Bayesian log-odds update so every probability move is attributable
// to a claim and its ranked source set. State persists between rounds so the
// loop can resume and so the whole decision process stays auditable.

export type Stance = "supports_yes" | "supports_no" | "neutral";
export type Strength = "weak" | "moderate" | "strong";
export type Confidence = "low" | "medium" | "high";
// Provenance class of a cited source: official = primary/company/government/
// regulator statements; press = journalism; insider = leakers, analysts,
// industry chatter.
export type SourceType = "official" | "data" | "academic" | "original_reporting" | "press" | "insider" | "secondary";

export type QuestionArchetype =
  | "personnel_transition"
  | "product_release"
  | "metric_threshold"
  | "policy_regulation"
  | "corporate_action"
  | "geopolitical_event"
  | "other";

export type ProbabilityModelKind = "hazard" | "conjunction" | "scenario_mixture" | "binary_bayesian";
export type ResearchPriority = "high" | "medium" | "low";

export interface ResearchFocus {
  id: string;
  question: string;
  whyItMatters: string;
  priority: ResearchPriority;
  preferredSources: string[];
  completionCriteria: string;
}

export interface SourcePriorityRule {
  rank: number;
  sourceClass: string;
  useWhen: string;
  rejectWhen: string;
}

// The Focus Center contract. It is generated after framing and before the
// first research round, then shown in the Raven interface and injected into
// every round. The plan never emits a competing probability.
export interface ResearchPlan {
  archetype: QuestionArchetype;
  modelKind: ProbabilityModelKind;
  modelRationale: string;
  decomposition: string[];
  focusAreas: ResearchFocus[];
  sourcePriorities: SourcePriorityRule[];
  minimumSearchQueries: number;
  searchStrategy: string;
}

export type ClaimCategory = "base_rate" | "resolution" | "current_state" | "causal_driver" | "counterevidence";
export type ResolutionRelevance = "direct" | "indirect" | "context";
export type ClaimSupport = "supports" | "contradicts" | "context";
export type SupportQuality = "direct" | "partial" | "context";
export type CrossCheckStatus = "confirmed" | "single_source" | "contested" | "unverified";

export interface ClaimSource {
  url: string;
  title: string;
  sourceType: SourceType;
  credibility: Confidence;
  relation: ClaimSupport;
  supportQuality: SupportQuality;
  publishedAt: string | null;
  isPrimary: boolean;
  independenceGroup: string;
  verifiedInSearchTrace?: boolean;
  qualityScore?: number;
}

// ---- The structured frame the agent writes BEFORE forecasting (Round 0). ----
// A free-text user prompt is not a well-posed forecastable event; this step
// turns it into a crisp binary question with explicit resolution, an inferred
// resolution date, a settlement source, and a forecastability judgement (so a
// hopelessly vague prompt is flagged for clarification rather than given a
// false-precision number).
export interface EventFraming {
  normalizedQuestion: string; // the crisp binary question actually forecast
  resolutionCriteria: string; // exactly what counts as YES vs NO
  resolutionDate: string | null; // YYYY-MM-DD by which it must resolve (inferred)
  settlementSource: string; // what authoritative source would confirm the outcome
  assumptions: string; // assumptions the agent made while framing
  forecastable: boolean; // false => too vague/subjective to forecast as binary
  clarificationNeeded: string; // when not forecastable, what the user must specify
  // P0-2: the model's own prior P(YES) from general knowledge, BEFORE any web
  // evidence — a base-rate anchor so the forecast doesn't start blind at 0.5.
  priorProbability: number; // 0..1
  priorRationale: string; // reference class / why this base rate
  // P0-1: a second, skeptical audit pass over the frame. Surfaces ambiguities in
  // the YES/NO bar, edge cases, date, or forecastability that a single-shot frame
  // would miss and silently corrupt every downstream round.
  framingCaveats: string; // ambiguities / edge cases the audit flagged
  framingConfidence: "high" | "medium" | "low";
}
export interface AgentClaim {
  libraryArticleId?: string;
  libraryQuote?: string;
  claim_id: string; // stable, short semantic key; reused when the same factual claim returns
  focus_id: string; // ResearchFocus.id this claim helps answer
  claim: string; // one atomic, checkable factual statement
  // The highest-ranked source is repeated in these compatibility fields so the
  // existing ledger and user interface keep one canonical direct link. Sources
  // below are corroboration or contradiction and never create extra LLR moves.
  source_url: string;
  source_title: string;
  stance: Stance; // direction relative to the YES outcome
  strength: Strength; // how strongly it moves the belief
  llr: number; // signed log-likelihood ratio in nats; + favors YES, - favors NO
  rationale: string; // why this moves the probability and by how much
  cluster_id: string; // same underlying fact/causal story => same id across rounds
  source_type: SourceType;
  credibility: Confidence;
  category: ClaimCategory;
  resolution_relevance: ResolutionRelevance;
  cross_check_status: CrossCheckStatus;
  selection_rationale: string;
  sources: ClaimSource[];
}

// (a) Reflection: an adjustment to a PRIOR-round source, proposed when this
// round's research shows it was wrong / stale / double-counted. Guardrailed: only
// applied with a NEW cited reason, magnitude-clamped, tagged separately, and it
// can only nudge a specific prior source — never re-pick the whole probability.
export interface ReflectionAdjustment {
  target_url: string; // a prior source's URL to reweight
  llr_adjustment: number; // signed CHANGE to its weight (+ = should have favored YES more)
  reason: string; // why, in light of what
  new_source_url: string; // the NEW source justifying the change (required)
}

export interface AgentRoundOutput {
  round_summary: string;
  newClaims: AgentClaim[];
  reflection: ReflectionAdjustment[]; // (a) cross-round corrections; may be empty
  confidence: Confidence;
  found_new_information: boolean; // false => no fresh evidence this round (stop signal)
  notes: string;
}

// ---- Engine-side records (the load-bearing, computed state). ----

// One source, after the engine has applied it to the running probability.
export interface LedgerEntry {
  libraryArticleId?: string;
  libraryQuote?: string;
  id: string;
  url: string;
  urlCanonical: string; // dedupe key
  title: string;
  claim: string;
  stance: Stance;
  strength: Strength;
  kind: "evidence" | "reflection"; // (a) reflection entries adjust a prior source
  clusterId: string; // P0-3: the source's claim-cluster
  clusterFactor: number; // independence discount applied within its cluster (1 = full, <1 = damped)
  effectiveLlr: number; // sign from stance, magnitude clamped, cluster + verification discounts applied — the value actually applied
  probBefore: number; // running P(YES) just before this source
  probAfter: number; // running P(YES) just after this source
  deltaPp: number; // (probAfter - probBefore) * 100, the "+N percentage points" attribution
  rationale: string;
  retrievedAtUtc: string;
  firstSeenRound: number;
  verifiedInSearchTrace: boolean; // was this URL actually returned by the agent's WebSearch?
  sourceType: SourceType; // provenance class of the cited source
  credibility: Confidence; // reliability of this source for this claim
  claimId?: string;
  focusId?: string;
  category?: ClaimCategory;
  resolutionRelevance?: ResolutionRelevance;
  crossCheckStatus?: CrossCheckStatus;
  selectionRationale?: string;
  sources?: ClaimSource[];
  qualityScore?: number;
  excluded?: "market_price"; // market-blind mode zero-weighted this source (kept in the ledger for the audit trail)
}

export interface PerSourceUpdate {
  url: string;
  title: string;
  from: number;
  to: number;
  deltaPp: number;
  explanation: string;
  verified: boolean;
  clusterId: string;
  clusterFactor: number; // <1 means damped as a correlated same-cluster source
  kind: "evidence" | "reflection"; // (a) reflection = a correction to a prior source
  sourceType: SourceType; // provenance class of the cited source
  credibility: Confidence; // reliability of this source for this claim
  excluded?: "market_price"; // market-blind mode zero-weighted this source
}

// (b) Computed decomposition of why a round's probability moved: net, the split
// of supporting vs opposing percentage points, and the single dominant driver.
export interface WhyChanged {
  netPp: number; // postProb - priorProb, in pp
  upPp: number; // sum of positive per-source deltas
  downPp: number; // sum of negative per-source deltas (<= 0)
  dominantUrl: string;
  dominantTitle: string;
  dominantPp: number;
  dominantKind: "evidence" | "reflection";
}

export interface RoundRecord {
  round: number;
  ts: string;
  priorProb: number; // MUST equal previous round's postProb (continuity invariant)
  postProb: number;
  perSourceUpdates: PerSourceUpdate[];
  newSourceCount: number; // distinct cited pages across the new claims
  newClaimCount?: number; // probability is updated once per claim, never once per page
  duplicateCount: number; // sources dropped because already counted in a prior round
  reflectionCount: number; // (a) prior-source corrections applied this round
  unverifiedPp: number; // total |pp| of this round's movement from unverified (soft-clamped) sources
  confirmationRatio: number | null; // P0-5: share of evidence weight reinforcing the current lean
  whyChanged: WhyChanged | null; // (b) decomposition of the round's net move
  confidence: Confidence;
  reasoning: string;
  searchQueries: string[];
  searchResultUrlCount: number;
  costUsd: number | null;
  // Aggregate model/tool usage when every attempt in this round reports it.
  usage?: import("./claude-agent").AgentUsage;
  analystConsumedIds?: string[]; // ids of analyst notes consumed (injected) this round
}

export type ForecastStatus =
  | "open"
  | "converged"
  | "no_new_info"
  | "max_rounds"
  | "resolved"
  | "aborted"
  // The unclamped posterior crossed PROB_FLOOR/PROB_CEIL: the reported number
  // is the engine's expressible bound, not a settled estimate. Distinct from
  // "converged" so consumers never mistake a pinned artifact for convergence.
  | "saturated";

// A final, whole-forecast synthesis written after the last round. It EXPLAINS the
// engine's final probability (the balance of evidence, key drivers, open
// uncertainties) — it does NOT re-decide the number (engine still owns it).
export interface ForecastSummary {
  verdict: string; // 1-2 paragraphs: the overall read on why P(YES) landed here
  keyFactorsYes: string[]; // strongest factors pushing toward YES
  keyFactorsNo: string[]; // strongest factors pushing toward NO
  mainUncertainties: string; // what is unresolved / could move it before resolution
  calibrationNote: string; // optional: if the agent thinks the number is mis-calibrated, why (no new number)
  whySentence?: string; // ONE self-explaining sentence: the single reason the number landed here
  quip?: string; // one short dry human aside reacting to the verdict
  confidenceReason?: string; // one line on why confidence is high/medium/low
  probabilityModelExplanation?: string;
  scenarios?: Array<{ name: string; description: string; implication: string }>;
  monitoringSignals?: Array<{ signal: string; direction: "raises" | "lowers" | "mixed"; component: string }>;
  informationGaps?: Array<{ gap: string; importance: string; retrievalPath: string }>;
  glossary?: Array<{ term: string; definition: string }>;
}

export interface ForecastState {
  expandedLibrary?: import("./answer-types").ExpandedLibraryCoverage | null;
  eventId: string;
  eventText: string; // the original user prompt, verbatim
  framing: EventFraming; // Round-0 frame: the normalized question actually forecast
  createdAtUtc: string;
  updatedAtUtc: string;
  currentProb: number; // the maintained P(YES), threaded across rounds
  credibleInterval: [number, number];
  round: number; // number of completed rounds
  status: ForecastStatus;
  evidenceLedger: LedgerEntry[];
  roundHistory: RoundRecord[];
  summary: ForecastSummary | null; // final whole-forecast synthesis (after the last round)
  researchPlan?: ResearchPlan;
  provider?: string; // which LLM provider produced this run ("claude" | "deepseek")
  // Set when currentProb sits at PROB_FLOOR/PROB_CEIL because the unclamped
  // posterior crossed it — the number is a bound, not a point estimate.
  saturatedAt?: "floor" | "ceil" | null;
  // Market-blind mode bookkeeping (FORECAST_MARKET_BLIND=1): how many sources
  // the domain blocklist zero-weighted, and whether the prior rationale still
  // reads market-price-anchored. Consumers (paper agent) use this to discount
  // or flag the edge computed from this forecast.
  marketBlind?: {
    enabled: boolean;
    blockedCount: number;
    priorSuspect: boolean;
  };
}

// ---- Analyst-in-the-loop (written by the app / a human, read by the engine). ----
// Notes are leads for the NEXT round: the engine injects every unconsumed note
// into the round prompt as a hypothesis to INVESTIGATE (never as established
// fact) and stamps consumedRound once injected. Marks let the analyst flag
// specific ledger entries: "doubt" asks the agent to re-examine that source via
// the reflection mechanism; "keep" is a passive endorsement (UI-only).
export type AnalystStance = "yes" | "no" | "question";
export type AnalystMark = "keep" | "doubt";
export interface AnalystNote {
  id: string; // server/app-assigned, e.g. note-<epoch>-<rand4>
  text: string;
  stance: AnalystStance; // pushes-yes / pushes-no / open question
  targetId: string | null; // LedgerEntry.id when the note is attached to one piece of evidence
  createdAtUtc: string;
  consumedRound: number | null; // set by the engine when injected into a round
}
export interface AnalystState {
  notes: AnalystNote[];
  marks: Record<string, AnalystMark>; // key = LedgerEntry.id (or reasoning id `round-<n>`)
  // Engine-side stamp: LedgerEntry.id -> the round that already injected this
  // doubt into a prompt. Marks stay (they drive the UI); the stamp stops the
  // same doubt from being re-injected — and re-walked-back — every later round.
  doubtsHandled?: Record<string, number>;
}
