import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpandedLibraryCoverage, ExpandedLibraryReading, StructuredClaim } from "./answer-types";

const gateway = vi.hoisted(() => ({ callResearchTool: vi.fn(), signalDeskEnabled: vi.fn() }));
vi.mock("./research-tools", () => gateway);
import { collectExpandedLibrary, libraryPrompt, mergeExpandedLibrary, validateLibraryUse } from "./expanded-library";

const query = { targetId: "meta", query: "Meta capex", keywords: ["Meta", "capex"] };
const article = (id: string, publisher = "TMT Breakout", extra: Record<string, unknown> = {}) => ({
  id,
  title: `${id} Meta capital spending research`,
  url: `https://example.org/${id}/markdown`,
  publisher,
  body_indexed: true,
  content_kind: publisher === "Foreign Research" ? "summary" : "article",
  ...extra
});
function readResult(args: Record<string, any>) {
  return {
    status: "ok",
    text: `Original text for ${args.article_id}. ` + "x".repeat(900),
    url: `https://example.org/${args.article_id}/markdown`,
    offset: args.offset,
    next_offset: null,
    total_chars: 950,
    sha256: `hash-${args.article_id}`,
    content_kind: "article",
    access: "body_verified",
    date: "2026-09-12"
  };
}
function pdfResult(args: Record<string, any>) {
  return {
    status: "ok",
    article_id: args.article_id,
    text: "[Page 1]\nThe bank forecasts a lower capital budget.",
    url: `https://example.org/${args.article_id}/pdf`,
    content_kind: "pdf",
    access: "body_verified",
    sha256: "pdf-hash",
    start_page: 1,
    next_page: null,
    total_pages: 12,
    pages: [{ page: 1, text_chars: 50, truncated: true }],
    path: "/private/subscription/report.pdf",
    date: "2026-09-12"
  };
}
function mockRows(rows: ReturnType<typeof article>[]) {
  gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
    if (name === "signal_desk_search") return { status: "ok", results: rows, total: rows.length, next_offset: null };
    if (name === "signal_desk_pdf") return pdfResult(args);
    return readResult(args);
  });
}
function emptyCoverage(readings: ExpandedLibraryReading[] = []): ExpandedLibraryCoverage {
  return {
    required: true,
    searchedAtUtc: "2026-09-13T00:00:00Z",
    queries: [],
    readings,
    usedArticleIds: [],
    exclusions: []
  };
}
function claim(changes: Partial<StructuredClaim>): StructuredClaim {
  return {
    id: "claim",
    articleId: "bank",
    claim: "The bank expects lower spending",
    targetIds: ["meta"],
    sourceUrl: "https://example.org/bank/pdf",
    sourceTitle: "Bank report",
    sourceType: "secondary",
    publishedAt: null,
    quote: "The bank forecasts a lower capital budget.",
    rationale: "An analyst forecast, not guidance",
    clusterId: "bank",
    effects: { meta: 0.1 },
    numericSignal: null,
    epistemicStatus: "source_opinion",
    ...changes
  };
}

