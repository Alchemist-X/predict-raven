import { isLocalResearchUrl } from "./url";
// Native categorical, numerical and independent-event ranking research loop.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { providerName } from "./agent";
import type { AgentRunResult } from "./claude-agent";
import type { AnswerRequest, QuestionSpec, StructuredAnswer, StructuredClaim, StructuredForecastState, StructuredRound } from "./answer-types";
import { answerLabel, isStructuredForecast } from "./answer-types";
import { answerMovement, applyStructuredClaim, initialAnswer } from "./answer-math";
import { eventDir } from "./store";
import { collectExpandedLibrary, libraryPrompt, validateLibraryUse } from "./expanded-library";
import { assessResearchProgress, incompleteResearch, researchProgressPrompt, researchRoundLimit, roundLimitLabel } from "./research-progress";
import { finite, object, text, validatedCall, validateAnswerRequest, validateQuestionSpec } from "./question-spec";
import type { AgentRunner } from "./question-spec";
import { canonicalizeUrl } from "./url";
import { languageDirective } from "./language";
import { recordModelReads, parseResearchReview, applyResearchReview, retrieveResearchGaps, researchReviewPrompt, modelVisibleSourceUrls, assertModelReadSources, researchEvidenceSources, materialResearchGaps, researchGapSources } from "./research-review";
import type { ResearchGapRequest, ResearchGapResolution } from "./research-review";
import { isMarketPriceSource, marketBlind } from "./market-blind";
import type { Confidence, SourceType } from "./types";

