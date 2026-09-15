import { describe, expect, it } from "vitest";
import { answerStatus, buildAnswer, sanitizeLogTail, verdictFor } from "./answer";
import { loadConfig } from "./config";
import { renderHtml, escapeHtml } from "./render-html";
import { renderText } from "./render-text";
import type { ForecastState } from "./repo";
import type { Job } from "./run-manager";

const state: ForecastState = {
  eventId: "will-x-happen-abc12345",
  eventText: "Will X happen before 2027?",
  framing: {
    normalizedQuestion: "Will X officially happen before 2027-01-01?",
    resolutionCriteria: "YES if X is officially confirmed",
    resolutionDate: "2026-12-31",
    settlementSource: "Official X announcement",
    assumptions: "Standard definition of X",
    forecastable: true,
    clarificationNeeded: "",
    priorProbability: 0.4,
    priorRationale: "Base rate of similar events",
    framingCaveats: "",
    framingConfidence: "high"
  },
  createdAtUtc: "2026-07-01T00:00:00Z",
  updatedAtUtc: "2026-07-01T01:00:00Z",
  currentProb: 0.62,
  credibleInterval: [0.5, 0.74],
  round: 2,
  status: "converged",
  evidenceLedger: [
    {
      id: "e1",
      url: "https://example.com/a?b=1&c=<tag>",
      urlCanonical: "example.com/a",
      title: 'Official statement <with> "quotes"',
      claim: "X was pre-announced & scheduled",
      stance: "supports_yes",
      strength: "strong",
      kind: "evidence",
      clusterId: "c1",
      clusterFactor: 1,
      effectiveLlr: 0.5,
      probBefore: 0.4,
      probAfter: 0.55,
      deltaPp: 15,
      rationale: "Direct confirmation",
      retrievedAtUtc: "2026-07-01T00:30:00Z",
      firstSeenRound: 1,
      verifiedInSearchTrace: true,
      sourceType: "official",
      credibility: "high"
    }
  ],
  roundHistory: [
    {
      round: 1,
      ts: "2026-07-01T00:40:00Z",
      priorProb: 0.4,
      postProb: 0.55,
      perSourceUpdates: [],
      newSourceCount: 1,
      duplicateCount: 0,
      reflectionCount: 0,
      unverifiedPp: 0,
      confirmationRatio: null,
      whyChanged: {
        netPp: 15,
        upPp: 15,
        downPp: 0,
        dominantUrl: "https://example.com/a",
        dominantTitle: "Official statement",
        dominantPp: 15,
        dominantKind: "evidence"
      },
      confidence: "medium",
      reasoning: "solid official signal",
      searchQueries: ["x announcement"],
      searchResultUrlCount: 9,
      costUsd: null
    },
    {
      round: 2,
      ts: "2026-07-01T01:00:00Z",
      priorProb: 0.55,
      postProb: 0.62,
      perSourceUpdates: [],
      newSourceCount: 0,
      duplicateCount: 1,
      reflectionCount: 0,
      unverifiedPp: 0,
      confirmationRatio: 1,
      whyChanged: null,
      confidence: "medium",
      reasoning: "no counter-evidence found",
      searchQueries: ["x delayed"],
      searchResultUrlCount: 4,
      costUsd: null
    }
  ],
  summary: {
    verdict: "First paragraph citing [01].\n\nSecond paragraph.",
    keyFactorsYes: ["Official pre-announcement"],
    keyFactorsNo: ["Timeline risk"],
    mainUncertainties: "Regulatory approval timing",
    calibrationNote: "",
    whySentence: "An official pre-announcement puts X on track.",
    confidenceReason: "single strong source, no disconfirmation"
  },
  provider: "deepseek"
};

describe("answerStatus", () => {
  // state.updatedAtUtc is 2026-07-01T01:00:00Z in the fixture.
  const BEFORE = "2026-07-01T00:00:00Z";
  const AFTER = "2026-07-01T02:00:00Z";
  const job = (status: Job["status"], startedAtUtc = BEFORE, endedAtUtc: string | null = null): Job => ({
    eventId: "e",
    question: "q",
    status,
    code: null,
    log: [],
    startedAtUtc,
    endedAtUtc,
    maxRounds: 3,
    provider: "claude"
  });

  it("maps engine + job states to public statuses", () => {
    expect(answerStatus(state, null)).toBe("done");
    expect(answerStatus({ ...state, status: "open" }, null)).toBe("running");
    expect(answerStatus({ ...state, status: "aborted" }, null)).toBe("aborted");
    expect(answerStatus(null, job("running"))).toBe("running");
    expect(answerStatus(null, job("unforecastable"))).toBe("unforecastable");
    expect(answerStatus(null, job("error"))).toBe("error");
    expect(answerStatus(null, null)).toBe("error");
  });

  it("a newer terminal state beats a stale terminal job (cross-container rerun)", () => {
    // Our run died, then the raven container re-ran the question to completion.
    expect(answerStatus(state, job("error", BEFORE))).toBe("done");
    expect(answerStatus(state, job("unforecastable", BEFORE))).toBe("done");
  });

  it("a terminal state beats a stale synthetic 'running' job (reattach case)", () => {
    // Reattached jobs carry startedAtUtc = state.createdAtUtc (<= updatedAtUtc)
    // and are never updated — when the engine finishes, state wins.
    expect(answerStatus(state, job("running", BEFORE))).toBe("done");
  });

  it("a job newer than the last state write is the newest attempt", () => {
    // --fresh rerun spawned after an old completed forecast: report the rerun.
    expect(answerStatus(state, job("running", AFTER))).toBe("running");
    expect(answerStatus(state, job("error", AFTER))).toBe("error");
    expect(answerStatus(state, job("unforecastable", AFTER))).toBe("unforecastable");
  });

  it("open state + dead local job: state writes newer than the job's end mean another writer owns it", () => {
    const open = { ...state, status: "open" as const };
    const dead = job("error", BEFORE, BEFORE);
    expect(answerStatus(open, dead, Date.parse(AFTER))).toBe("running");
    expect(answerStatus(open, dead, Date.parse("2026-06-30T00:00:00Z"))).toBe("error");
  });
});

