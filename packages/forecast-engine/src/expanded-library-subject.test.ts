import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "./claude-agent";
import type { ExpandedLibraryCoverage, QuestionSpec } from "./answer-types";
import type { EventFraming } from "./types";

const gateway = vi.hoisted(() => ({ callResearchTool: vi.fn() }));
vi.mock("./research-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./research-tools")>()),
  callResearchTool: gateway.callResearchTool
}));
vi.mock("./agent", () => ({ providerHasWebSearch: () => false, providerName: () => "test", runAgent: vi.fn() }));
vi.mock("./summary", () => ({ summarizeForecast: async () => ({
  verdict: "Summary", keyFactorsYes: [], keyFactorsNo: [], mainUncertainties: "", calibrationNote: ""
}) }));
import { binaryLibraryUsage, collectExpandedLibrary, libraryPrompt, validateLibraryUse } from "./expanded-library";
import { libraryPlanPrompt, newForecastState, parseLibraryPlan, runForecast } from "./engine";
import { validateQuestionSpec } from "./question-spec";
import { newStructuredState, renderStructuredReport, runStructuredForecast } from "./structured-engine";

// A fake signal_desk_search following the raven-signal-desk gateway contract
// (raven_signal_desk/research.py, _signal_search): subject is probed first
// and, when covered, ANDed into every query. Online
// Foreign Research summaries are matched by upstream relevance, not literal words.
interface Doc { id: string; title: string; text: string; online?: (terms: string[]) => boolean }
const literal = (term: string) => new RegExp(
  (/^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9_])" : "") + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
  (/[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9_])" : ""), "i");
