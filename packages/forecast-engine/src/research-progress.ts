import type { AgentRunResult } from "./claude-agent";
import type { ExpandedLibraryCoverage } from "./answer-types";
import { signalDeskEnabled } from "./research-tools";

export interface RetrievalAttempt {
  tool: string;
  query: string;
  outcome: "results" | "no_results" | "partial" | "failed";
  sourceUrls: string[];
  librarySearched: boolean;
  targetIds?: string[];
  keywords?: string[];
  readKey?: string;
  error?: string;
}
export interface ResearchCheckpoint {
  round: number;
  status: "ready" | "retry" | "research_failed" | "insufficient_evidence";
  reason: string;
  successfulQueries: string[];
  attempts: RetrievalAttempt[];
  evidenceCount: number;
  newClaimCount: number;
  readKeys: string[];
  newReadCount: number;
  openGapCount: number;
}
export interface ResearchProgressState {
  researchProgress?: ResearchCheckpoint[];
  researchBlocker?: string;
  expandedLibrary?: ExpandedLibraryCoverage | null;
  researchGaps?: import("./research-review").ResearchGap[];
}

// Zero is the public, serializable spelling of an explicitly unlimited budget.
export function researchRoundLimit(explicit?: number): number {
  const raw = explicit ?? (process.env.FORECAST_MAX_ROUNDS?.trim() ? Number(process.env.FORECAST_MAX_ROUNDS) : 0);
  if (!Number.isSafeInteger(raw) || raw < 0) throw new Error("maxRounds must be a non-negative integer (0 means no round limit)");
  return raw === 0 ? Infinity : raw;
}
export function roundLimitLabel(limit: number): string { return Number.isFinite(limit) ? String(limit) : "unlimited"; }
export function incompleteResearch(status: string): boolean {
  return ["open", "research_failed", "insufficient_evidence", "max_rounds", "aborted"].includes(status);
}

export async function retryRetrieval(call: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
  name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await call(name, args);
      if (!result.error && ["ok", "partial"].includes(String(result.status))) return {...result, ...(errors.length ? {retry_errors:errors} : {})};
      errors.push(String(result.error ?? `Retrieval failed (status: ${result.status ?? "missing"})`));
    } catch (error) { errors.push(error instanceof Error ? error.message : "Retrieval failed"); }
  }
  return {status:"error", error:errors.at(-1), retry_errors:errors, source_urls:[]};
}

