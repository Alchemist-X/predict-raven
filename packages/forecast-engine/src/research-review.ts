import { isLocalResearchUrl } from "./url";
// Explicit questions link inference back to retrieval without changing answers.
import { callResearchTool, researchSourceUrls, signalDeskEnabled } from "./research-tools";
import { collectExpandedLibrary, mergeExpandedLibrary } from "./expanded-library";
import type { AgentRunResult } from "./claude-agent";
import type { ExpandedLibraryCoverage } from "./answer-types";
import { retryRetrieval } from "./research-progress";

export interface ResearchGapRequest {
  id: string; targetIds: string[]; question: string; whyMaterial: string;
  query: string; keywords: string[]; priority: "high" | "medium";
}
export interface ResearchGapResolution { id: string; reason: string; sourceUrls: string[] }
export interface FollowupReading { url: string; title: string; text: string; offset: number; sha256: string; nextOffset?: number | null; totalChars?: number }
export interface ResearchGap extends ResearchGapRequest {
  raisedRound: number; status: "open" | "searched" | "resolved" | "unavailable";
  attempts: Array<{outcome?: "results" | "no_results" | "partial" | "failed"; promptMode?: "directory"; round: number; query: string; status: "ok" | "partial" | "error"; sourceUrls: string[]; errors: string[]; publicReadings: FollowupReading[]}>;
  resolution?: ResearchGapResolution & {round: number};
}
export interface ResearchReviewOutput { researchGaps: ResearchGapRequest[]; gapResolutions: ResearchGapResolution[] }
export interface ResearchReviewState { readSourceUrls?: string[]; researchGaps?: ResearchGap[]; expandedLibrary?: ExpandedLibraryCoverage | null }
const nonempty = (value: unknown, name: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid research ${name}`);
  return value.trim();
};
function list(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`Invalid research ${name}`);
  return [...new Set(value.map(v => nonempty(v, name)))];
}
function url(value: unknown): string {
  const result = nonempty(value, "source URL");
  if (isLocalResearchUrl(result)) return result;
  const parsed = new URL(result);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Research sources need HTTP(S) URLs without credentials");
  return result;
}
export function parseResearchReview(raw: unknown, targets?: string[]): ResearchReviewOutput {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const gaps = source.research_gaps ?? [], resolutions = source.gap_resolutions ?? [];
  if (!Array.isArray(gaps) || !Array.isArray(resolutions)) throw new Error("Research gaps/resolutions must be arrays");
  const researchGaps = gaps.map(value => {
    if (!value || typeof value !== "object") throw new Error("Invalid research gap");
    const g = value as Record<string, unknown>, targetIds = list(g.targetIds, "targets");
    if (targets && targetIds.some(id => !targets.includes(id))) throw new Error("Research gap target is outside the frozen question");
    if (g.priority !== "high" && g.priority !== "medium") throw new Error("Research gap priority must be high or medium");
    const id = nonempty(g.id, "gap id");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("Research gap ids must be stable identifiers");
    return {id, targetIds, question: nonempty(g.question, "question"), whyMaterial: nonempty(g.whyMaterial, "importance"), query: nonempty(g.query, "query"), keywords: list(g.keywords, "keywords"), priority: g.priority} as ResearchGapRequest;
  });
  const gapResolutions = resolutions.map(value => {
    if (!value || typeof value !== "object") throw new Error("Invalid research gap resolution");
    const r = value as Record<string, unknown>;
    return {id: nonempty(r.id, "gap id"), reason: nonempty(r.reason, "resolution"), sourceUrls: list(r.sourceUrls, "resolution sources").map(url)};
  });
  if (new Set(researchGaps.map(g => g.id)).size !== researchGaps.length || new Set(gapResolutions.map(g => g.id)).size !== gapResolutions.length) throw new Error("Research gap ids must be unique within a round");
  return {researchGaps, gapResolutions};
}
export function applyResearchReview(state: ResearchReviewState, proposal: ResearchReviewOutput, round: number, observedSources: Iterable<string>): void {
  const current = structuredClone(state.researchGaps ?? []), observed = new Set(observedSources);
  for (const request of proposal.researchGaps) {
    const old = current.find(g => g.id === request.id);
    if (old) {
      if (old.question !== request.question || JSON.stringify(old.targetIds) !== JSON.stringify(request.targetIds)) throw new Error(`Research gap ${request.id} cannot be repurposed`);
      if (old.status !== "resolved") Object.assign(old, request);
    } else current.push({...request, raisedRound: round, status: "open", attempts: []});
  }
  for (const resolution of proposal.gapResolutions) {
    const gap = current.find(g => g.id === resolution.id);
    if (!gap || gap.raisedRound >= round) throw new Error("Resolve an existing research question after a later evidence pass");
    const available = new Set([...observed, ...gap.attempts.filter(a => a.promptMode !== "directory").flatMap(a => a.sourceUrls)]);
    if (resolution.sourceUrls.some(u => !available.has(u))) throw new Error(`Resolution for ${gap.id} cites a source absent from actual retrieval`);
    gap.status = "resolved";
    gap.resolution = {...resolution, round};
  }
  state.researchGaps = current;
}
// Keep model-initiated reads as provenance even if its proposed answer is rejected.
// Only extend existing pre-read articles; unrelated discoveries do not silently
// become a new mandatory-use list. Whole text stays in private forecast state.
export function recordModelReads(state: ResearchReviewState, result: Pick<AgentRunResult, "readSourceUrls" | "researchReadings">): void {
  if (result.readSourceUrls?.length) state.readSourceUrls = [...new Set([...(state.readSourceUrls ?? []), ...result.readSourceUrls])];
  const coverage = state.expandedLibrary;
  if (!coverage) return;
  for (const read of result.researchReadings ?? []) {
    const originals = coverage.readings.filter(r => r.articleId === read.article_id);
    for (const original of originals) {
      const reading = {...original, url:read.url, text:read.text, offset:read.offset ?? 0, sha256:read.sha256,
        title:read.title ?? original.title, contentKind:read.content_kind, access:read.access,
        format:read.tool === "signal_desk_pdf" ? "pdf" as const : "markdown" as const,
        apiDate:read.date ?? original.apiDate, nextOffset:read.next_offset, totalChars:read.total_chars,
        startPage:read.start_page, nextPage:read.next_page, totalPages:read.total_pages,
        pages:read.pages?.map(p => ({page:p.page,textChars:p.text_chars,truncated:p.truncated})),
        readArguments:undefined, endOffset:(read.offset ?? 0) + read.text.length};
      if (!coverage.readings.some(r => r.targetId === reading.targetId && r.articleId === reading.articleId && r.url === reading.url && r.sha256 === reading.sha256 && r.offset === reading.offset && r.startPage === reading.startPage && r.text === reading.text)) coverage.readings.push(reading);
    }
  }
}
export function materialResearchGaps(state: ResearchReviewState): ResearchGap[] {
  return (state.researchGaps ?? []).filter(g => g.priority === "high" && g.status !== "resolved");
}
export function researchGapSources(state: ResearchReviewState): string[] {
  return [...new Set((state.researchGaps ?? []).flatMap(g => g.attempts.flatMap(a => a.sourceUrls)))];
}
// Legacy inline excerpts remain eligible; a directory needs a model tool read.
export function modelVisibleSourceUrls(state: ResearchReviewState): string[] {
  return [...new Set([...(state.readSourceUrls ?? []),
    ...(state.expandedLibrary?.inlineSourceUrls ?? []),
    ...(state.expandedLibrary?.modelReadRequired ? [] : state.expandedLibrary?.readings.map(r => r.url) ?? []),
    ...(state.researchGaps ?? []).flatMap(g => g.attempts.filter(a => a.promptMode !== "directory").flatMap(a => a.sourceUrls))])];
}

export function assertModelReadSources(state: ResearchReviewState, urls: Iterable<string>): void {
  if (!signalDeskEnabled()) return;
  const visible = new Set(modelVisibleSourceUrls(state));
  const missing = [...new Set(urls)].filter(url => !visible.has(url));
  if (missing.length) throw new Error(`Cited sources require actual model reading, not discovery or a directory: ${missing.join(", ")}`);
}
export function researchEvidenceSources(state: ResearchReviewState, trace: Iterable<string>): string[] {
  return signalDeskEnabled() ? modelVisibleSourceUrls(state) : [...new Set([...trace, ...modelVisibleSourceUrls(state)])];
}

export const RESEARCH_REVIEW_INSTRUCTIONS = `
Research is iterative: first establish the evidence across candidates, then assess implications. Do not use a current probability/ranking as a retrieval target.
Whenever a material doubt appears (missing official baseline, conflicting figures, summary versus PDF/table, cash versus lease-inclusive capex, forecast versus guidance, project timing/commitments, weak countercase), search again before calling it resolved. Return specific unanswered questions in research_gaps, with short company/topic keywords and a public query. The engine will execute another retrieval pass. Do not turn "not found in one page/index" into "not disclosed".
Return gap_resolutions only for existing gaps whose evidence has actually been reviewed; include the supporting source URLs and what changed in the interpretation. A successful search is not itself a resolution. If sources disagree or access fails, retain the gap. No requirement to force every article into the conclusion.
Add these arrays to the JSON: "research_gaps":[{"id":"stable_gap_id","targetIds":["entity_id"],"question":"specific uncertainty","whyMaterial":"which assumption or forecast driver this can change","query":"public search query","keywords":["company","topic"],"priority":"high"}],"gap_resolutions":[{"id":"existing_gap_id","reason":"what the read evidence resolves, with accounting period and definition","sourceUrls":["https://..."]}]. Empty arrays are allowed only when no such questions remain.
`;
export function researchReviewPrompt(state: ResearchReviewState): string {
  for (const gap of state.researchGaps ?? []) for (const attempt of gap.attempts) attempt.promptMode = "directory";
  const directory = (state.researchGaps ?? []).map(g => ({...g, attempts:g.attempts.map(a => ({...a,
    publicReadings:a.publicReadings.map(({text,...r}) => ({...r,textAvailableChars:text.length,retrieve:{tool:"fetch_page",arguments:{url:r.url,offset:r.offset,max_chars:0}}}))}))}));
  return RESEARCH_REVIEW_INSTRUCTIONS + `\nQUESTION-LED RETRIEVAL DIRECTORY (full received text remains in private state; retrieve the relevant passages before resolving a gap):\n${JSON.stringify(directory)}\n`;
}
export async function retrieveResearchGaps(state: ResearchReviewState, round: number, log: (s: string) => void = () => {}, opts: {
  callTool?: typeof callResearchTool; collectLibrary?: typeof collectExpandedLibrary;
} = {}): Promise<void> {
  if (!signalDeskEnabled()) return;
  const call = opts.callTool ?? callResearchTool, collect = opts.collectLibrary ?? collectExpandedLibrary;
  const pending = (state.researchGaps ?? []).filter(g => g.status !== "resolved")
    .sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high"));
  for (const gap of pending) {
    log(`  Re-searching ${gap.id}: ${gap.question}`);
    const errors: string[] = [], sourceUrls: string[] = [], publicReadings: FollowupReading[] = [];
    let partialSearch = false;
    let extra: ExpandedLibraryCoverage | null = null;
    try { extra = await collect({searchQueries: gap.targetIds.map(targetId => ({targetId, query: gap.query, keywords: gap.keywords}))}, log,
      {mode: "focused"}); } catch (error) { errors.push(error instanceof Error ? error.message : "Library retrieval failed"); }
    if (extra) {
      state.expandedLibrary = mergeExpandedLibrary(state.expandedLibrary ?? null, extra);
      sourceUrls.push(...extra.readings.map(r => r.url));
      errors.push(...extra.queries.filter(q => q.status !== "ok" || q.error).map(q => q.error ?? q.status), ...(extra.readingErrors ?? []).map(e => e.error));
    }
    try {
      const search = await retryRetrieval(call, "web_search", {query: gap.query, research_keywords: gap.keywords, limit: null});
      if (search.error) errors.push(String(search.error));
      if (search.status === "partial") {
        partialSearch = true;
        errors.push("Some search branches failed or returned incomplete coverage; available results were retained.");
      }
      const candidates = Array.isArray(search.results) ? search.results as Record<string, unknown>[] : [];
      const allowed = new Set(researchSourceUrls(search));
      const pages = [...new Set(candidates.map(r => r.url).filter((u): u is string => typeof u === "string" && allowed.has(u) && new URL(u).hostname !== "geoscopeapp.com"))];
      for (const page of pages) {
        let offset = 0;
        while (true) {
        try {
          const read = await call("fetch_page", {url: page, offset, max_chars: 0});
          if (read.status !== "ok" || typeof read.text !== "string" || !read.text.trim()) throw new Error(String(read.error ?? "No readable text"));
          if (!researchSourceUrls(read).includes(page)) throw new Error("Page read did not return matching provenance");
          sourceUrls.push(page);
          publicReadings.push({url: page, title: String(read.title ?? page), text: read.text, offset: Number(read.offset ?? offset), sha256: String(read.sha256 ?? ""), nextOffset: typeof read.next_offset === "number" ? read.next_offset : null, totalChars: typeof read.total_chars === "number" ? read.total_chars : undefined});
          if (read.next_offset == null) break;
          if (typeof read.next_offset !== "number" || !Number.isInteger(read.next_offset) || read.next_offset <= offset) throw new Error("Page pagination did not advance");
          offset = read.next_offset;
        } catch (error) { errors.push(`${page}: ${error instanceof Error ? error.message : "Read failed"}`); break; }
        }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : "Public search failed"); }
    const status = errors.length ? sourceUrls.length || partialSearch ? "partial" : "error" : "ok";
    const outcome = status === "error" ? "failed" : status === "partial" ? "partial" : sourceUrls.length ? "results" : "no_results";
    gap.attempts.push({outcome,promptMode:"directory",round, query: gap.query, status, sourceUrls: [...new Set(sourceUrls)], errors, publicReadings});
    gap.status = sourceUrls.length ? "searched" : "unavailable";
    log(`  Follow-up ${gap.id}: ${new Set(sourceUrls).size} read sources; ${errors.length} access issues. Awaiting evidence review.`);
  }
}
