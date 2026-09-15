// Tests for the decision-first report renderer (store.ts renderReport).
//
// The fixture is a hand-written 2-round state that exercises every review
// finding: pipe/bracket titles, agent self-notes, excluded market-price
// sources, reflections, inline [NN] citations, floor saturation and the
// market-blind banner.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderAuditReport as renderReport, renderReport as renderCurrentReport, sourceLabel } from "./store";
import type { ForecastState } from "./types";

const PIPE_TITLE = "IMF | Strait [7-day MA] Series";
const EXCLUDED_EXPLANATION = "EXCLUDED-EXPLANATION-SENTINEL should never render";

function makeState(): ForecastState {
  const eventText =
    "Will Strait of Hormuz traffic return to normal by December 31, considering mines, war-risk insurance, naval escorts, alternate corridors, and shifting political rhetoric?";
  return {
    eventId: "test-event-1a2b3c4d",
    eventText,
    framing: {
      normalizedQuestion:
        "Will the official transit index print a 7-day moving average of at least 60 before 2026-12-31?",
      resolutionCriteria: "YES if the official index prints >= 60 before 2026-12-31.",
      resolutionDate: "2026-12-31",
      settlementSource: "Official index publisher",
      assumptions: "Assumes the index keeps publishing daily.",
      forecastable: true,
      clarificationNeeded: "",
      priorProbability: 0.32,
      priorRationale: "Base rate for recoveries of this kind is roughly one in three.",
      framingCaveats: "The threshold is a partial-recovery bar, not full normalization.",
      framingConfidence: "high"
    },
    createdAtUtc: "2026-07-01T00:00:00.000Z",
    updatedAtUtc: "2026-07-06T00:00:00.000Z",
    currentProb: 0.01,
    credibleInterval: [0.01, 0.05],
    round: 2,
    status: "saturated",
    saturatedAt: "floor",
    marketBlind: { enabled: true, blockedCount: 1, priorSuspect: true },
    evidenceLedger: [
      {
        id: "s1",
        url: "https://example.com/pipes",
        urlCanonical: "example.com/pipes",
        title: PIPE_TITLE,
        claim: "Traffic is far below the bar.",
        stance: "supports_no",
        strength: "strong",
        kind: "evidence",
        clusterId: "traffic-data",
        clusterFactor: 1,
        effectiveLlr: -0.8,
        probBefore: 0.32,
        probAfter: 0.2,
        deltaPp: -12,
        rationale: "hard data",
        retrievedAtUtc: "2026-07-01T00:00:00.000Z",
        firstSeenRound: 1,
        verifiedInSearchTrace: true,
        sourceType: "official",
        credibility: "high"
      },
      {
        id: "s2",
        url: "https://example.com/echo",
        urlCanonical: "example.com/echo",
        title: "Echo coverage of the same traffic data",
        claim: "Repeat of the same story.",
        stance: "supports_no",
        strength: "moderate",
        kind: "evidence",
        clusterId: "traffic-data",
        clusterFactor: 0.5,
        effectiveLlr: -0.2,
        probBefore: 0.2,
        probAfter: 0.17,
        deltaPp: -3,
        rationale: "echo",
        retrievedAtUtc: "2026-07-01T00:00:00.000Z",
        firstSeenRound: 1,
        verifiedInSearchTrace: false,
        sourceType: "press",
        credibility: "medium"
      },
      {
        id: "s3",
        url: "https://example.com/reflection",
        urlCanonical: "example.com/reflection",
        title: "reflection on: Echo coverage of the same traffic data",
        claim: "The echo was overweighted.",
        stance: "supports_yes",
        strength: "weak",
        kind: "reflection",
        clusterId: "traffic-data",
        clusterFactor: 1,
        effectiveLlr: 0.1,
        probBefore: 0.17,
        probAfter: 0.19,
        deltaPp: 2,
        rationale: "walk-back",
        retrievedAtUtc: "2026-07-02T00:00:00.000Z",
        firstSeenRound: 2,
        verifiedInSearchTrace: true,
        sourceType: "press",
        credibility: "medium"
      },
      {
        id: "s4",
        url: "https://polymarket.com/market",
        urlCanonical: "polymarket.com/market",
        title: "Polymarket odds page",
        claim: "Market implies 55%.",
        stance: "supports_yes",
        strength: "moderate",
        kind: "evidence",
        clusterId: "market",
        clusterFactor: 1,
        effectiveLlr: 0,
        probBefore: 0.19,
        probAfter: 0.19,
        deltaPp: 0,
        rationale: "market price",
        retrievedAtUtc: "2026-07-02T00:00:00.000Z",
        firstSeenRound: 2,
        verifiedInSearchTrace: true,
        sourceType: "press",
        credibility: "low",
        excluded: "market_price"
      }
    ],
    roundHistory: [
      {
        round: 1,
        ts: "2026-07-01T00:00:00.000Z",
        priorProb: 0.32,
        postProb: 0.17,
        perSourceUpdates: [
          {
            url: "https://example.com/pipes",
            title: PIPE_TITLE,
            from: 0.32,
            to: 0.2,
            deltaPp: -12,
            explanation: "Hard data far below the bar.",
            verified: true,
            clusterId: "traffic-data",
            clusterFactor: 1,
            kind: "evidence",
            sourceType: "official",
            credibility: "high"
          },
          {
            url: "https://example.com/echo",
            title: "Echo coverage of the same traffic data",
            from: 0.2,
            to: 0.17,
            deltaPp: -3,
            explanation: "Repeat coverage of the same underlying story.",
            verified: false,
            clusterId: "traffic-data",
            clusterFactor: 0.5,
            kind: "evidence",
            sourceType: "press",
            credibility: "medium"
          }
        ],
        newSourceCount: 2,
        duplicateCount: 0,
        reflectionCount: 0,
        unverifiedPp: 3.0,
        confirmationRatio: 0.9,
        whyChanged: {
          netPp: -15,
          upPp: 0,
          downPp: -15,
          dominantUrl: "https://example.com/pipes",
          dominantTitle: PIPE_TITLE,
          dominantPp: -12,
          dominantKind: "evidence"
        },
        confidence: "medium",
        reasoning:
          "Found hard data showing the number is far below the bar.  Notes: Next round should check the official source directly.",
        searchQueries: ["q one", "q two", "q three"],
        searchResultUrlCount: 12,
        costUsd: null
      },
      {
        round: 2,
        ts: "2026-07-02T00:00:00.000Z",
        priorProb: 0.17,
        postProb: 0.01,
        perSourceUpdates: [
          {
            url: "https://example.com/reflection",
            title: "reflection on: Echo coverage of the same traffic data",
            from: 0.17,
            to: 0.19,
            deltaPp: 2,
            explanation: "The echo was overweighted last round.",
            verified: true,
            clusterId: "traffic-data",
            clusterFactor: 1,
            kind: "reflection",
            sourceType: "press",
            credibility: "medium"
          },
          {
            url: "https://polymarket.com/market",
            title: "Polymarket odds page",
            from: 0.19,
            to: 0.19,
            deltaPp: 0,
            explanation: EXCLUDED_EXPLANATION,
            verified: true,
            clusterId: "market",
            clusterFactor: 1,
            kind: "evidence",
            sourceType: "press",
            credibility: "low",
            excluded: "market_price"
          }
        ],
        newSourceCount: 1,
        duplicateCount: 0,
        reflectionCount: 1,
        unverifiedPp: 0,
        confirmationRatio: 0.7,
        whyChanged: null,
        confidence: "medium",
        reasoning: "Reflection walked back part of the echo weighting; the market source was excluded.",
        searchQueries: ["q four"],
        searchResultUrlCount: 4,
        costUsd: null
      }
    ],
    summary: {
      verdict:
        "P(YES) sits at the engine floor because the hard data [01] is far below the bar. Echo coverage [02] added little and a reflection [03] walked part of it back.",
      keyFactorsYes: ["A reflection walked back part of the echo weighting [03]"],
      keyFactorsNo: [
        "Hard traffic data is far below the resolution bar [01]",
        "Repeat coverage confirms the plateau [02]"
      ],
      mainUncertainties: "Whether clearance starts before the deadline.",
      calibrationNote: "",
      whySentence: "P(YES) is pinned at the engine floor because the hard data [01] sits far below the resolution bar."
    }
  };
}