const bareUni = (terms: string[]) => terms.length === 1 && terms[0].toLowerCase() === "uni";
// The library as of 2026-09-29: nothing about Uniswap, but plenty that shares a word with the plan.
const UNISWAP_FREE: Doc[] = [
  { id: "binance-listing", title: "Binance adds perpetual listings", text: "Binance listed new perpetual contracts as exchange volumes rose." },
  { id: "delivery-note", title: "Tesla deliveries preview", text: "Our price prediction for third-quarter deliveries stays above consensus." },
  { id: "fee-note", title: "Exchange economics", text: "A fee switch redirects trading fees to token holders at several venues." },
  { id: "unimicron", title: "Unimicron ABF substrate outlook", text: "Unimicron expects substrate demand to recover next year.", online: bareUni },
  { id: "unitree", title: "Unitree humanoid shipments", text: "Unitree shipped more quadruped robots this quarter.", online: bareUni }
];
// aliases mirrors the gateway's concept table: OR within a concept's spellings.
// subjectSupport=false mimics a gateway that predates subject anchoring and ignores the argument.
function fakeGateway(docs: Doc[], aliases: Record<string, string[]> = {}, subjectSupport = true) {
  const spellings = (term: string) => aliases[term.toLowerCase()] ?? [term];
  const mentions = (text: string, term: string) => spellings(term).some(s => literal(s).test(text));
  return async (name: string, args: Record<string, any>) => {
    const doc = docs.find(d => d.id === args.article_id);
    if (name === "signal_desk_read") return { status: "ok", title: doc!.title, url: `https://library.example/${doc!.id}/markdown`,
      text: `${doc!.title}\n${doc!.text}`, offset: 0, next_offset: null, sha256: `sha-${doc!.id}`,
      content_kind: doc!.online ? "summary" : "article", access: doc!.online ? "summary_verified" : "body_verified", date: "2026-09-20" };
    if (name === "signal_desk_pdf") return { status: "error", error: "PDF unavailable" };
    let terms: string[] = args.keywords;
    if (args.subject && subjectSupport) {
      const covered = docs.some(d => !d.online && args.subject.some((s: string) => mentions(`${d.title}\n${d.text}`, s)));
      if (!covered) return { status: "ok", results: [], total: 0, offset: 0, next_offset: null, source_provider: "signal_desk",
        coverage_verdict: "subject_not_covered", subject_probe: { subject: args.subject, total: 0 }, source_urls: [],
        coverage_note: "Searched; the expanded resource library has no article mentioning this subject in the window. Absence here is not evidence about the subject itself." };
      terms = [...args.subject, ...terms];
    }
    const field = (d: Doc) => args.scope === "title" ? d.title : `${d.title}\n${d.text}`;
    const matched = docs.filter(d => d.online ? args.scope === "all" && d.online(terms) : terms.every(t => mentions(field(d), t)));
    const results = matched.map(d => ({ id: d.id, title: d.title, url: `https://library.example/${d.id}/markdown`,
      publisher: d.online ? "Foreign Research" : "Independent", body_indexed: !d.online, content_kind: d.online ? "summary" : "article" }));
    return { status: "ok", results, total: results.length, offset: 0, next_offset: null, coverage: { catalogue_window_complete: true },
      ...(args.subject && subjectSupport ? { subject_probe: { subject: args.subject, total: 1 } } : {}),
      keyword_groups: terms.map(t => ({ keyword: t, concept: aliases[t.toLowerCase()] ? t.toLowerCase() : null, alternatives: spellings(t) })),
      coverage_verdict: results.length ? "relevant_matches" : "no_match", source_urls: results.map(r => r.url) };
  };
}
const calls = (tool: string) => gateway.callResearchTool.mock.calls.filter(c => c[0] === tool).map(c => c[1]);
// The keyword plan the model returned for the 2026-09-29 UNI all-time-high question.
const UNI_PLAN = [
  { query: "Binance UNI/USDT price", keywords: ["Binance", "UNI/USDT price"] },
  { query: "UNI price prediction", keywords: ["UNI", "price prediction"] },
  { query: "Uniswap fee switch", keywords: ["Uniswap", "fee switch"] }
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "library-subject-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
  vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY", "1");
  vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
  vi.stubEnv("FORECAST_MARKET_BLIND", "0");
  gateway.callResearchTool.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("subject-anchored library sweep", () => {
  it("records that the library does not cover the subject instead of reading keyword-coincidence documents", async () => {
    gateway.callResearchTool.mockImplementation(fakeGateway(UNISWAP_FREE));
    const found = await collectExpandedLibrary({ searchQueries: UNI_PLAN.map(q => ({ targetId: "question", subject: "Uniswap", ...q })) });
    expect(calls("signal_desk_search").length).toBeGreaterThan(0);
    expect(calls("signal_desk_search").every(args => JSON.stringify(args.subject) === '["Uniswap"]')).toBe(true);
    // The verdict is per subject, so the remaining planned searches would only repeat it.
    expect(calls("signal_desk_search")).toHaveLength(1);
    expect(calls("signal_desk_read")).toEqual([]);
    expect(found?.readings).toEqual([]);
    expect(found?.queries[0]).toMatchObject({ status: "ok", total: 0, coverageVerdict: "subject_not_covered" });
    expect(found?.collectionAudit?.[0].targets[0]).toMatchObject({ targetId: "question", subject: "Uniswap", subjectCovered: false });
    expect(found?.collectionAudit?.[0].targets[0].limitations.join(" ")).toMatch(/no article mentioning Uniswap/);
    expect(libraryPrompt(found)).toContain("subject_not_covered");
  });

  it("automatically excludes pre-read articles whose text never mentions the subject", async () => {
    const partial: Doc[] = [
      { id: "uniswap-vote", title: "Uniswap governance vote", text: "Uniswap token holders approved the fee switch for v3 pools." },
      { id: "unimicron", title: "Unimicron ABF substrate outlook", text: "Unimicron expects substrate demand to recover.",
        online: terms => terms.some(t => t.toLowerCase() === "uni") }
    ];
    gateway.callResearchTool.mockImplementation(fakeGateway(partial));
    const found = await collectExpandedLibrary({ searchQueries: [
      { targetId: "question", subject: "Uniswap", query: "Uniswap fee switch", keywords: ["Uniswap", "fee switch"] },
      { targetId: "question", subject: "Uniswap", query: "UNI price", keywords: ["UNI", "price"] }
    ] });
    expect(new Set(found?.readings.map(r => r.articleId))).toEqual(new Set(["uniswap-vote", "unimicron"]));
    expect(found?.exclusions).toEqual([expect.objectContaining({ articleId: "unimicron", automatic: true, reason: expect.stringMatching(/Uniswap/) })]);
    // An off-subject summary does not justify downloading its full report.
    expect(calls("signal_desk_pdf")).toEqual([]);
    const url = "https://library.example/uniswap-vote/markdown";
    const exclusion = { articleId: "uniswap-vote", reason: "The vote is dated after the question's own evidence cutoff." };
    expect(() => binaryLibraryUsage(found, [], {})).toThrow(/uniswap-vote/);
    expect(() => binaryLibraryUsage(found, [], {})).not.toThrow(/unimicron/);
    expect(binaryLibraryUsage(found, [], { library_exclusions: [exclusion] })?.exclusions.map(e => e.articleId).sort())
      .toEqual(["unimicron", "uniswap-vote"]);
    expect(() => validateLibraryUse(found, [], [exclusion], [], [url])).not.toThrow();
    const directory = JSON.parse(libraryPrompt(found).split("\n")[2]);
    expect(directory.readings.map((r: { articleId: string }) => r.articleId)).toEqual(["uniswap-vote"]);
    expect(directory.exclusions).toEqual([expect.objectContaining({ articleId: "unimicron", automatic: true })]);
  });

  it("broadens an empty conjunctive search only while it stays anchored to the subject", async () => {
    const library: Doc[] = [{ id: "uniswap-v4", title: "Uniswap v4 hooks", text: "Uniswap launched v4 hooks for custom pools." }];
    gateway.callResearchTool.mockImplementation(fakeGateway(library));
    const found = await collectExpandedLibrary({ searchQueries: [
      { targetId: "question", subject: "Uniswap", query: "Uniswap fee switch", keywords: ["Uniswap", "fee switch"] }
    ] });
    expect(calls("signal_desk_search").every(args => JSON.stringify(args.subject) === '["Uniswap"]')).toBe(true);
    expect(found?.readings.map(r => r.articleId)).toEqual(["uniswap-v4"]);
    expect(found?.exclusions).toEqual([]);
  });

  it("does not trust an anchor that a gateway without subject support silently ignored", async () => {
    const legacy: Doc[] = [...UNISWAP_FREE, { id: "unicharm", title: "Unicharm outlook", text: "Unicharm (UNI) price prediction: margins recover." }];
    gateway.callResearchTool.mockImplementation(fakeGateway(legacy, {}, false));
    const found = await collectExpandedLibrary({ searchQueries: UNI_PLAN.map(q => ({ targetId: "question", subject: "Uniswap", ...q })) });
    expect(calls("signal_desk_search").every(args => args.keywords.length > 1)).toBe(true);
    const target = found?.collectionAudit?.[0].targets[0];
    expect(target?.subjectCovered).toBeUndefined();
    expect(target?.limitations.join(" ")).toMatch(/ignored subject Uniswap/);
    expect(found?.readings.map(r => r.articleId)).toEqual(["unicharm"]);
    expect(found?.exclusions).toEqual([expect.objectContaining({ articleId: "unicharm", automatic: true })]);
  });

  it("never searches a single keyword on its own when no subject anchors the query", async () => {
    gateway.callResearchTool.mockImplementation(fakeGateway(UNISWAP_FREE));
    const found = await collectExpandedLibrary({ searchQueries: UNI_PLAN.map(q => ({ targetId: "question", ...q })) });
    expect(calls("signal_desk_search").every(args => args.keywords.length > 1)).toBe(true);
    expect(found?.readings).toEqual([]);
    expect(found?.collectionAudit?.[0].targets[0].limitations.join(" ")).toMatch(/single keyword/);
  });
});

describe("mandatory library sweep inside a binary forecast", () => {
  const framing: EventFraming = {
    normalizedQuestion: "Will UNI trade above its all-time high within 12 months?", resolutionCriteria: "A daily close above the prior all-time high.",
    resolutionDate: "2027-09-29", settlementSource: "CoinGecko daily close", assumptions: "", forecastable: true, clarificationNeeded: "",
    priorProbability: 0.1, priorRationale: "Subjective reference-class prior", framingCaveats: "", framingConfidence: "medium"
  };
  const PUBLIC = "https://gov.uniswap.example/fee-switch";
  const result = (jsonObject: unknown, read: string[] = []): AgentRunResult => ({
    rawFinalText: JSON.stringify(jsonObject), jsonObject, jsonError: null, searchQueries: read.length ? ["Uniswap fee switch vote"] : [],
    searchResultUrls: new Set(read), readSourceUrls: read, researchReadings: [],
    retrievalAttempts: read.map(url => ({ tool: "web_search", query: "Uniswap fee switch vote", outcome: "results" as const, sourceUrls: [url], librarySearched: true })),
    costUsd: null, numTurns: 1, exitCode: 0, stderrTail: ""
  });
  const round = {
    round_summary: "Governance approved the fee switch; the library has nothing on Uniswap.",
    new_claims: [{ claim_id: "fee-switch-approved", claim: "Uniswap governance approved the protocol fee switch.", stance: "supports_yes",
      strength: "weak", llr: 0.2, cluster_id: "fee-switch", resolution_relevance: "indirect", rationale: "Fee revenue can support token demand.",
      sources: [{ url: PUBLIC, title: "Fee switch vote", source_type: "official", credibility: "high", relation: "supports",
        support_quality: "direct", independence_group: "uniswap-governance" }] }],
    reflection: [], confidence: "low", found_new_information: true, notes: ""
  };

  it("completes the round when the subscription library holds nothing about the subject", async () => {
    gateway.callResearchTool.mockImplementation(fakeGateway(UNISWAP_FREE));
    const agent = vi.fn(async (prompt: string) => prompt.includes("ROUND:")
      ? result(round, [PUBLIC])
      : result({ subject: "Uniswap", queries: UNI_PLAN }));
    const state = newForecastState({ eventId: "uni-ath", eventText: framing.normalizedQuestion, framing });
    const out = await runForecast(state, { maxRounds: 1, runAgentFn: agent });
    expect(out.status).toBe("max_rounds");
    expect(out.round).toBe(1);
    expect(out.evidenceLedger.map(e => e.claimId)).toEqual(["fee-switch-approved"]);
    expect(calls("signal_desk_search").every(args => JSON.stringify(args.subject) === '["Uniswap"]')).toBe(true);
    expect(out.expandedLibrary?.readings).toEqual([]);
    expect(out.expandedLibrary?.collectionAudit?.[0].targets[0]).toMatchObject({ subject: "Uniswap", subjectCovered: false });
    expect(agent.mock.calls.find(c => c[0].includes("ROUND:"))?.[0]).toContain("subject_not_covered");
  });
});

describe("subject contracts", () => {
  it("requires an explicit subject or null in the binary library plan and anchors every query to it", () => {
    expect(parseLibraryPlan({ subject: "Uniswap", queries: UNI_PLAN })).toEqual(UNI_PLAN.map(q => ({ targetId: "question", ...q, subject: "Uniswap" })));
    expect(parseLibraryPlan({ subject: null, queries: UNI_PLAN.slice(0, 1) })).toEqual([{ targetId: "question", ...UNI_PLAN[0] }]);
    expect(() => parseLibraryPlan({ queries: UNI_PLAN })).toThrow(/subject/);
    expect(() => parseLibraryPlan({ subject: "Uniswap, UNI", queries: UNI_PLAN })).toThrow(/one entity/);
    expect(libraryPlanPrompt("Will UNI trade above its all-time high?")).toContain('"subject"');
  });

  it("accepts an optional subject in typed search plans and leaves older plans unchanged", () => {
    const raw = { kind: "numeric", resolutionCriteria: "CoinGecko daily close in USD", resolutionDate: "2027-09-29", settlementSource: "CoinGecko",
      assumptions: [], unit: "USD", minimum: 0, maximum: null, scoreRubric: null, prior: { mean: 8, standardDeviation: 4 },
      priorRationale: "A subjective starting assumption.", searchQueries: [{ targetId: "question", subject: "Uniswap", query: "UNI price", keywords: ["UNI", "price"] }] };
    const frame = (rows: unknown[]) => validateQuestionSpec({ ...raw, searchQueries: rows }, "Where will UNI close?", "numeric", {}, "2026-09-29").searchQueries;
    expect(frame(raw.searchQueries)).toEqual([{ targetId: "question", subject: "Uniswap", query: "UNI price", keywords: ["UNI", "price"] }]);
    expect(frame([{ targetId: "question", query: "UNI price", keywords: ["UNI", "price"] }])).toEqual([{ targetId: "question", query: "UNI price", keywords: ["UNI", "price"] }]);
    expect(() => frame([{ targetId: "question", subject: "Alphabet; Google", query: "capex", keywords: ["capex"] }])).toThrow(/one entity/);
  });

  it("recognises gateway aliases and non-Latin subjects before excluding anything", async () => {
    const docs: Doc[] = [
      { id: "guge", title: "谷歌资本开支", text: "谷歌上调了资本开支指引。" },
      { id: "tencent", title: "腾讯控股云业务", text: "腾讯控股的云业务收入增长。" },
      { id: "alibaba", title: "阿里巴巴云业务", text: "阿里巴巴的云业务收入增长。", online: terms => terms.includes("云业务") }
    ];
    gateway.callResearchTool.mockImplementation(fakeGateway(docs, { alphabet: ["Alphabet", "Google", "谷歌"] }));
    const found = await collectExpandedLibrary({ searchQueries: [
      { targetId: "google", subject: "Alphabet", query: "Alphabet 资本开支", keywords: ["资本开支"] },
      { targetId: "tencent", subject: "腾讯", query: "腾讯 云业务", keywords: ["云业务"] }
    ] }, undefined, { mode: "focused" });
    expect(new Set(found?.readings.map(r => r.articleId))).toEqual(new Set(["guge", "tencent", "alibaba"]));
    expect(found?.exclusions.map(e => e.articleId)).toEqual(["alibaba"]);
  });

  it("reports every unresolved binary library article at once and names the valid ids for a bad exclusion", () => {
    const reading = { articleId: "article-1", targetId: "question", title: "Note", url: "https://library.example/1", text: "Text", offset: 0,
      sha256: "h1", contentKind: "article", apiDate: "2026-09-20" };
    const coverage: ExpandedLibraryCoverage = { required: true, searchedAtUtc: "2026-09-29", queries: [], usedArticleIds: [], exclusions: [],
      readings: [reading, { ...reading, articleId: "article-2", url: "https://library.example/2", sha256: "h2" }] };
    expect(() => binaryLibraryUsage(coverage, [], {})).toThrow(/articles article-1, article-2 were neither used nor excluded/);
    expect(() => binaryLibraryUsage(coverage, [], { library_exclusions: [{ articleId: "invented", reason: "This names a source that was never read." }] }))
      .toThrow(/still to resolve: article-1, article-2/);
  });

  it("keeps a typed forecast running when the library holds nothing about the subject", async () => {
    gateway.callResearchTool.mockImplementation(fakeGateway(UNISWAP_FREE));
    const PUBLIC = "https://gov.uniswap.example/fee-switch";
    const spec: QuestionSpec = { kind: "numeric", question: "Where will UNI close on 2027-09-29?", resolutionCriteria: "CoinGecko daily close in USD",
      resolutionDate: "2027-09-29", asOfDate: "2026-09-29", settlementSource: "CoinGecko", assumptions: [], options: [], unit: "USD", minimum: 0,
      maximum: null, scoreRubric: null, prior: { mean: 8, standardDeviation: 4 }, priorRationale: "A subjective starting assumption.",
      searchQueries: UNI_PLAN.map(q => ({ targetId: "question", subject: "Uniswap", ...q })) };
    const round = { summary: "Governance evidence only.", confidence: "low", exclusions: [], claims: [{ id: "fee-switch", claim: "Uniswap governance approved the fee switch.",
      targetIds: ["question"], sourceUrl: PUBLIC, sourceTitle: "Fee switch vote", sourceType: "official", publishedAt: "2026-09-01",
      quote: "The fee switch proposal passed.", rationale: "Fee revenue can support demand.", clusterId: "fee-switch", effects: {},
      numericSignal: { mean: 9, standardDeviation: 3 }, articleId: null, epistemicStatus: "estimate" }] };
    const agent = vi.fn(async () => ({ rawFinalText: JSON.stringify(round), jsonObject: round, jsonError: null, searchQueries: ["Uniswap fee switch"],
      searchResultUrls: new Set([PUBLIC]), readSourceUrls: [PUBLIC], researchReadings: [], costUsd: null, numTurns: 1, exitCode: 0, stderrTail: "",
      retrievalAttempts: [{ tool: "web_search", query: "Uniswap fee switch", outcome: "results" as const, sourceUrls: [PUBLIC], librarySearched: true }] }));
    const out = await runStructuredForecast(newStructuredState("uni-close", spec.question, { answerType: "numeric" }, spec), { maxRounds: 1, runAgentFn: agent });
    expect(out.status).toBe("max_rounds");
    expect(out.evidenceLedger.map(e => e.id)).toEqual(["fee-switch"]);
    expect(out.expandedLibrary?.readings).toEqual([]);
    expect(calls("signal_desk_search").every(args => JSON.stringify(args.subject) === '["Uniswap"]')).toBe(true);
    expect(renderStructuredReport(out)).toContain("扩展资源库没有提及研究主体的文章");
  });
});
