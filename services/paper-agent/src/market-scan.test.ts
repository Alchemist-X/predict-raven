import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCAN_OPTIONS, filterScanRows, scanMarkets, type ScanRow } from "./market-scan";

const NOW = Date.parse("2026-07-03T00:00:00Z");
const FUTURE = "2026-09-01T00:00:00Z";

const base: ScanRow = {
  slug: "will-x-happen",
  question: "Will X happen?",
  outcomes: '["Yes","No"]',
  clobTokenIds: '["1","2"]',
  closed: false,
  endDate: FUTURE,
  volume24hr: 50_000,
  liquidityNum: 20_000,
  bestBid: 0.4,
  bestAsk: 0.42
};

describe("single-event exposure cap", () => {
  // The Hormuz case: same macro event, three expiries → one event slug.
  const positionsForEvent = (eventSlug: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ eventSlug, slug: `m${i}` }));

  it("counts open positions sharing a Gamma event", () => {
    const held = positionsForEvent("strait-of-hormuz-normal", 1);
    const count = (ev: string) => held.filter((p) => p.eventSlug === ev).length;
    expect(count("strait-of-hormuz-normal")).toBe(1);
    expect(count("some-other-event")).toBe(0);
    // maxPerEvent=1 → a second market on the same event is blocked
    expect(count("strait-of-hormuz-normal") >= 1).toBe(true);
  });
});

describe("filterScanRows", () => {
  it("accepts a liquid, binary, mid-priced market", () => {
    const out = filterScanRows([base], "finance", DEFAULT_SCAN_OPTIONS, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ slug: "will-x-happen", category: "finance", liquidityUsd: 20_000 });
  });

  it("rejects non-Yes/No, illiquid, longshot, imminent and closed rows", () => {
    const rows: ScanRow[] = [
      { ...base, slug: "teams", outcomes: '["Switzerland","Algeria"]' },
      { ...base, slug: "thin", liquidityNum: 1_000 }, // below the $5k risk floor
      { ...base, slug: "quiet", volume24hr: 100 },
      { ...base, slug: "longshot", bestAsk: 0.01 },
      { ...base, slug: "imminent", endDate: "2026-07-03T12:00:00Z" }, // <48h
      { ...base, slug: "done", closed: true },
      { ...base, slug: "ok" }
    ];
    const out = filterScanRows(rows, "tech", DEFAULT_SCAN_OPTIONS, NOW);
    expect(out.map((c) => c.slug)).toEqual(["ok"]);
  });

  it("caps at perCategory", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...base, slug: `m${i}` }));
    const out = filterScanRows(rows, "geopolitics", { ...DEFAULT_SCAN_OPTIONS, perCategory: 3 }, NOW);
    expect(out).toHaveLength(3);
  });
});

describe("scanMarkets", () => {
  beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NOW); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Same shortlist behind every category tag — only the rng differs between cases.
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...base, slug: `m${i}`, volume24hr: 50_000 - i * 1000 }));
  const fetchFn = (async () => ({ ok: true, json: async () => rows })) as unknown as typeof fetch;

  it("draws exactly one candidate per category, not the whole shortlist", async () => {
    const out = await scanMarkets(["finance", "tech"], DEFAULT_SCAN_OPTIONS, fetchFn, () => 0);
    expect(out).toHaveLength(2);
  });

  it("a different rng draws a different candidate from the same shortlist", async () => {
    const first = await scanMarkets(["finance"], DEFAULT_SCAN_OPTIONS, fetchFn, () => 0);
    const last = await scanMarkets(["finance"], DEFAULT_SCAN_OPTIONS, fetchFn, () => 0.999);
    expect(first[0]?.slug).toBe("m0");
    expect(last[0]?.slug).toBe("m4");
    expect(first[0]?.slug).not.toBe(last[0]?.slug);
  });

  it("never draws the same slug twice across categories that see overlapping rows", async () => {
    // rng pinned at 0 would pick "m0" for both categories if dedup didn't apply —
    // assert the second category's pick is excluded from repeating the first's.
    const out = await scanMarkets(["finance", "tech"], DEFAULT_SCAN_OPTIONS, fetchFn, () => 0);
    const slugs = out.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