describe("sourceLabel", () => {
  it("escapes pipes and brackets and collapses newlines", () => {
    expect(sourceLabel("A | B [C]\nD", "https://x.com")).toBe("[A \\| B \\[C\\] D](https://x.com)");
  });
  it("truncates long titles to 80 chars", () => {
    expect(sourceLabel("x".repeat(100), "https://x.com")).toBe(`[${"x".repeat(80)}…](https://x.com)`);
  });
  it("falls back to the url when the title is empty", () => {
    expect(sourceLabel("  ", "https://x.com")).toBe("https://x.com");
  });
});

describe("renderReport (decision-first layout)", () => {
  const originalLanguage = process.env.FORECAST_LANGUAGE;

  beforeEach(() => {
    delete process.env.FORECAST_LANGUAGE;
  });
  afterEach(() => {
    if (originalLanguage === undefined) delete process.env.FORECAST_LANGUAGE;
    else process.env.FORECAST_LANGUAGE = originalLanguage;
  });

  it("leads with the truncated event text H1 and P(YES) within the first 10 lines", () => {
    const state = makeState();
    const lines = renderReport(state).split("\n");
    expect(state.eventText.length).toBeGreaterThan(120); // fixture must exercise truncation
    expect(lines[0]).toBe(`# ${state.eventText.slice(0, 120)}…`);
    const pIdx = lines.findIndex((l) => l.includes("**Probability of YES (P(YES)):"));
    expect(pIdx).toBeGreaterThan(0);
    expect(pIdx).toBeLessThan(10);
  });

  it("escapes pipes/brackets in source titles so table rows stay intact", () => {
    const report = renderReport(makeState());
    expect(report).not.toContain(`| ${PIPE_TITLE}`); // raw title would add phantom columns
    const row = report.split("\n").find((l) => l.startsWith("|") && l.includes("IMF \\| Strait"));
    expect(row).toBeDefined();
    expect(row).toContain("\\[7-day MA\\]");
    const headerPipes = (
      "| # | Claim | Direction | Quality | Cross-check | Best and supporting sources |".match(/\|/g) ?? []
    ).length;
    const rowPipes = ((row as string).match(/(?<!\\)\|/g) ?? []).length;
    expect(rowPipes).toBe(headerPipes);
  });

  it("drops the agent's 'Notes:' self-instructions from round reasoning", () => {
    const report = renderReport(makeState());
    expect(report).toContain("Found hard data showing");
    expect(report).not.toContain("Next round should check");
    expect(report).not.toContain("Notes:");
  });

  it("summarizes searches instead of dumping every query", () => {
    const report = renderReport(makeState());
    expect(report).toContain("3 searches (see state.json)");
    expect(report).not.toContain("`q one`");
  });

  it("flags excluded market-price sources in the table and skips their bullets", () => {
    const report = renderReport(makeState());
    const rows = report.split("\n").filter((l) => l.startsWith("|") && l.includes("Polymarket odds page"));
    expect(rows.some((l) => l.includes("⛔ excluded: market price"))).toBe(true);
    expect(report).not.toContain(EXCLUDED_EXPLANATION);
  });

  it("prints the one-sided/unverified warnings once, in the worst round only", () => {
    const report = renderReport(makeState());
    expect((report.match(/one-sided/g) ?? []).length).toBe(1);
    expect((report.match(/UNVERIFIED/g) ?? []).length).toBe(1);
    // the non-worst round still gets its plain confirmation-ratio line
    expect((report.match(/Confirmation ratio/g) ?? []).length).toBe(2);
  });

  it("relocates every framing field to a bottom appendix", () => {
    const report = renderReport(makeState());
    const appendixIdx = report.indexOf("## Appendix: framing");
    expect(appendixIdx).toBeGreaterThan(report.indexOf("**P(YES):"));
    expect(appendixIdx).toBeGreaterThan(report.indexOf("## Cumulative evidence ledger"));
    const appendix = report.slice(appendixIdx);
    expect(appendix).toContain("Base rate for recoveries of this kind"); // prior rationale
    expect(appendix).toContain("test-event-1a2b3c4d");
    expect(appendix).toContain("official index prints"); // resolution criteria
    expect(appendix).toContain("partial-recovery bar"); // framing caveats
    expect(appendix).toContain("2026-07-06T00:00:00.000Z"); // last updated
  });

  it("links [NN] citations to ledger anchors", () => {
    const report = renderReport(makeState());
    expect(report).toContain("[[01]](#src-01)");
    expect(report).toContain('<a id="src-01"></a>1');
    expect(report).toContain('<a id="src-04"></a>4');
  });

  it("annotates a floor-saturated P(YES) and renders the market-blind banner", () => {
    const report = renderReport(makeState());
    expect(report).toContain("**Probability of YES (P(YES)): 1.0%**");
    expect(report).toContain("engine floor");
    expect(report).toContain("Market-blind");
    expect(report).toContain("market-anchored");
  });

  it("renders ledger stances in plain arrows and marks the excluded row", () => {
    const report = renderReport(makeState());
    expect(report).toContain("→NO");
    expect(report).toContain("→YES ⛔");
    expect(report).not.toContain("supports_no");
  });

  it("shows a still-researching note when summary is null (mid-run)", () => {
    const report = renderReport({ ...makeState(), summary: null });
    expect(report).toContain("round 2 — still researching");
    expect(report).toContain("**Probability of YES (P(YES)):"); // the number still leads mid-run
  });

  it("renders zh template strings when FORECAST_LANGUAGE=zh", () => {
    process.env.FORECAST_LANGUAGE = "zh";
    const report = renderReport(makeState());
    expect(report).toContain("## 附录：问题框架");
    expect(report).toContain("引擎可表达的下限");
    expect(report).toContain("市场盲测");
    expect(report).toContain("第 1 轮");
  });
});


describe("current report without iteration history", () => {
  it("shows the final assessment and working source anchors without audit tables", () => {
    const report = renderCurrentReport(makeState());
    expect(report).toContain("Probability of YES");
    expect(report).toContain('id="src-01"');
    expect(report).not.toContain("## Probability trajectory");
    expect(report).not.toContain("## Round 1");
    expect(report).not.toContain("Rounds:");
  });
});