const SOURCE_TYPES = new Set(["official", "data", "academic", "original_reporting", "press", "insider", "secondary"]);
function strings(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.some(s => typeof s !== "string")) throw new Error(`${label} must be a string array`);
  return raw as string[];
}
interface RoundProposal {
  researchGaps?: ResearchGapRequest[];
  gapResolutions?: ResearchGapResolution[];
  claims: StructuredClaim[];
  summary: string;
  confidence: Confidence;
  exclusions: Array<{articleId: string; reason: string}>;
}
export function validateStructuredRound(raw: unknown, spec: QuestionSpec): RoundProposal {
  const o = object(raw, "round");
  if (!Array.isArray(o.claims) || o.claims.length > 60) throw new Error("claims must be an array with at most 60 items");
  const ids = new Set(spec.options.map(e => e.id));
  const claims = o.claims.map(rawClaim => {
    const c = object(rawClaim, "claim");
    const targetIds = strings(c.targetIds, "targetIds");
    if (!targetIds.length || targetIds.some(id => id !== "question" && !ids.has(id))) throw new Error("Claim target must belong to the frozen question");
    if (spec.kind === "independent_ranking" && targetIds.includes("question")) throw new Error("Ranking claims must name their affected entity ids");
    if (!SOURCE_TYPES.has(c.sourceType as string)) throw new Error("Unknown source type");
    const sourceUrl = text(c.sourceUrl, "sourceUrl");
    const parsed = new URL(sourceUrl);
    if (!isLocalResearchUrl(sourceUrl) && (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)) throw new Error("Source must be an HTTP(S) URL without credentials");
    const publishedAt = c.publishedAt === null ? null : text(c.publishedAt, "publishedAt");
    if (publishedAt !== null && (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt.slice(0, 10)).toISOString().slice(0, 10) !== publishedAt.slice(0, 10) || publishedAt.slice(0, 10) > spec.asOfDate)) throw new Error("Source date is invalid or after the research cutoff");
    const rawEffects = object(c.effects ?? {}, "effects"), effects: Record<string, number> = {};
    for (const [id, value] of Object.entries(rawEffects)) {
      if (!ids.has(id)) throw new Error("Unknown option in evidence effects");
      effects[id] = finite(value, `effects.${id}`);
      if (Math.abs(effects[id]) > 2) throw new Error("Evidence effect is outside [-2,2]");
    }
    if (spec.kind === "independent_ranking" && Object.keys(effects).some(id => !targetIds.includes(id))) throw new Error("Effects may only change the claim's named entities");
    let numericSignal: StructuredClaim["numericSignal"] = null;
    if (c.numericSignal != null) {
      const n = object(c.numericSignal);
      numericSignal = {mean: finite(n.mean, "numericSignal.mean"), standardDeviation: finite(n.standardDeviation, "numericSignal.standardDeviation")};
      if (numericSignal.standardDeviation <= 0 || spec.minimum !== null && numericSignal.mean < spec.minimum || spec.maximum !== null && numericSignal.mean > spec.maximum) throw new Error("Numeric signal violates the frozen scale");
    }
    if (spec.kind === "numeric" && Object.keys(effects).length || spec.kind !== "numeric" && numericSignal) throw new Error("Evidence update has the wrong answer type");
    if (!["fact", "source_opinion", "estimate"].includes(c.epistemicStatus as string)) throw new Error("Claim epistemicStatus must distinguish facts, opinions and estimates");
    const quote = text(c.quote, "quote");
    if (quote.length > 300) throw new Error(`Use a short original quotation, at most 300 characters: claim ${c.id} contains ${quote.length}. Select a shorter exact substring in the source language.`);
    return {id: text(c.id, "claim.id"), claim: text(c.claim, "claim"), targetIds, sourceUrl, sourceTitle: text(c.sourceTitle, "sourceTitle"), sourceType: c.sourceType as SourceType,
      publishedAt, quote, rationale: text(c.rationale, "rationale"), clusterId: text(c.clusterId, "clusterId"), effects, numericSignal,
      articleId: c.articleId == null ? null : text(c.articleId, "articleId"), epistemicStatus: c.epistemicStatus as StructuredClaim["epistemicStatus"]};
  });
  if (new Set(claims.map(c => c.id)).size !== claims.length) throw new Error("Claim ids must be unique within a round");
  const exclusions = Array.isArray(o.exclusions) ? o.exclusions.map(raw => {const e = object(raw); return {articleId: text(e.articleId, "articleId"), reason: text(e.reason, "exclusion reason")};}) : [];
  if (!["high", "medium", "low"].includes(o.confidence as string)) throw new Error("Invalid round confidence");
  const review = o.research_gaps !== undefined || o.gap_resolutions !== undefined ? parseResearchReview(o, spec.kind === "independent_ranking" ? [...ids] : ["question", ...ids]) : {};
  return {claims, exclusions, summary: text(o.summary, "round summary"), confidence: o.confidence as Confidence, ...review};
}
export function newStructuredState(eventId: string, eventText: string, request: AnswerRequest, spec: QuestionSpec): StructuredForecastState {
  if (spec.kind === "binary") throw new Error("Use the existing binary engine");
  const now = new Date().toISOString();
  return {schemaVersion: 2, eventId, eventText, request, questionSpec: spec, createdAtUtc: now, updatedAtUtc: now,
    status: "open", round: 0, answer: initialAnswer(spec), evidenceLedger: [], roundHistory: [], expandedLibrary: null, summary: null, provider: providerName()};
}
export function validateStructuredState(raw: unknown): StructuredForecastState {
  if (!isStructuredForecast(raw)) throw new Error("Not a structured forecast state");
  const s = raw;
  if (!s.questionSpec || s.questionSpec.kind === "binary") throw new Error("Invalid structured question");
  const spec = validateQuestionSpec(s.questionSpec, s.eventText, s.questionSpec.kind, validateAnswerRequest(s.request), s.questionSpec.asOfDate);
  if (!Array.isArray(s.evidenceLedger) || !Array.isArray(s.roundHistory) || s.round !== s.roundHistory.length) throw new Error("Invalid structured history");
  let answer = initialAnswer(spec);
  const checkpoints = new Map<number, StructuredAnswer>();
  const counts = new Map<number, number>();
  let lastRound = 1;
  for (const entry of s.evidenceLedger) {
    if (!Number.isInteger(entry.round) || entry.round < lastRound || entry.round < 1 || entry.round > s.round) throw new Error("Invalid evidence round assignment");
    lastRound = entry.round;
    if (JSON.stringify(entry.before) !== JSON.stringify(answer)) throw new Error("Broken evidence continuity");
    const validated = validateStructuredRound({claims: [entry], confidence: "medium", summary: "replay"}, spec).claims[0];
    if (!Number.isFinite(entry.effectiveWeight) || entry.effectiveWeight < 0 || entry.effectiveWeight > 1) throw new Error("Invalid evidence weight");
    answer = applyStructuredClaim(spec, answer, validated, entry.effectiveWeight);
    if (JSON.stringify(entry.after) !== JSON.stringify(answer)) throw new Error("Stored evidence update does not replay");
    checkpoints.set(entry.round, structuredClone(answer));
    counts.set(entry.round, (counts.get(entry.round) ?? 0) + 1);
  }
  if (JSON.stringify(s.answer) !== JSON.stringify(answer)) throw new Error("Stored answer does not match its evidence history");
  let previous = initialAnswer(spec);
  for (const [i, round] of s.roundHistory.entries()) {
    if (round.round !== i + 1 || JSON.stringify(round.before) !== JSON.stringify(previous)) throw new Error("Broken round continuity");
    const expected = checkpoints.get(round.round) ?? previous;
    if (JSON.stringify(round.after) !== JSON.stringify(expected) || round.newClaimCount !== (counts.get(round.round) ?? 0)) throw new Error("Round history does not match its evidence ledger");
    previous = round.after;
  }
  if (s.round && JSON.stringify(previous) !== JSON.stringify(s.answer)) throw new Error("Round history does not end at the answer");
  return s;
}
export function loadStructuredState(eventId: string): StructuredForecastState | null {
  const file = path.join(eventDir(eventId), "state.json");
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return isStructuredForecast(raw) ? validateStructuredState(raw) : null;
}
function atomic(file: string, text: string): void { writeFileSync(file + ".tmp", text, {mode: 0o600}); renameSync(file + ".tmp", file); }
export function saveStructuredState(state: StructuredForecastState): void {
  const dir = eventDir(state.eventId); mkdirSync(dir, {recursive: true, mode: 0o700});
  atomic(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
  atomic(path.join(dir, "report.md"), renderStructuredReport(state));
}
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
export function renderStructuredReport(s: StructuredForecastState): string {
  const spec = s.questionSpec, answer = s.answer;
  const lines = [`# ${s.eventText}`, "", `**${answerLabel(answer)}**`, "", `答案类型：${answer.kind}。研究日：${spec.asOfDate}；截止日：${spec.resolutionDate}。状态：${s.status}。`, ""];
  if (incompleteResearch(s.status)) lines.splice(2, 0, `**研究未完成：${s.researchBlocker ?? s.error ?? s.status}。以下数值是暂存估计，不是完成研究后的结论。**`, "");
  if (answer.kind === "numeric") lines.push(`数值：${answer.pointEstimate} ${answer.unit}；模型范围：${answer.modelRange.join(" – ")} ${answer.unit}。`, answer.rangeDescription, `评分/测量定义：${spec.scoreRubric ?? spec.resolutionCriteria}`, "");
  else {
    lines.push("| 候选 | 概率 |", "| --- | ---: |");
    for (const r of answer.kind === "categorical" ? answer.probabilities : answer.ranking) lines.push(`| ${cell(r.label)} | ${(r.probability * 100).toFixed(1)}% |`);
    lines.push("", answer.kind === "categorical" ? "选项互斥且穷尽，概率合计 100%。" : "各公司事件可以同时发生，也可能均不发生；概率不归一化。排名不是谁最先发生的概率。", "");
    if (answer.tiedIds.length > 1) lines.push(`并列首选：${answer.tiedIds.join("、")}。`, "");
  }
  lines.push("## 结算口径", spec.resolutionCriteria, `结算来源：${spec.settlementSource}`, ...spec.assumptions.map(a => `- ${a}`), "");
  if (s.summary) lines.push("## Insight Summary", s.summary.verdict, "", ...s.summary.keyFindings.map(a => `- ${a}`), "", "## 反证与不确定性", ...s.summary.counterarguments.map(a => `- ${a}`), ...s.summary.uncertainties.map(a => `- ${a}`), "");
  lines.push("## 关键事实与原文", "| 事实或来源观点 | 原文短句 | 来源/日期 | 性质 |", "| --- | --- | --- | --- |");
  for (const e of s.evidenceLedger) lines.push(`| ${cell(e.claim)} | ${cell(e.quote)} | [${cell(e.sourceTitle)}](${e.sourceUrl}) · ${e.publishedAt ?? "原始日期未核实"} | ${e.epistemicStatus}; ${e.verifiedInSearchTrace ? "检索/读取已记录" : "来源未核实，未赋权"} |`);
  lines.push("", "## 扩展资源库使用", s.expandedLibrary ? `实际搜索 ${s.expandedLibrary.queries.length} 次，读取 ${s.expandedLibrary.readings.length} 个片段，使用 ${s.expandedLibrary.usedArticleIds.length} 篇。` : "本次未启用。", "");
  for (const q of s.expandedLibrary?.queries ?? []) lines.push(`- ${q.targetId}：${q.status}，${q.total ?? "未知"} 条候选${q.error ? `；${q.error}` : ""}`);
  for (const e of s.expandedLibrary?.exclusions ?? []) lines.push(`- 未采用 ${e.articleId}：${e.reason}`);
  for (const e of s.expandedLibrary?.readingErrors ?? []) lines.push(`- 读取失败 ${e.articleId}：${e.error}`);
  lines.push("", "## 方法与局限", spec.priorRationale, "数值由引擎按已接受的证据逐步更新；来源相关性被折减，未经检索核验的来源不赋权。模型提出的证据强度与起点属于主观判断，尚无本题类型的长期校准。", "");
  return lines.join("\n");
}
export function applyStructuredRound(state: StructuredForecastState, proposal: RoundProposal, result: AgentRunResult): StructuredRound {
  recordModelReads(state, result);
  assertModelReadSources(state, proposal.claims.map(claim => claim.sourceUrl));
  const before = structuredClone(state.answer), roundNo = state.round + 1;
  const seenIds = new Set(state.evidenceLedger.map(e => e.id));
  const seenClaims = new Set(state.evidenceLedger.map(e => e.claim.toLowerCase().replace(/\s+/g, " ").trim()));
  const verifiedUrls = new Set(researchEvidenceSources(state, result.searchResultUrls).map(canonicalizeUrl));
  if (state.researchGaps || proposal.researchGaps?.length || proposal.gapResolutions?.length) applyResearchReview(state, {researchGaps:proposal.researchGaps ?? [], gapResolutions:proposal.gapResolutions ?? []}, roundNo,
    modelVisibleSourceUrls(state));
  let accepted = 0, duplicates = 0;
  for (const claim of proposal.claims) {
    const normalized = claim.claim.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenIds.has(claim.id) || seenClaims.has(normalized)) { duplicates++; continue; }
    seenIds.add(claim.id); seenClaims.add(normalized);
    const verified = verifiedUrls.has(canonicalizeUrl(claim.sourceUrl));
    const clusterCount = state.evidenceLedger.filter(e => e.clusterId === claim.clusterId && e.effectiveWeight > 0).length;
    const effectiveWeight = verified && !(marketBlind() && isMarketPriceSource(claim.sourceUrl)) ? 1 / (1 + clusterCount) : 0;
    const prior = structuredClone(state.answer);
    state.answer = applyStructuredClaim(state.questionSpec, prior, claim, effectiveWeight);
    state.evidenceLedger.push({...claim, round: roundNo, verifiedInSearchTrace: verified, effectiveWeight, before: prior, after: structuredClone(state.answer)});
    accepted++;
  }
  if (state.expandedLibrary) {
    state.expandedLibrary.usedArticleIds = [...new Set(state.evidenceLedger.flatMap(e => e.articleId && e.effectiveWeight > 0 && state.expandedLibrary!.readings.some(r => r.articleId === e.articleId && r.url === e.sourceUrl && r.text.includes(e.quote)) ? [e.articleId] : []))];
    state.expandedLibrary.exclusions = [...new Map([...state.expandedLibrary.exclusions, ...proposal.exclusions].map(e => [e.articleId, e])).values()];
  }
  const now = new Date().toISOString();
  const record: StructuredRound = {round: roundNo, ts: now, before, after: structuredClone(state.answer), newClaimCount: accepted, duplicateCount: duplicates,
    confidence: proposal.confidence, reasoning: proposal.summary, searchQueries: result.searchQueries, searchResultUrls: [...result.searchResultUrls], costUsd: result.costUsd, retrievalAttempts:result.retrievalAttempts};
  state.round = roundNo; state.updatedAtUtc = now; state.roundHistory.push(record);
  return record;
}
export interface StructuredRunOptions { maxRounds?: number; model?: string; runAgentFn?: AgentRunner; onLog?: (message: string) => void; collectLibraryFn?: typeof collectExpandedLibrary; retrieveGapsFn?: typeof retrieveResearchGaps }
export async function runStructuredForecast(state: StructuredForecastState, opts: StructuredRunOptions = {}): Promise<StructuredForecastState> {
  const maxRounds = researchRoundLimit(opts.maxRounds), log = opts.onLog ?? (() => {});
  const pendingSummary = state.summaryPendingStatus;
  if (!pendingSummary && state.round >= maxRounds && state.status !== "aborted") {
    if (state.status === "open") {
      state.status = "max_rounds"; state.summary = null;
      state.researchBlocker = "Research was interrupted at the explicit round budget before completion was recorded.";
      saveStructuredState(state);
    }
    return state;
  }
  let recovered: AgentRunResult | undefined;
  if (state.status === "aborted") {
    const attempts = [1,2].flatMap(attempt => {
      const file = path.join(eventDir(state.eventId), `round-${state.round + 1}-attempt-${attempt}.json`);
      if (!existsSync(file)) return [];
      try {const raw=JSON.parse(readFileSync(file,"utf8"));return raw.exitCode === 0 && raw.jsonObject && Array.isArray(raw.searchResultUrls) ? [raw] : [];} catch {return [];}
    });
    if (attempts.length) {
      const last = attempts[attempts.length - 1];
      recovered = {...last, readSourceUrls:[...new Set(attempts.flatMap(r => r.readSourceUrls ?? []))] as string[],researchReadings:attempts.flatMap(r => r.researchReadings ?? []), searchResultUrls:new Set(attempts.flatMap(r=>r.searchResultUrls)),searchQueries:[...new Set(attempts.flatMap(r=>r.searchQueries))] as string[],
        retrievalAttempts:attempts.flatMap(r => r.retrievalAttempts ?? []),
        costUsd:attempts.some(r=>r.costUsd !== null) ? attempts.reduce((sum,r)=>sum+(r.costUsd??0),0) : null};
      log("Resuming validation from saved research; original attempts remain archived.");
    }
  }
  state.status = pendingSummary ?? (state.round >= maxRounds ? "max_rounds" : "open");
  delete state.error;
  state.updatedAtUtc = new Date().toISOString();
  saveStructuredState(state);
  try {
    if (!pendingSummary && !state.expandedLibrary) { state.expandedLibrary = await (opts.collectLibraryFn ?? collectExpandedLibrary)(state.questionSpec, log); saveStructuredState(state); }
    for (let round = state.round + 1; !pendingSummary && round <= maxRounds; round++) {
      if (!recovered && materialResearchGaps(state).length) {
        await (opts.retrieveGapsFn ?? retrieveResearchGaps)(state, round, log, {collectLibrary:opts.collectLibraryFn});
        saveStructuredState(state);
      }
      log(`Round ${round}/${roundLimitLabel(maxRounds)} · ${answerLabel(state.answer)}`);
      const {prior: _prior, priorRationale: _priorRationale, ...researchQuestion} = state.questionSpec;
      const prompt = `You are conducting an auditable forecast with a frozen answer space. Research every option/entity, primary sources first. Return atomic facts and forward-looking implications, NOT a new final answer. The engine alone applies updates.
FROZEN QUESTION: ${JSON.stringify(researchQuestion)}
ROUND: ${round}/${roundLimitLabel(maxRounds)}. ${round > 1 ? "Prioritize the strongest countercase, source cross-checks and previously uncovered entities. Do not repeat facts already counted." : "Establish comparable current facts, reference classes and drivers across every option/entity."}
PREVIOUS CLAIMS: ${JSON.stringify(state.evidenceLedger.map(e => ({id:e.id,claim:e.claim,targetIds:e.targetIds,sourceUrl:e.sourceUrl,clusterId:e.clusterId})))}
${libraryPrompt(state.expandedLibrary)}
${researchReviewPrompt(state)}
${researchProgressPrompt(state)}
Use web_search, signal_desk_read or fetch_page for actual research. Public dates must be checked; API dates alone do not establish publication dates. Include accurate original short quotes, values/units/periods and stable URLs. Each ranked entity must have evidence; lack of company guidance is a gap, not zero risk. Do not count syndication as independent evidence; share clusterId for the same underlying fact/story. Source opinion is not company guidance.
Each claim contains one independently checkable proposition. Split guidance, actual spending, cash balances and author forecasts into separate claims; share clusterId where the same underlying financial story makes them dependent. Put implications in rationale, never disguise a multi-fact paragraph as one fact. Every quote is an exact substring in the source language, at most 300 characters, not a summary.
Effects: signed log-likelihood adjustments in [-2,2], sparse keys for the frozen option ids. Positive favors that event/option; negative opposes it. Explain why. The engine caps |effect| at 1 and discounts clusters; do not compensate by multiplying claims. Ranking effects change only named targetIds independently. Categorical effects are relative likelihoods and the engine normalizes all options. Neutral/context claims use effects={}. Numeric: effects={}, and numericSignal only when this evidence supplies a forward estimate of the SAME target, period and unit; supply mean and standardDeviation, otherwise null. Historical facts are not independent measurements of the future target. Numeric signals use engine precision updates and must not imply empirically calibrated uncertainty.
No future information after ${state.questionSpec.asOfDate}, no market-implied probabilities, no trading. For each pre-read library article either use a relevant claim with articleId + exact quote from that text or return a specific exclusion reason. Previously used/excluded articles need not be used again.
The exclusions array only lists ids in the engine's pre-read library pack. Put assessments of other newly discovered sources in the summary, not this array.
${languageDirective()}
JSON only: {"summary":"...","confidence":"medium","claims":[{"id":"stable_fact_id","claim":"atomic dated fact or attributed forecast","targetIds":["entity_id"],"sourceUrl":"https://...","sourceTitle":"...","sourceType":"official|data|academic|original_reporting|press|insider|secondary","publishedAt":"YYYY-MM-DD or null","quote":"short exact original text","rationale":"how this affects the frozen target","clusterId":"underlying_story","effects":{"entity_id":0.1},"numericSignal":null,"articleId":null,"epistemicStatus":"fact|source_opinion|estimate"}],"exclusions":[{"articleId":"id","reason":"specific relevance/quality reason"}]}`;
      const { value, result } = await validatedCall(prompt, raw => {
        const proposal = validateStructuredRound(raw, state.questionSpec);
        assertModelReadSources(state, proposal.claims.map(claim => claim.sourceUrl));
        validateLibraryUse(state.expandedLibrary, proposal.claims, proposal.exclusions, state.evidenceLedger, modelVisibleSourceUrls(state));
        applyResearchReview({researchGaps:state.researchGaps}, {researchGaps:proposal.researchGaps ?? [], gapResolutions:proposal.gapResolutions ?? []}, round,
          modelVisibleSourceUrls(state));
        // Missing target evidence triggers another research pass below, rather
        // than a tool-free correction that might encourage an invented claim.
        return proposal;
      }, {...opts, initialResult: recovered, onAttempt: (result, attempt) => {
        recordModelReads(state, result);
        saveStructuredState(state);
        const dir = eventDir(state.eventId);
        const file = path.join(dir, `round-${round}-attempt-${attempt}.json`);
        if (existsSync(file)) renameSync(file, file + `.previous-${Date.now()}`);
        atomic(file, JSON.stringify({...result, searchResultUrls:[...result.searchResultUrls]}, null, 2));
      }});
      recovered = undefined;
      const record = applyStructuredRound(state, value, result);
      saveStructuredState(state);
      log(`Accepted ${record.newClaimCount} claims · ${answerLabel(state.answer)}`);
      const unanswered = materialResearchGaps(state);
      if (unanswered.length) log(`  ${unanswered.length} material questions remain: ${unanswered.map(g => g.id).join(", ")}. A small numerical change is not research completion.`);
      const weightedClaims = state.evidenceLedger.filter(e => e.effectiveWeight > 0);
      const covered = state.questionSpec.kind === "numeric" || state.questionSpec.options.every(o => weightedClaims.some(e => e.targetIds.includes(o.id)));
      const checkpoint = assessResearchProgress(state, result, {round,evidenceCount:weightedClaims.length,covered,openGapCount:unanswered.length,newClaimCount:weightedClaims.filter(e => e.round === round).length});
      if (checkpoint.status === "research_failed" || checkpoint.status === "insufficient_evidence") {
        state.status = checkpoint.status; state.summary = null; log(`${state.status}: ${checkpoint.reason}`); break;
      }
      if (checkpoint.status === "ready" && !unanswered.length && round >= Math.min(2, maxRounds) && record.newClaimCount === 0) { state.status = "no_new_info"; break; }
      if (checkpoint.status === "ready" && !unanswered.length && round >= 2 && weightedClaims.length > 0 && covered && answerMovement(record.before, record.after) < 0.01) { state.status = "converged"; break; }
      if (round === maxRounds) { state.status = "max_rounds"; state.researchBlocker = checkpoint.reason || "Explicit research-round budget exhausted; research is incomplete."; }
    }
    if (incompleteResearch(state.status)) { state.summary = null; saveStructuredState(state); return state; }
    state.summaryPendingStatus = state.status === "converged" ? "converged" : "no_new_info";
    state.status = "open"; state.summary = null;
    saveStructuredState(state);
    const summary = await validatedCall(`Explain this engine result without changing the winner, probabilities, numeric value or units. Distinguish source opinions, financial forecasts and confirmed company facts. Include material counterarguments and missing data. Summarize how the expanded resource library changed or challenged the analysis. Quote sources by title and URL close to claims. Do not expose entire subscription articles.
If synthesis reveals a material unresolved doubt, add a research_gaps request. You cannot search or assert new facts in this synthesis; the engine will reopen research within the round budget. An unresolved material question is not numerical convergence.
${researchReviewPrompt(state)}
${JSON.stringify({question:state.questionSpec,answer:state.answer,claims:state.evidenceLedger.map(({before,after,...e})=>e),library:state.expandedLibrary?.queries})}
${languageDirective()}
JSON only: {"verdict":"...","keyFindings":["..."],"counterarguments":["..."],"uncertainties":["..."],"research_gaps":[],"gap_resolutions":[]}`, raw => {
      const o = object(raw), review = parseResearchReview(o, state.questionSpec.kind === "independent_ranking" ? state.questionSpec.options.map(x => x.id) : ["question", ...state.questionSpec.options.map(x => x.id)]);
      applyResearchReview({researchGaps:state.researchGaps}, review, state.round,
        modelVisibleSourceUrls(state));
      return {summary:{verdict:text(o.verdict,"verdict"),keyFindings:strings(o.keyFindings,"keyFindings"),counterarguments:strings(o.counterarguments,"counterarguments"),uncertainties:strings(o.uncertainties,"uncertainties")},review};
    }, {...opts, allowedTools: ""});
    if (summary.value.review.researchGaps.length || summary.value.review.gapResolutions.length) {
      applyResearchReview(state, summary.value.review, state.round,
        modelVisibleSourceUrls(state));
    }
    state.summary = {...summary.value.summary, uncertainties: [...summary.value.summary.uncertainties, ...materialResearchGaps(state).map(g => `尚未解决：${g.question}；影响：${g.whyMaterial}。已执行 ${g.attempts.length} 次定向补搜；状态 ${g.status}。`)]};
    state.status = state.summaryPendingStatus;
    delete state.summaryPendingStatus;
    delete state.researchBlocker;
    if (materialResearchGaps(state).length) {
      state.status = state.round < maxRounds ? "open" : "max_rounds";
      state.summary = null;
      if (state.status === "max_rounds") state.researchBlocker = "Synthesis identified a material question after the explicit research budget was exhausted.";
      saveStructuredState(state);
      if (state.round < maxRounds) {
        log("Synthesis identified a material question; reopening evidence collection within the remaining round budget.");
        return await runStructuredForecast(state, opts);
      }
    }
    state.updatedAtUtc = new Date().toISOString(); saveStructuredState(state);
    return state;
  } catch (error) {
    state.status = "aborted"; state.summary = null; state.error = error instanceof Error ? error.message : String(error); state.updatedAtUtc = new Date().toISOString(); saveStructuredState(state); throw error;
  }
}