beforeEach(() => {
  vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY", "1");
  gateway.callResearchTool.mockReset();
  gateway.signalDeskEnabled.mockReset().mockReturnValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("broad expanded-library collection", () => {
  it("finishes discovery across all compared entities before reading candidates", async () => {
    mockRows([article("shared")]);
    const result = await collectExpandedLibrary({
      searchQueries: [query, { ...query, targetId: "tesla", keywords: ["Tesla", "capex"] }]
    });
    const names = gateway.callResearchTool.mock.calls.map((c) => c[0]);
    expect(names.slice(0, names.indexOf("signal_desk_read"))).toEqual(Array(6).fill("signal_desk_search"));
    expect(names.lastIndexOf("signal_desk_search")).toBeLessThan(names.indexOf("signal_desk_read"));
    expect(result?.collectionAudit?.[0].targets.map((t) => t.targetId)).toEqual(["meta", "tesla"]);
    expect(result?.usedArticleIds).toEqual([]);
  });

  it("discovers an unindexed title candidate and diversifies publishers instead of repeatedly reading the top author", async () => {
    gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
      if (name !== "signal_desk_search") return readResult(args);
      const rows =
        args.scope === "title"
          ? [article("unindexed", "Independent newsletter", { body_indexed: false, title_matches: ["Meta", "capex"] })]
          : [article("same-1"), article("same-2"), article("same-3"), article("other", "Citrini Research")];
      return { status: "ok", total: rows.length, results: rows };
    });
    const result = await collectExpandedLibrary({ searchQueries: [query] }, undefined, { maxArticlesPerTarget: 3 });
    const ids = new Set(result?.readings.map((r) => r.articleId));
    expect(ids.has("unindexed")).toBe(true);
    expect(ids.has("other")).toBe(true);
    expect(new Set(result?.readings.map((r) => r.publisher)).size).toBe(3);
    expect(result?.candidates?.find((c) => c.articleId === "unindexed")).toMatchObject({
      selected: true,
      bodyIndexed: false
    });
    expect(result?.candidates?.filter((c) => !c.selected)).toHaveLength(2);
    expect(result?.exclusions).toEqual([]);
  });

  it("follows all upstream pages and records only explicitly limited reading coverage", async () => {
    gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) =>
      name === "signal_desk_search"
        ? {
            status: "ok",
            total: 200,
            next_offset: args.offset + 12 < 200 ? args.offset + 12 : null,
            results: Array.from({ length: Math.min(12, 200 - args.offset) }, (_, i) =>
              article(`${args.scope}-${args.offset + i}`)
            )
          }
        : readResult(args)
    );
    const result = await collectExpandedLibrary({ searchQueries: [query] }, undefined, { maxArticlesPerTarget: 2 });
    const searches = gateway.callResearchTool.mock.calls.filter((c) => c[0] === "signal_desk_search");
    expect(searches).toHaveLength(51);
    expect(searches.map((c) => c[1].offset)).toEqual(
      Array(3)
        .fill(Array.from({ length: 17 }, (_, i) => i * 12))
        .flat()
    );
    expect(result?.queries.every((q) => q.arguments?.match === "all" && q.arguments.limit === null)).toBe(true);
    expect(result?.queries[1]).toMatchObject({ returnedCount: 12, nextOffset: 24, exhausted: false });
    expect(result?.collectionAudit?.[0].targets[0]).toMatchObject({ coverageExhausted: false, readArticleCount: 2 });
    expect(result?.collectionAudit?.[0].targets[0].limitations.join(" ")).toMatch(/budget/);
  });

  it("keeps original subject keywords and never inserts capex or cash flow into unrelated research", async () => {
    mockRows([]);
    await collectExpandedLibrary({
      searchQueries: [{ targetId: "cloud", query: "Google TPU revenue", keywords: ["Google", "TPU", "revenue"] }]
    });
    const calls = gateway.callResearchTool.mock.calls.map((c) => c[1]);
    expect(calls).toHaveLength(5);
    expect(calls.map(args => args.keywords)).toEqual([["Google","TPU","revenue"],["Google","TPU","revenue"],["Google"],["TPU"],["revenue"]]);
    expect(calls.every(args => args.limit === null && !args.publisher)).toBe(true);
  });

  it("requests complete article text rather than bounded introductory and matched windows", async () => {
    mockRows([article("deep", "TMT Breakout", { evidence: [{ source: "body", read_offset: 15000 }] })]);
    const result = await collectExpandedLibrary({ searchQueries: [query] });
    expect(gateway.callResearchTool.mock.calls.filter((c) => c[0] === "signal_desk_read").map((c) => c[1])).toEqual([
      { article_id: "deep", offset: 0, max_chars: 0 }
    ]);
    expect(result?.readings.map((r) => r.offset)).toEqual([0]);
    expect(result?.readings[0]).toMatchObject({
      format: "markdown",
      readArguments: { max_chars: 0 },
      truncated: false
    });
  });

  it("does not call invented empty keyword searches", async () => {
    mockRows([]);
    const result = await collectExpandedLibrary({ searchQueries: [{ ...query, keywords: [" "] }] });
    expect(result?.collectionAudit?.[0].targets[0].coverageExhausted).toBe(false);
    expect(gateway.callResearchTool).not.toHaveBeenCalled();
  });

  it("keeps optional integrations lighter and returns null if disabled", async () => {
    vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY", "0");
    mockRows([article("optional")]);
    const result = await collectExpandedLibrary({ searchQueries: [query] });
    expect(result?.required).toBe(false);
    expect(result?.collectionAudit?.[0].mode).toBe("focused");
    expect(result?.queries).toHaveLength(1);
    gateway.signalDeskEnabled.mockReturnValue(false);
    expect(await collectExpandedLibrary({ searchQueries: [query] })).toBeNull();
  });
  it("retains readable candidates from a partially failed search while reporting incomplete coverage", async () => {
    gateway.callResearchTool.mockImplementation(async (name, args) => name === "signal_desk_search"
      ? {status:"partial",results:[article("available")],total:1,next_offset:null,coverage:{online_error:"403"}}
      : readResult(args));
    const result = await collectExpandedLibrary({searchQueries:[query]});
    expect(result?.readings.some(r => r.articleId === "available")).toBe(true);
    expect(result?.queries.every(q => q.status === "partial")).toBe(true);
    expect(result?.collectionAudit?.[0].targets[0].coverageExhausted).toBe(false);
  });
});