export function assessResearchProgress(state: ResearchProgressState, result: Pick<AgentRunResult, "retrievalAttempts" | "searchQueries">,
  input: {round: number; evidenceCount: number; covered: boolean; openGapCount: number; newClaimCount: number; minimumQueries?: number}): ResearchCheckpoint {
  const history = state.researchProgress ?? [];
  const library = state.expandedLibrary;
  // Precollection and gap searches are real retrieval too, but their reads do
  // not establish that the model has read those sources.
  const engineAttempts: RetrievalAttempt[] = [
    ...(library?.queries ?? []).map(q => ({tool:"signal_desk_search",query:q.query,
      outcome:q.status === "ok" ? q.total ? "results" as const : "no_results" as const : q.status === "partial" ? "partial" as const : "failed" as const,
      sourceUrls:library!.readings.filter(r => r.targetId === q.targetId).map(r => r.url),
      librarySearched:q.status === "ok" && !q.arguments?.publisher,
      targetIds:[q.targetId],error:q.error})),
    ...(state.researchGaps ?? []).flatMap(g => g.attempts.map(a => ({tool:"web_search",query:a.query,
      outcome:a.outcome ?? (a.status === "ok" ? a.sourceUrls.length ? "results" : "no_results" : a.status === "partial" ? "partial" : "failed"),
      sourceUrls:a.sourceUrls,librarySearched:false,targetIds:g.targetIds,error:a.errors.join("; ")} as RetrievalAttempt)))
  ];
  const modelAttempts = result.retrievalAttempts ?? [];
  const attempts = [...modelAttempts, ...engineAttempts];
  const isSearch = (a: RetrievalAttempt) => ["web_search", "signal_desk_search"].includes(a.tool);
  const searches = attempts.filter(isSearch);
  const successfulQueries = [...new Set(searches.filter(a => a.outcome === "results" || a.outcome === "no_results" || (a.outcome === "partial" && a.sourceUrls.length > 0)).map(a => a.query))];
  const allQueries = new Set([...history.flatMap(p => p.successfulQueries), ...successfulQueries]);
  const targets = [...new Set(library?.queries.map(q => q.targetId) ?? [])];
  const priorAndCurrent = [...history.flatMap(p => p.attempts), ...attempts];
  const matchesTarget = (a: RetrievalAttempt, id: string) => {
    if (a.targetIds?.includes(id)) return true;
    const words = new Set((a.query + " " + (a.keywords ?? []).join(" ")).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    // Use explicit target ids or the original query's full keyword set. An
    // unrelated successful source query must not erase another target's error.
    if (!["question", "all"].includes(id) && words.has(id.toLowerCase())) return true;
    return library!.queries.filter(q => q.targetId === id).some(q => {
      const expected = Array.isArray(q.arguments?.keywords) ? q.arguments!.keywords as string[] : [q.query];
      return expected.length > 0 && expected.every(k => k.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(w => words.has(w)));
    });
  };
  const librarySucceeded = !library?.required || (targets.length
    ? targets.every(id => priorAndCurrent.some(a => a.librarySearched && matchesTarget(a,id)))
    : priorAndCurrent.some(a => a.librarySearched));
  const strict = signalDeskEnabled();
  const currentSearches = modelAttempts.filter(isSearch);
  const searchFailed = strict && currentSearches.length > 0 && currentSearches.every(a => a.outcome === "failed");
  const reads = attempts.filter(a => ["fetch_page", "signal_desk_read", "signal_desk_pdf"].includes(a.tool));
  const readsFailed = strict && !input.evidenceCount && reads.length > 0 && reads.every(a => a.outcome === "failed");
  const searchesMissing = strict && allQueries.size < Math.max(1, input.minimumQueries ?? 1);
  const readKeys = [...new Set(attempts.flatMap(a => a.readKey ? [a.readKey] : []))];
  const seenReads = new Set(history.flatMap(p => p.readKeys ?? []));
  const newReadCount = readKeys.filter(key => !seenReads.has(key)).length;
  let reason = "";
  let failure = false;
  if (!librarySucceeded) { reason = "Required library retrieval has not succeeded; repair access or retry across sources."; failure = true; }
  else if (searchFailed) { reason = "Search calls failed; tool errors are not successful empty searches."; failure = true; }
  else if (readsFailed) { reason = "Original-source reads failed; search candidates do not establish evidence."; failure = true; }
  else if (searchesMissing) reason = "Successful search coverage is insufficient; broaden queries and source coverage before stopping.";
  else if (!input.evidenceCount || !input.covered) reason = "Key evidence has not been obtained and read for every required target; broaden the query and read original sources.";
  else if (input.openGapCount) reason = "Material research questions remain unresolved; seek new evidence or report insufficient evidence.";
  const previous = history.at(-1);
  // This is a no-progress detector, not a total research-round budget. New
  // accepted evidence or resolved gaps allow useful research to continue.
  const stalled = previous?.status === "retry" && previous.newClaimCount === 0 && input.newClaimCount === 0 &&
    !previous.newReadCount && newReadCount === 0 &&
    input.evidenceCount <= previous.evidenceCount && input.openGapCount >= previous.openGapCount;
  const status: ResearchCheckpoint["status"] = !reason ? "ready" : stalled ? failure ? "research_failed" : "insufficient_evidence" : "retry";
  const checkpoint = {round: input.round, status, reason, successfulQueries, attempts, evidenceCount: input.evidenceCount, newClaimCount:input.newClaimCount, readKeys,newReadCount, openGapCount: input.openGapCount};
  state.researchProgress = [...history, checkpoint];
  if (reason) state.researchBlocker = reason; else delete state.researchBlocker;
  return checkpoint;
}

export function researchProgressPrompt(state: ResearchProgressState): string {
  const last = state.researchProgress?.at(-1);
  return `\nRETRIEVAL COMPLETION RULE: distinguish tool failure, a successful search with no matches, missing key evidence, and completed research. Repair/retry failed calls; for empty results broaden or rephrase keywords and search all authorized sources before targeted searches. Read actual sources. Do not infer that a fact is absent from an empty index or claim research is complete because the probability stayed unchanged. Keep material uncertainties as research_gaps.\n` +
    (last?.status === "retry" ? `PREVIOUS PASS NEEDS FURTHER RESEARCH: ${last.reason}\nPrevious attempted queries/outcomes: ${JSON.stringify(last.attempts)}\nUse a different or broader query and another available source, not an identical failed request.\n` : "");
}
