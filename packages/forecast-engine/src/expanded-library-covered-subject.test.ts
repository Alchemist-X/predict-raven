import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({ callResearchTool: vi.fn() }));
vi.mock("./research-tools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./research-tools")>()),
  callResearchTool: gateway.callResearchTool
}));
import { binaryLibraryUsage, collectExpandedLibrary, librarySubjects } from "./expanded-library";
import { parseLibraryPlan } from "./engine";

// Reproduces the 2026-09-30 AMD run (issue #161): the library covers the
// subject heavily, so one empty keyword pair must not turn into a bare
// subject search that pre-reads everything mentioning the company.
interface Doc { id: string; title: string; text: string; foreign?: boolean; rank?: number }
const literal = (term: string) => new RegExp(
  (/^[A-Za-z0-9]/.test(term) ? "(?<![A-Za-z0-9_])" : "") + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
  (/[A-Za-z0-9]$/.test(term) ? "(?![A-Za-z0-9_])" : ""), "i");
// Same contract as the gateway: subject probed first, then ANDed into every query.
function fakeGateway(docs: Doc[], aliases: Record<string, string[]> = {}) {
  const spellings = (term: string) => aliases[term.toLowerCase()] ?? [term];
  const mentions = (text: string, term: string) => spellings(term).some(s => literal(s).test(text));
  return async (name: string, args: Record<string, any>) => {
    const doc = docs.find(d => d.id === args.article_id);
    if (name === "signal_desk_read") return { status: "ok", title: doc!.title, url: `https://library.example/${doc!.id}/markdown`,
      text: `${doc!.title}\n${doc!.text}`, offset: 0, next_offset: null, sha256: `sha-${doc!.id}`,
      content_kind: doc!.foreign ? "summary" : "article", access: doc!.foreign ? "summary_verified" : "body_verified", date: "2026-09-20",
      publisher: doc!.foreign ? "Foreign Research" : "Independent" };
    if (name === "signal_desk_pdf") return { status: "error", error: "PDF unavailable" };
    let terms: string[] = args.keywords;
    if (args.subject) terms = [...args.subject, ...terms];
    const field = (d: Doc) => args.scope === "title" ? d.title : `${d.title}\n${d.text}`;
    const matched = docs.filter(d => terms.every(t => mentions(field(d), t)));
    const results = matched.map(d => ({ id: d.id, title: d.title, url: `https://library.example/${d.id}/markdown`,
      publisher: d.foreign ? "Foreign Research" : `Newsletter ${d.id}`, body_indexed: true, content_kind: d.foreign ? "summary" : "article",
      ...(d.rank !== undefined ? { relevance_rank: d.rank } : {}) }));
    return { status: "ok", results, total: results.length, offset: 0, next_offset: null, coverage: { catalogue_window_complete: true },
      ...(args.subject ? { subject_probe: { subject: args.subject,
        total: docs.filter(d => args.subject.some((s: string) => mentions(`${d.title}\n${d.text}`, s))).length } } : {}),
      keyword_groups: terms.map(t => ({ keyword: t, alternatives: spellings(t) })),
      coverage_verdict: results.length ? "relevant_matches" : "no_match", source_urls: results.map(r => r.url) };
  };
}
const searches = () => gateway.callResearchTool.mock.calls.filter(c => c[0] === "signal_desk_search").map(c => c[1]);
const readIds = (coverage: Awaited<ReturnType<typeof collectExpandedLibrary>>) => [...new Set(coverage!.readings.map(r => r.articleId))];
const searchedTerms = (args: Record<string, any>) => [...new Set([...(args.subject ?? []), ...args.keywords].map((t: string) => t.toLowerCase()))].sort();