describe("real PDF tool provenance", () => {
  it("downloads or reuses a relevant Foreign Research PDF and keeps distinct page/hash/URL evidence without private paths", async () => {
    mockRows([article("bank", "Foreign Research")]);
    const result = await collectExpandedLibrary({ searchQueries: [query] });
    expect(gateway.callResearchTool).toHaveBeenCalledWith("signal_desk_pdf", {
      article_id: "bank",
      start_page: 1,
      max_pages: 0,
      max_chars: 0
    });
    const pdf = result?.readings.find((r) => r.format === "pdf");
    expect(pdf).toMatchObject({
      url: "https://example.org/bank/pdf",
      access: "body_verified",
      sha256: "pdf-hash",
      startPage: 1,
      nextPage: null,
      totalPages: 12,
      pages: [{ page: 1, textChars: 50, truncated: true }],
      truncated: true
    });
    expect(JSON.stringify(result)).not.toContain("/private/");
    expect(result?.collectionAudit?.[0]).toMatchObject({ pdfAttemptCount: 1, pdfReadCount: 1 });
    expect(() => validateLibraryUse(result, [claim({})], [], [], ["https://example.org/bank/pdf"])).not.toThrow();
    expect(() => validateLibraryUse(result, [claim({ sourceUrl: "https://example.org/bank/markdown" })], [])).toThrow(
      /matching URL/
    );
  });

  it.each(["denied", "empty", "summary", "wrong-url", "missing-hash", "missing-pages"])(
    "does not count %s PDF retrieval as verification",
    async (failure) => {
      gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
        if (name === "signal_desk_search")
          return { status: "ok", total: 1, results: [article("bank", "Foreign Research")] };
        if (name === "signal_desk_read")
          return { ...readResult(args), content_kind: "summary", access: "summary_verified" };
        const pdf = pdfResult(args);
        if (failure === "denied") return { status: "error", error: "Publisher access denied" };
        if (failure === "empty") return { ...pdf, status: "unavailable", text: "" };
        if (failure === "summary") return { ...pdf, access: "summary_verified" };
        if (failure === "wrong-url") return { ...pdf, url: "https://example.org/bank/markdown" };
        if (failure === "missing-hash") return { ...pdf, sha256: "" };
        return { ...pdf, pages: [] };
      });
      const result = await collectExpandedLibrary({ searchQueries: [query] });
      expect(result?.readings.every((r) => r.format !== "pdf")).toBe(true);
      expect(result?.readings[0].access).toBe("summary_verified");
      expect(result?.readingErrors?.some((e) => e.tool === "signal_desk_pdf")).toBe(true);
      expect(result?.collectionAudit?.[0]).toMatchObject({ pdfAttemptCount: 1, pdfReadCount: 0 });
      expect(() => validateLibraryUse(result, [claim({})], [], [], ["https://example.org/bank/pdf"])).toThrow(/matching URL/);
    }
  );

  it("bounds distinct PDF attempts across targets and records budget skips as unverified", async () => {
    gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
      if (name === "signal_desk_search")
        return {
          status: "ok",
          total: 3,
          results: Array.from({ length: 3 }, (_, i) => article(`${args.keywords[0]}-${i}`, "Foreign Research"))
        };
      if (name === "signal_desk_pdf") return pdfResult(args);
      return readResult(args);
    });
    const result = await collectExpandedLibrary(
      { searchQueries: [query, { ...query, targetId: "tesla", keywords: ["Tesla", "capex"] }] },
      undefined,
      { maxPdfArticles: 3 }
    );
    expect(gateway.callResearchTool.mock.calls.filter((c) => c[0] === "signal_desk_pdf")).toHaveLength(3);
    expect(result?.collectionAudit?.[0].targets.map((t) => t.pdfAttemptCount)).toEqual([2, 1]);
    expect(
      result?.collectionAudit?.[0].targets.every((t) => t.limitations.some((l) => /summary is not PDF/.test(l)))
    ).toBe(true);
  });

  it("gives all seven entities a first PDF opportunity before allocating another report", async () => {
    gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
      if (name === "signal_desk_search")
        return {
          status: "ok",
          total: 2,
          results: [0, 1].map((i) => article(`${args.keywords[0]}-${i}`, "Foreign Research"))
        };
      if (name === "signal_desk_pdf") return pdfResult(args);
      return readResult(args);
    });
    const entities = ["Meta", "Tesla", "Apple", "Nvidia", "Google", "Amazon", "Microsoft"];
    const result = await collectExpandedLibrary({
      searchQueries: entities.map((name) => ({ ...query, targetId: name, keywords: [name, "capex"] }))
    });
    const pdfCalls = gateway.callResearchTool.mock.calls.filter((c) => c[0] === "signal_desk_pdf");
    expect(pdfCalls).toHaveLength(14);
    expect(pdfCalls.slice(0, 7).map((c) => c[1].article_id)).toEqual(entities.map((name) => `${name}-0`));
    expect(result?.collectionAudit?.[0].targets.every((t) => t.pdfReadCount >= 1)).toBe(true);
  });

  it("offers a complete reading directory without copying all private text into every model prompt", async () => {
    const md: ExpandedLibraryReading = {
      articleId: "shared",
      targetId: "meta",
      title: "Shared",
      url: "https://example.org/markdown",
      text: "M".repeat(8000),
      offset: 0,
      sha256: "md",
      contentKind: "summary",
      apiDate: "2026-09-12"
    };
    const pdf: ExpandedLibraryReading = {
      ...md,
      url: "https://example.org/pdf",
      text: "P".repeat(12000),
      format: "pdf",
      contentKind: "pdf",
      access: "body_verified",
      pages: [{ page: 1, textChars: 12000, truncated: true }]
    };
    const original = emptyCoverage([md, pdf, { ...pdf, targetId: "google" }]);
    const prompt = libraryPrompt(original);
    const encoded = prompt.split("\n")[2];
    const parsed = JSON.parse(encoded);
    expect(parsed.readings.reduce((sum: number, r: any) => sum + r.textAvailableChars, 0)).toBe(20000);
    expect(parsed.readings.every((r: any) => r.text === undefined && r.retrieve)).toBe(true);
    expect(parsed.readings.find((r: ExpandedLibraryReading) => r.format === "pdf").targetIds).toEqual([
      "meta",
      "google"
    ]);
    expect(original.readings[1].text).toHaveLength(12000);
    expect(prompt).toContain("summary_verified is not PDF verification");
  });
});