describe("sanitizeLogTail", () => {
  it("drops internal-band lines and masks key-shaped strings", () => {
    const out = sanitizeLogTail([
      "FINAL P(YES) = 62.0%  (internal band 50.0% – 74.0%)",
      "round 1 done",
      "using key sk-abc123DEF456xyz for provider",
      "Authorization: Bearer very-secret-token"
    ]);
    expect(out).toHaveLength(3);
    expect(out.join("\n")).not.toContain("internal band");
    expect(out.join("\n")).not.toContain("sk-abc123DEF456xyz");
    expect(out.join("\n")).not.toContain("very-secret-token");
  });
});

describe("loadConfig token fallback", () => {
  it("empty FORECAST_API_TOKEN= falls back to RAVEN_ACCESS_TOKEN instead of disabling the gate", () => {
    const cfg = loadConfig({ FORECAST_API_TOKEN: "", RAVEN_ACCESS_TOKEN: "secret" } as NodeJS.ProcessEnv);
    expect(cfg.token).toBe("secret");
    expect(loadConfig({ FORECAST_API_TOKEN: "own" } as NodeJS.ProcessEnv).token).toBe("own");
    expect(loadConfig({} as NodeJS.ProcessEnv).token).toBe(null);
  });
});

describe("buildAnswer", () => {
  const answer = buildAnswer(state.eventId, state, null, "http://host");

  it("carries probability, verdict, analysis and evidence", () => {
    expect(answer.probability).toBe(0.62);
    expect(answer.probabilityPct).toBe("62%");
    expect(answer.verdict).toBe("Leaning yes");
    expect(answer.confidence).toBe("medium");
    expect(answer.analysis?.whySentence).toContain("official pre-announcement puts X on track");
    expect(answer.analysis?.rounds).toHaveLength(2);
    expect(answer.evidence).toHaveLength(1);
    expect(answer.evidence[0]?.n).toBe(1);
    expect(answer.links.pdf).toBe(`http://host/v1/forecasts/${state.eventId}/pdf`);
  });

  it("NEVER exposes the internal credibleInterval band (policy 2026-07-02)", () => {
    const flat = JSON.stringify(answer).toLowerCase();
    expect(flat).not.toContain("credibleinterval");
    expect(flat).not.toContain("interval");
    expect(flat).not.toContain("0.74");
  });
});

describe("verdictFor", () => {
  it("buckets match the raven app", () => {
    expect(verdictFor(0.05)).toBe("Very unlikely");
    expect(verdictFor(0.5)).toBe("Too close to call");
    expect(verdictFor(0.95)).toBe("Very likely");
  });
});

describe("renderText", () => {
  const text = renderText(buildAnswer(state.eventId, state, null, "http://host"));

  it("is decision-first and complete", () => {
    expect(text).toContain("PROBABILITY (YES): 62%");
    expect(text).toContain("Verdict: Leaning yes");
    expect(text).toContain("WHY THIS NUMBER");
    expect(text).toContain("[01] Official statement");
    expect(text).toContain("HOW THE NUMBER MOVED");
    expect(text).toContain("not financial or betting advice");
  });

  it("keeps the interval internal", () => {
    expect(text.toLowerCase()).not.toContain("interval");
    expect(text).not.toContain("74%");
  });
});

describe("renderHtml", () => {
  const html = renderHtml(buildAnswer(state.eventId, state, null, "http://host"));

  it("escapes untrusted source fields", () => {
    expect(html).not.toContain("<with>");
    expect(html).toContain("&lt;with&gt;");
    expect(html).not.toContain("b=1&c=<tag>");
  });

  it("renders the dossier sections", () => {
    expect(html).toContain("62%");
    expect(html).toContain("Leaning yes");
    expect(html).toContain("Evidence — 1 sources");
    expect(html).toContain("Method &amp; scope");
    expect(html.toLowerCase()).not.toContain("credible");
  });
});

describe("escapeHtml", () => {
  it("escapes all five specials", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("incomplete binary forecasts", () => {
  it.each(["research_failed", "insufficient_evidence", "max_rounds"] as const)(
    "%s exposes evidence and a working estimate, never a final answer",
    (status) => {
      const stopped = { ...state, status, researchBlocker: "The official baseline is unavailable." } as ForecastState;
      const answer = buildAnswer("blocked", stopped, null, "http://localhost");
      expect(answer.status).toBe(status);
      expect(answer.isFinal).toBe(false);
      expect(answer.probability).toBeNull();
      expect(answer.answerLabel).toBeNull();
      expect(answer.verdict).toBeNull();
      expect(answer.analysis?.verdict).toBeNull();
      expect(answer.workingEstimate).toMatchObject({ provisional: true, probability: state.currentProb });
      expect(answer.evidence).toHaveLength(state.evidenceLedger.length);
      for (const output of [renderText(answer), renderHtml(answer)]) {
        expect(output).toContain("INCOMPLETE");
        expect(output).toContain("official baseline");
        expect(output).not.toContain("WHY THIS NUMBER");
      }
    }
  );
});
