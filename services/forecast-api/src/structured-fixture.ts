// Synthetic integration fixture; never used as a financial forecast.
import type { StructuredAnswer, StructuredForecastState } from "@autopoly/forecast-engine/answer-types";

export function structuredFixture(kind: StructuredAnswer["kind"] = "independent_ranking"): StructuredForecastState {
  const options = [
    { id: "alpha", label: "Alpha" },
    { id: "beta", label: "Beta" },
    { id: "gamma", label: "Gamma" },
    { id: "delta", label: "Delta" }
  ];
  const answer: StructuredAnswer =
    kind === "numeric"
      ? {
          kind,
          pointEstimate: 78,
          standardDeviation: 4,
          unit: "points",
          modelRange: [70, 86],
          rangeDescription: "Model uncertainty only; not a calibrated confidence interval."
        }
      : kind === "categorical"
        ? {
            kind,
            selectedId: "alpha",
            tiedIds: [],
            probabilities: options.map((option, index) => ({
              ...option,
              probability: [0.4, 0.3, 0.2, 0.1][index] ?? 0
            }))
          }
        : {
            kind,
            selectedId: "alpha",
            tiedIds: [],
            probabilitiesAreIndependent: true,
            ranking: options.map((option, index) => ({
              ...option,
              rank: index + 1,
              probability: [0.8, 0.7, 0.6, 0.2][index] ?? 0
            }))
          };
  return {
    schemaVersion: 2,
    eventId: `fixture-${kind.replaceAll("_", "-")}-12345678`,
    eventText: "Synthetic answer consumer test",
    request: { answerType: kind },
    createdAtUtc: "2026-09-13T00:00:00Z",
    updatedAtUtc: "2026-09-13T00:10:00Z",
    questionSpec: {
      kind,
      question:
        kind === "numeric"
          ? "What score will the synthetic project receive?"
          : "Which synthetic company is most likely to revise spending?",
      resolutionCriteria: "Synthetic criterion for verifying answer display; not an investment forecast.",
      resolutionDate: "2027-03-13",
      asOfDate: "2026-09-13",
      settlementSource: "Published project results",
      assumptions: ["Test scenario only."],
      options: kind === "numeric" ? [] : options,
      unit: kind === "numeric" ? "points" : null,
      minimum: kind === "numeric" ? 0 : null,
      maximum: kind === "numeric" ? 100 : null,
      scoreRubric: kind === "numeric" ? "0–100 quality scale." : null,
      prior:
        kind === "numeric" ? { mean: 75, standardDeviation: 6 } : { alpha: 0.25, beta: 0.25, gamma: 0.25, delta: 0.25 },
      priorRationale: "Synthetic prior.",
      searchQueries: []
    },
    status: "converged",
    round: 1,
    answer,
    evidenceLedger: [
      {
        id: "fixture-claim",
        claim: "The fixture includes a documented constraint.",
        targetIds: ["alpha"],
        sourceUrl: "https://example.com/source",
        sourceTitle: "Synthetic source <unsafe>",
        sourceType: "official",
        publishedAt: "2026-09-12",
        quote: "A short original excerpt <script>example</script>.",
        rationale: "This fixture checks that facts and quotes remain visible.",
        clusterId: "fixture",
        effects: { alpha: 0.2 },
        numericSignal: null,
        articleId: "fixture-article",
        epistemicStatus: "fact",
        round: 1,
        verifiedInSearchTrace: true,
        effectiveWeight: 1,
        before: answer,
        after: answer
      }
    ],
    roundHistory: [
      {
        round: 1,
        ts: "2026-09-13T00:10:00Z",
        before: answer,
        after: answer,
        newClaimCount: 1,
        duplicateCount: 0,
        confidence: "medium",
        reasoning: "Synthetic research round [01].",
        searchQueries: ["fixture evidence"],
        searchResultUrls: ["https://example.com/source"],
        costUsd: 0
      }
    ],
    expandedLibrary: {
      required: true,
      searchedAtUtc: "2026-09-13T00:00:00Z",
      queries: [{ targetId: "alpha", query: "fixture", status: "ok", total: 1 }],
      readings: [
        {
          articleId: "fixture-article",
          targetId: "alpha",
          title: "Private test article",
          url: "https://example.com/private",
          text: "PRIVATE_FULL_BODY_MUST_NOT_BE_EXPOSED",
          offset: 0,
          sha256: "fixture",
          contentKind: "markdown",
          apiDate: "2026-09-12"
        }
      ],
      usedArticleIds: ["fixture-article"],
      exclusions: []
    },
    summary: {
      verdict: "Synthetic conclusion with an original citation [01].",
      keyFindings: ["All answer values retain their meaning."],
      counterarguments: ["The fixture is not real research."],
      uncertainties: ["Calibration has not been measured."]
    },
    provider: "fixture"
  };
}