describe("focused follow-up and compatibility", () => {
  it("uses only supplied gap queries, prefers new articles, and permits known-article context when needed", async () => {
    mockRows([article("known"), article("new", "Independent")]);
    const result = await collectExpandedLibrary({ searchQueries: [query] }, undefined, {
      mode: "focused",
      maxArticlesPerTarget: 1,
      knownArticleIds: ["known"]
    });
    expect(result?.queries).toHaveLength(1);
    expect(result?.readings[0].articleId).toBe("new");
    mockRows([article("known", "TMT Breakout", { evidence: [{ source: "body", read_offset: 19000 }] })]);
    const revisit = await collectExpandedLibrary({ searchQueries: [query] }, undefined, {
      mode: "focused",
      maxArticlesPerTarget: 1,
      knownArticleIds: ["known"]
    });
    expect(revisit?.readings[0].readArguments).toMatchObject({ offset: 0, max_chars: 0 });
  });

  it("merges old fixtures with fresh MD/PDF contexts without losing accepted use, exclusions, errors or earlier passages", () => {
    const first: ExpandedLibraryReading = {
      articleId: "same",
      targetId: "meta",
      title: "Same",
      url: "https://example.org/md",
      text: "Old accepted quote",
      offset: 0,
      sha256: "old",
      contentKind: "article",
      apiDate: "2026-09-12"
    };
    const old = emptyCoverage([first]);
    old.usedArticleIds = ["same"];
    old.exclusions = [{ articleId: "irrelevant", reason: "This was unrelated to the target budget" }];
    old.readingErrors = [{ articleId: "error", targetId: "meta", error: "Timeout" }];
    const extra = emptyCoverage([
      first,
      { ...first, text: "New separate passage", offset: 5000 },
      { ...first, targetId: "google" },
      {
        ...first,
        url: "https://example.org/pdf",
        format: "pdf",
        contentKind: "pdf",
        sha256: "pdf",
        access: "body_verified",
        pages: [{ page: 2, textChars: 20, truncated: false }]
      }
    ]);
    extra.readingErrors = [{ articleId: "error", targetId: "meta", error: "Timeout" }];
    const merged = mergeExpandedLibrary(old, extra);
    expect(merged?.readings).toHaveLength(4);
    expect(merged?.usedArticleIds).toEqual(["same"]);
    expect(merged?.exclusions).toEqual(old.exclusions);
    expect(merged?.readingErrors).toHaveLength(1);
    expect(old.readings).toHaveLength(1);
    expect(mergeExpandedLibrary(null, old)).toBe(old);
    expect(mergeExpandedLibrary(old, null)).toBe(old);
    expect(mergeExpandedLibrary(null, null)).toBeNull();
  });

  it("rejects quote validation against a fake PDF reading even if its text contains the quote", () => {
    const failed: ExpandedLibraryReading = {
      articleId: "bank",
      targetId: "meta",
      title: "Bank",
      url: "https://example.org/bank/pdf",
      text: "The bank forecasts a lower capital budget.",
      offset: 0,
      sha256: "",
      contentKind: "pdf",
      format: "pdf",
      access: "unavailable",
      apiDate: "2026-09-12"
    };
    expect(() => validateLibraryUse(emptyCoverage([failed]), [claim({})], [])).toThrow(/exact quote/);
  });
});