// A semiconductor-heavy library: every chip note mentions AMD somewhere,
// a handful discuss its data-center revenue, and ophthalmology reports use
// "AMD" for macular degeneration.
const chipNotes: Doc[] = Array.from({ length: 120 }, (_, i) => ({ id: `chip-${i}`, title: `Semis wrap ${i}`, text: `AMD and peers moved today; note ${i}.` }));
const onTopic: Doc[] = Array.from({ length: 6 }, (_, i) => ({ id: `dc-${i}`, title: `AMD data center ${i}`, text: `AMD data center revenue grew in quarter ${i}.` }));
const nvidia: Doc[] = Array.from({ length: 5 }, (_, i) => ({ id: `nv-${i}`, title: `NVIDIA results ${i}`, text: `NVIDIA data center revenue reached a record, part ${i}.` }));
const pharma: Doc[] = [
  { id: "kyowa", title: "KHK4951 phase 2 in nAMD", text: "Wet AMD (湿性AMD) patients showed improved visual acuity.", foreign: true },
  { id: "haisco", title: "口服 nAMD 小分子", text: "湿性AMD 黄斑变性口服药进入临床。", foreign: true }
];
// The keyword plan the model returned for the AMD question on 2026-09-30; with
// per-query subjects the NVIDIA search is anchored to NVIDIA, not to AMD.
const AMD_PLAN = [
  { query: "AMD World Labs deal dilution", keywords: ["AMD", "deal dilution"] },
  { query: "AMD data center revenue", keywords: ["AMD", "data center revenue"] },
  { query: "NVIDIA data center revenue", keywords: ["NVIDIA", "data center revenue"] },
  { query: "AMD forward P/E", keywords: ["AMD", "forward P/E"] }
];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "library-covered-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
  vi.stubEnv("FORECAST_SIGNAL_DESK", "1");
  vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY", "1");
  gateway.callResearchTool.mockReset();
  gateway.callResearchTool.mockImplementation(fakeGateway([...chipNotes, ...onTopic, ...nvidia, ...pharma]));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe("forced library sweep over a heavily covered subject (#161)", () => {
  it("never broadens an empty pair into a search for the subject alone", async () => {
    const plan = AMD_PLAN.map(q => ({ targetId: "question", subject: q.keywords[0]!, ...q }));
    const coverage = await collectExpandedLibrary({ searchQueries: plan });
    expect(searches().map(searchedTerms)).not.toContainEqual(["amd"]);
    expect(readIds(coverage)).not.toEqual(expect.arrayContaining(["kyowa"]));
    expect(readIds(coverage).filter(id => id.startsWith("chip-"))).toEqual([]);
    expect(readIds(coverage)).toEqual(expect.arrayContaining(["dc-0", "nv-0"]));
  });

  it("treats a gateway alias of the subject as the subject when broadening", async () => {
    gateway.callResearchTool.mockImplementation(fakeGateway([...chipNotes, ...onTopic, ...pharma],
      { "advanced micro devices": ["Advanced Micro Devices", "AMD"] }));
    await collectExpandedLibrary({ searchQueries: [{ targetId: "question", subject: "Advanced Micro Devices", ...AMD_PLAN[0]! }] });
    expect(searches().map(searchedTerms)).not.toContainEqual(["advanced micro devices", "amd"]);
  });

  it("caps the forced pre-read and leaves the rest as unread candidates the model need not resolve", async () => {
    const coverage = await collectExpandedLibrary({ searchQueries: [{ targetId: "question", subject: "AMD", query: "AMD peers", keywords: ["AMD", "peers"] }] });
    expect(coverage!.candidates!.length).toBe(120);
    expect(readIds(coverage).length).toBe(40);
    expect(coverage!.candidates!.filter(c => !c.selected).length).toBe(80);
    expect(coverage!.collectionAudit![0]!.targets[0]!.limitations.join(" ")).toMatch(/reading budget/);
    // Only what was actually read has to be cited or excluded.
    const exclusions = readIds(coverage).map(articleId => ({ articleId, reason: "Market wrap without AMD data-center figures." }));
    expect(() => binaryLibraryUsage(coverage, [], { library_exclusions: exclusions })).not.toThrow();
  });

  it("lets the operator raise, lower or lift the cap", async () => {
    const plan = { searchQueries: [{ targetId: "question", subject: "AMD", query: "AMD peers", keywords: ["AMD", "peers"] }] };
    vi.stubEnv("FORECAST_LIBRARY_MAX_ARTICLES", "5");
    expect(readIds(await collectExpandedLibrary(plan)).length).toBe(5);
    vi.stubEnv("FORECAST_LIBRARY_MAX_ARTICLES", "unlimited");
    expect(readIds(await collectExpandedLibrary(plan)).length).toBe(120);
    vi.stubEnv("FORECAST_LIBRARY_MAX_ARTICLES", "many");
    await expect(collectExpandedLibrary(plan)).rejects.toThrow(/FORECAST_LIBRARY_MAX_ARTICLES/);
    vi.unstubAllEnvs();
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", root); vi.stubEnv("FORECAST_SIGNAL_DESK", "1"); vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY", "1");
    // An explicit caller budget still wins over the default.
    expect(readIds(await collectExpandedLibrary(plan, undefined, { maxArticlesPerTarget: 3 })).length).toBe(3);
  });

  it("caps PDF downloads by default", async () => {
    const reports: Doc[] = Array.from({ length: 20 }, (_, i) => ({ id: `fr-${i}`, title: `AMD initiation ${i}`, text: `AMD data center revenue view ${i}.`, foreign: true }));
    gateway.callResearchTool.mockImplementation(fakeGateway(reports));
    await collectExpandedLibrary({ searchQueries: [{ targetId: "question", subject: "AMD", ...AMD_PLAN[1]! }] });
    expect(gateway.callResearchTool.mock.calls.filter(c => c[0] === "signal_desk_pdf").length).toBe(12);
  });

  it("prefers articles found by the planned queries over those found only by broadened ones", async () => {
    // Three keywords, no subject: the unanchored path broadens to keyword pairs.
    // The gateway ranks the looser single-pair passages higher, as proximity ranking often does.
    const broad: Doc[] = Array.from({ length: 60 }, (_, i) => ({ id: `pair-${i}`, title: `Guidance note ${i}`, text: `Meta capex guidance, note ${i}.`, rank: 4 }));
    const exact: Doc[] = Array.from({ length: 3 }, (_, i) => ({ id: `exact-${i}`, title: `Meta capex cut ${i}`, text: `Meta capex guidance cut expected, view ${i}.`, rank: 0 }));
    gateway.callResearchTool.mockImplementation(fakeGateway([...broad, ...exact]));
    const coverage = await collectExpandedLibrary({ searchQueries: [
      { targetId: "question", query: "Meta capex guidance cut", keywords: ["Meta", "capex guidance", "cut expected"] },
      { targetId: "question", query: "Meta nothing", keywords: ["Meta", "capex guidance", "never written"] }
    ] }, undefined, { maxArticlesPerTarget: 10 });
    expect(readIds(coverage)).toEqual(expect.arrayContaining(["exact-0", "exact-1", "exact-2"]));
  });

  it("logs the size of the pre-read so a runaway sweep is visible", async () => {
    const log = vi.fn();
    await collectExpandedLibrary({ searchQueries: [{ targetId: "question", subject: "AMD", query: "AMD peers", keywords: ["AMD", "peers"] }] }, log);
    expect(log.mock.calls.map(c => c[0]).join("\n")).toMatch(/pre-read: 120 candidates, 40 articles read/);
  });

  it("lets a comparison give each planned query its own subject", () => {
    const plan = parseLibraryPlan({ subject: "AMD", queries: [
      { query: "AMD data center revenue", keywords: ["AMD", "data center revenue"] },
      { query: "NVIDIA data center revenue", keywords: ["NVIDIA", "data center revenue"], subject: "NVIDIA" }
    ] });
    expect(plan.map(q => q.subject)).toEqual(["AMD", "NVIDIA"]);
    expect(() => parseLibraryPlan({ subject: "AMD", queries: [{ query: "x", keywords: ["AMD", "y"], subject: "AMD, NVIDIA" }] })).toThrow(/one entity/);
  });

  it("does not anchor follow-up searches of a comparison target to only one of its subjects", async () => {
    const coverage = await collectExpandedLibrary({ searchQueries: AMD_PLAN.map(q => ({ targetId: "question", subject: q.keywords[0]!, ...q })) });
    expect(coverage!.collectionAudit![0]!.targets[0]!.subjects).toEqual(["AMD", "NVIDIA"]);
    expect(librarySubjects(coverage).has("question")).toBe(false);
  });

  it("still searches a sparsely covered subject on its own when a pair comes back empty", async () => {
    const few: Doc[] = [{ id: "labs-1", title: "World Labs raises", text: "World Labs raised new funding for Marble." }, ...chipNotes];
    gateway.callResearchTool.mockImplementation(fakeGateway(few));
    const coverage = await collectExpandedLibrary({ searchQueries: [
      { targetId: "question", subject: "World Labs", query: "World Labs revenue", keywords: ["World Labs", "revenue"] }
    ] });
    expect(readIds(coverage)).toEqual(["labs-1"]);
  });

  it("records an empty pair about a heavily covered subject as a result, with the reason", async () => {
    const coverage = await collectExpandedLibrary({ searchQueries: [{ targetId: "question", subject: "AMD", ...AMD_PLAN[0]! }] });
    expect(readIds(coverage)).toEqual([]);
    expect(coverage!.collectionAudit![0]!.targets[0]!.limitations.join(" ")).toMatch(/AMD appears in 128 library articles, more than the reading budget/);
  });
});