it("searches every supplied focus query and preserves all fetched article characters and continuations", async () => {
  const lead = "Intro " + "x".repeat(12000),
    tail = "Decisive accounting footnote beyond the former limit.";
  gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
    if (name === "signal_desk_search")
      return {
        status: "ok",
        total: 1,
        next_offset: null,
        coverage: { catalogue_window_complete: true },
        results: [article("long")]
      };
    return {
      ...readResult(args),
      text: args.offset === 0 ? lead : tail,
      offset: args.offset,
      next_offset: args.offset === 0 ? lead.length : null,
      total_chars: lead.length + tail.length
    };
  });
  const result = await collectExpandedLibrary(
    {
      searchQueries: Array.from({ length: 5 }, (_, i) => ({
        ...query,
        query: `topic ${i}`,
        keywords: ["Meta", `topic${i}`]
      }))
    },
    undefined,
    { mode: "focused" }
  );
  expect(result?.queries).toHaveLength(5);
  expect(result?.readings.map((r) => r.text).join("")).toBe(lead + tail);
  expect(gateway.callResearchTool.mock.calls.filter((c) => c[0] === "signal_desk_read").map((c) => c[1])).toEqual([
    { article_id: "long", offset: 0, max_chars: 0 },
    { article_id: "long", offset: lead.length, max_chars: 0 }
  ]);
  expect(() =>
    validateLibraryUse(
      result,
      [claim({ articleId: "long", sourceUrl: "https://example.org/long/markdown", quote: tail })],
      [], [], ["https://example.org/long/markdown"]
    )
  ).not.toThrow();
});

it("retains partial PDF pages as partial evidence and follows every advancing continuation", async () => {
  gateway.callResearchTool.mockImplementation(async (name: string, args: Record<string, any>) => {
    if (name === "signal_desk_search")
      return { status: "ok", total: 1, results: [article("bank", "Foreign Research")] };
    if (name !== "signal_desk_pdf") return readResult(args);
    return {
      ...pdfResult(args),
      status: args.start_page === 1 ? "partial" : "ok",
      access: args.start_page === 1 ? "body_partial" : "body_verified",
      start_page: args.start_page,
      next_page: args.start_page === 1 ? 6 : null,
      total_pages: 12,
      pages: [{ page: args.start_page, text_chars: 50, truncated: args.start_page === 1 }]
    };
  });
  const result = await collectExpandedLibrary({ searchQueries: [query] });
  const pdfs = result?.readings.filter((r) => r.format === "pdf") ?? [];
  expect(pdfs.map((r) => r.startPage)).toEqual([1, 6]);
  expect(pdfs[0]).toMatchObject({ access: "body_partial", truncated: true });
  expect(result?.collectionAudit?.[0].targets[0].coverageExhausted).toBe(false);
  expect(
    gateway.callResearchTool.mock.calls
      .filter((c) => c[0] === "signal_desk_pdf")
      .every((c) => c[1].max_pages === 0 && c[1].max_chars === 0)
  ).toBe(true);
});
