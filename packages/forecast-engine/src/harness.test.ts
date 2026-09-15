// Harness tests for the provider dispatch + analyst-in-the-loop extensions:
// lenient source_type/credibility validation, the DeepSeek provider (fake
// fetch), the provider-/analyst-aware prompt contract, and the full loop with
// an injected agent against a tmp artifact root.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRoundOutput } from "./claude-agent";
import type { AgentRunResult } from "./claude-agent";
import { collectCitedUrls, runDeepSeekRaw, verifyCitedUrls } from "./deepseek-agent";
import { buildPrompt, newForecastState, runForecast } from "./engine";
import { loadAnalyst, saveAnalyst } from "./store";
import { validateSummary } from "./summary";
import type { AnalystState, EventFraming, LedgerEntry } from "./types";

const framing = (priorProbability: number): EventFraming => ({
  normalizedQuestion: "q",
  resolutionCriteria: "c",
  resolutionDate: "2026-12-31",
  settlementSource: "s",
  assumptions: "",
  forecastable: true,
  clarificationNeeded: "",
  priorProbability,
  priorRationale: "r",
  framingCaveats: "",
  framingConfidence: "medium"
});

const ledgerEntry = (id: string, url: string, claim: string): LedgerEntry => ({
  id,
  url,
  urlCanonical: url.replace(/^https:\/\//, ""),
  title: "T",
  claim,
  stance: "supports_yes",
  strength: "moderate",
  kind: "evidence",
  clusterId: "c",
  clusterFactor: 1,
  effectiveLlr: 0.5,
  probBefore: 0.5,
  probAfter: 0.6,
  deltaPp: 10,
  rationale: "r",
  retrievedAtUtc: "2026-01-01T00:00:00Z",
  firstSeenRound: 1,
  verifiedInSearchTrace: true,
  sourceType: "press",
  credibility: "medium"
});

describe("validateRoundOutput source_type/credibility (lenient, never throws)", () => {
  const good = {
    round_summary: "ok",
    new_evidence: [
      {
        claim: "x",
        source_url: "https://a.com",
        source_title: "A",
        stance: "supports_yes",
        strength: "moderate",
        llr: 0.5,
        rationale: "r"
      }
    ],
    agent_holistic_probability: 0.5,
    confidence: "medium",
    found_new_information: true,
    notes: ""
  };

  it("defaults missing source_type to press and credibility to medium", () => {
    const out = validateRoundOutput(good);
    expect(out.newClaims[0].sources[0].sourceType).toBe("press");
    expect(out.newClaims[0].sources[0].credibility).toBe("medium");
  });
  it("accepts valid values", () => {
    const out = validateRoundOutput({
      ...good,
      new_evidence: [{ ...good.new_evidence[0], source_type: "official", credibility: "high" }]
    });
    expect(out.newClaims[0].sources[0].sourceType).toBe("official");
    expect(out.newClaims[0].sources[0].credibility).toBe("high");
  });
  it("falls back to defaults on invalid values instead of throwing", () => {
    const out = validateRoundOutput({
      ...good,
      new_evidence: [{ ...good.new_evidence[0], source_type: "blog", credibility: "certain" }]
    });
    expect(out.newClaims[0].sources[0].sourceType).toBe("press");
    expect(out.newClaims[0].sources[0].credibility).toBe("medium");
  });
});

describe("validateRoundOutput claim graph", () => {
  it("ranks the best supporting source first and keeps corroboration on one claim", () => {
    const out = validateRoundOutput({
      round_summary: "Two independent records support one factual claim.",
      new_claims: [
        {
          claim_id: "shipment-date",
          focus_id: "resolution-state",
          claim: "The product shipped on 20 August 2026.",
          stance: "supports_yes",
          strength: "strong",
          llr: 0.9,
          rationale: "This directly satisfies the date condition.",
          cluster_id: "shipment-event",
          category: "resolution",
          resolution_relevance: "direct",
          selection_rationale: "The official record is direct; the registry independently corroborates it.",
          sources: [
            {
              url: "https://commentary.example/denial",
              title: "A high-quality contradiction",
              source_type: "original_reporting",
              credibility: "high",
              relation: "contradicts",
              support_quality: "direct",
              is_primary: false,
              independence_group: "reporter-a"
            },
            {
              url: "https://official.example/release",
              title: "Official release record",
              source_type: "official",
              credibility: "high",
              relation: "supports",
              support_quality: "direct",
              is_primary: true,
              independence_group: "issuer"
            },
            {
              url: "https://registry.example/record",
              title: "Independent registry record",
              source_type: "data",
              credibility: "high",
              relation: "supports",
              support_quality: "direct",
              is_primary: true,
              independence_group: "registry"
            }
          ]
        }
      ],
      reflection: [],
      confidence: "high",
      found_new_information: true,
      notes: ""
    });

    expect(out.newClaims).toHaveLength(1);
    expect(out.newClaims[0].source_url).toBe("https://registry.example/record");
    expect(out.newClaims[0].sources).toHaveLength(3);
    expect(out.newClaims[0].cross_check_status).toBe("contested");
  });
});

describe("deepseek-agent", () => {
  const savedKey = process.env.DEEPSEEK_API_KEY;
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    delete process.env.DEEPSEEK_PRICE_IN_PER_MTOK;
    delete process.env.DEEPSEEK_PRICE_OUT_PER_MTOK;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = savedKey;
  });

  it("happy path: parses the completion content into jsonObject; citations liveness-verified", async () => {
    const content = { answer: 42, new_evidence: [{ source_url: "https://cited.com/a" }] };
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(content) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 }
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 200 }); // liveness probe for cited URLs
    }) as unknown as typeof fetch;

    const res = await runDeepSeekRaw("respond with a json object", {}, { fetchFn });
    expect(res.jsonObject).toEqual(content);
    expect(res.jsonError).toBeNull();
    expect(res.searchQueries).toEqual([]); // provider has no search
    expect(res.searchResultUrls.has("https://cited.com/a")).toBe(true);
    expect(res.numTurns).toBe(1);
    expect(res.exitCode).toBe(0);
    expect(res.costUsd).toBeNull(); // no price env set
  });

  it("non-2xx response throws with the status and body head", async () => {
    const fetchFn = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(runDeepSeekRaw("p", {}, { fetchFn })).rejects.toThrow(/500.*boom/);
  });

  it("collectCitedUrls deep-scans source_url and new_source_url fields", () => {
    const obj = {
      new_evidence: [{ source_url: "https://a.com/x" }],
      reflection: [{ target_url: "https://ignored.com", new_source_url: "https://b.com/y" }],
      nested: { deeper: [{ source_url: "https://c.com/z" }] }
    };
    const urls = collectCitedUrls(obj);
    expect(urls).toContain("https://a.com/x");
    expect(urls).toContain("https://b.com/y");
    expect(urls).toContain("https://c.com/z");
    expect(urls).not.toContain("https://ignored.com"); // target_url is a prior source, not a citation
  });

  it("verifyCitedUrls: HEAD 200 verified, 404 not, HEAD-throws-but-GET-200 verified", async () => {
    const fetchFn = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://ok.com/a") return { status: 200 } as unknown as Response;
      if (url === "https://gone.com/b") return { status: 404 } as unknown as Response;
      // https://headless.com/c — HEAD throws, GET succeeds
      if (init?.method === "HEAD") throw new Error("HEAD not supported");
      return { status: 200 } as unknown as Response;
    }) as unknown as typeof fetch;
    const v = await verifyCitedUrls(["https://ok.com/a", "https://gone.com/b", "https://headless.com/c"], fetchFn);
    expect(v.has("https://ok.com/a")).toBe(true);
    expect(v.has("https://gone.com/b")).toBe(false);
    expect(v.has("https://headless.com/c")).toBe(true);
  });

  it("verifyCitedUrls: anti-bot refusals (403/429) count as live; only 404/410/unreachable are dead", async () => {
    const fetchFn = (async (input: unknown) => {
      const url = String(input);
      if (url === "https://paywalled.com/a") return { status: 403 } as unknown as Response;
      if (url === "https://ratelimited.com/b") return { status: 429 } as unknown as Response;
      if (url === "https://removed.com/c") return { status: 410 } as unknown as Response;
      throw new Error("unreachable"); // https://down.com/d — both probes throw
    }) as unknown as typeof fetch;
    const v = await verifyCitedUrls(
      ["https://paywalled.com/a", "https://ratelimited.com/b", "https://removed.com/c", "https://down.com/d"],
      fetchFn
    );
    expect(v.has("https://paywalled.com/a")).toBe(true);
    expect(v.has("https://ratelimited.com/b")).toBe(true);
    expect(v.has("https://removed.com/c")).toBe(false);
    expect(v.has("https://down.com/d")).toBe(false);
  });
});

describe("buildPrompt (provider- and analyst-aware)", () => {
  const mkState = () => newForecastState({ eventId: "evt", eventText: "t", framing: framing(0.5) });

  it("contains the source_type/credibility contract", () => {
    const p = buildPrompt(mkState(), 1, 3, { hasWebSearch: true, analyst: null });
    expect(p).toContain('"source_type": "official" | "data" | "academic"');
    expect(p).toContain('"credibility": "high" | "medium" | "low"');
    expect(p).toContain("FOCUS CENTER");
    expect(p).toContain("BREADTH BEFORE SELECTION");
    expect(p).toContain("at least 6 meaningfully different searches");
    expect(p).toContain("Prefer full, plain-language names over abbreviations");
    expect(p).toContain("the engine alone owns the probability");
  });

  it("no-web variant mentions no WebSearch and forbids fabricated URLs", () => {
    const p = buildPrompt(mkState(), 1, 3, { hasWebSearch: false, analyst: null });
    expect(p.includes("WebSearch")).toBe(false);
    expect(p).toContain("You have no web access");
    expect(p).toContain("never invent a URL");
    expect(p).toContain("strongest countercase");
  });

  it("renders analyst notes and doubt marks into the ANALYST INPUT section", () => {
    const state = mkState();
    state.evidenceLedger.push(ledgerEntry("led-1", "https://src.com/a", "prior claim"));
    const analyst: AnalystState = {
      notes: [
        {
          id: "note-1",
          text: "check the supplier filing",
          stance: "no",
          targetId: "led-1",
          createdAtUtc: "2026-01-01T00:00:00Z",
          consumedRound: null
        },
        {
          id: "note-0",
          text: "already used lead",
          stance: "yes",
          targetId: null,
          createdAtUtc: "2026-01-01T00:00:00Z",
          consumedRound: 1
        }
      ],
      marks: { "led-1": "doubt" }
    };
    const p = buildPrompt(state, 2, 3, { hasWebSearch: true, analyst });
    expect(p).toContain("ANALYST INPUT");
    expect(p).toContain("[PUSHES NO] (re: https://src.com/a) check the supplier filing");
    expect(p).toContain("The analyst DOUBTS these prior sources");
    expect(p).toContain("- https://src.com/a — prior claim");
    expect(p).not.toContain("already used lead"); // consumed notes are not re-injected
  });

  it("renders no analyst section when there is nothing to inject", () => {
    const p = buildPrompt(mkState(), 1, 3, { hasWebSearch: true, analyst: null });
    expect(p).not.toContain("ANALYST INPUT");
    // "keep" marks alone are endorsements, not injectable input
    const p2 = buildPrompt(mkState(), 1, 3, {
      hasWebSearch: true,
      analyst: { notes: [], marks: { "led-1": "keep" } }
    });
    expect(p2).not.toContain("ANALYST INPUT");
  });
});

describe("runForecast loop (injected agent, tmp artifact root)", () => {
  let tmpRoot: string;
  let savedRoot: string | undefined;
  beforeEach(() => {
    savedRoot = process.env.ARTIFACT_STORAGE_ROOT;
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "forecast-harness-"));
    process.env.ARTIFACT_STORAGE_ROOT = tmpRoot;
  });
  afterEach(() => {
    if (savedRoot === undefined) delete process.env.ARTIFACT_STORAGE_ROOT;
    else process.env.ARTIFACT_STORAGE_ROOT = savedRoot;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  const agentResult = (out: unknown, urls: string[] = []): AgentRunResult => ({
    rawFinalText: JSON.stringify(out),
    jsonObject: out,
    jsonError: null,
    searchQueries: urls.length ? ["q1", "q2", "q3", "q4", "q5", "q6"] : [],
    searchResultUrls: new Set(urls),
    costUsd: null,
    numTurns: 1,
    exitCode: 0,
    stderrTail: ""
  });

  const evidence = (url: string, llr: number, extra: Record<string, unknown> = {}) => ({
    claim: `claim for ${url}`,
    source_url: url,
    source_title: "T",
    stance: "supports_yes",
    strength: "moderate",
    llr,
    rationale: "r",
    cluster_id: "",
    ...extra
  });

  const roundOut = (evs: unknown[]) => ({
    round_summary: "found things",
    new_evidence: evs,
    reflection: [],
    agent_holistic_probability: 0.6,
    confidence: "medium",
    found_new_information: evs.length > 0,
    notes: ""
  });

  const summaryOut = {
    verdict: "Landed here because of [01].",
    key_factors_yes: ["a"],
    key_factors_no: [],
    main_uncertainties: "",
    calibration_note: "",
    why_sentence: "The decisive filing pushed it up.",
    quip: "Markets hate suspense.",
    confidence_reason: "Two independent sources agree."
  };

  it("applies one probability update to one claim even when two independent sources support it", async () => {
    const state = newForecastState({ eventId: "evt-claim-graph", eventText: "t", framing: framing(0.5) });
    const claimRound = {
      round_summary: "The filing and registry independently establish the same event.",
      new_claims: [
        {
          claim_id: "event-occurred",
          focus_id: "resolution-state",
          claim: "The event occurred before the deadline.",
          stance: "supports_yes",
          strength: "strong",
          llr: 1,
          rationale: "This directly meets the resolution rule.",
          cluster_id: "event-occurrence",
          category: "resolution",
          resolution_relevance: "direct",
          cross_check_status: "confirmed",
          selection_rationale: "An official filing and an independent registry are the strongest available records.",
          sources: [
            {
              url: "https://issuer.example/filing",
              title: "Official filing",
              source_type: "official",
              credibility: "high",
              relation: "supports",
              support_quality: "direct",
              is_primary: true,
              independence_group: "issuer"
            },
            {
              url: "https://registry.example/event",
              title: "Registry event record",
              source_type: "data",
              credibility: "high",
              relation: "supports",
              support_quality: "direct",
              is_primary: true,
              independence_group: "registry"
            }
          ]
        }
      ],
      reflection: [],
      confidence: "high",
      found_new_information: true,
      notes: ""
    };
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> =>
      prompt.includes("compiling a decision-first forecasting report")
        ? agentResult(summaryOut)
        : agentResult(claimRound, ["https://issuer.example/filing", "https://registry.example/event"]);

    const final = await runForecast(state, { maxRounds: 1, runAgentFn: fakeAgent });
    expect(final.evidenceLedger).toHaveLength(1);
    expect(final.roundHistory[0].perSourceUpdates).toHaveLength(1);
    expect(final.roundHistory[0].newClaimCount).toBe(1);
    expect(final.roundHistory[0].newSourceCount).toBe(2);
    expect(final.evidenceLedger[0].crossCheckStatus).toBe("confirmed");
    expect(final.evidenceLedger[0].sources).toHaveLength(2);
  });

  it("two-round run: converges, persists state.json, ledger carries sourceType/credibility", async () => {
    const state = newForecastState({ eventId: "evt-loop", eventText: "t", framing: framing(0.5) });
    let round = 0;
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> => {
      if (prompt.includes("compiling a decision-first forecasting report")) return agentResult(summaryOut);
      round++;
      if (round === 1)
        return agentResult(
          roundOut([
            evidence("https://a.com/1", 0.8, { source_type: "official", credibility: "high" }),
            evidence("https://b.com/2", 0.4)
          ]),
          ["https://a.com/1", "https://b.com/2"]
        );
      // round 2: a negligible move => convergence stop
      return agentResult(roundOut([evidence("https://c.com/3", 0.005)]), ["https://c.com/3"]);
    };

    const final = await runForecast(state, { maxRounds: 5, runAgentFn: fakeAgent });
    expect(final.status).toBe("converged");
    expect(final.round).toBe(2);
    expect(final.roundHistory).toHaveLength(2);
    expect(final.evidenceLedger).toHaveLength(3);
    expect(final.evidenceLedger[0].sourceType).toBe("official");
    expect(final.evidenceLedger[0].credibility).toBe("high");
    expect(final.evidenceLedger[1].sourceType).toBe("press"); // defaulted by the validator
    expect(final.evidenceLedger[1].credibility).toBe("medium");
    expect(final.currentProb).toBeGreaterThan(0.5);
    expect(final.summary?.whySentence).toBe("The decisive filing pushed it up.");
    expect(final.summary?.quip).toBe("Markets hate suspense.");

    const file = path.join(tmpRoot, "forecasts", "evt-loop", "state.json");
    expect(existsSync(file)).toBe(true);
    const onDisk = JSON.parse(readFileSync(file, "utf8"));
    expect(onDisk.currentProb).toBeCloseTo(final.currentProb, 9);
    expect(onDisk.evidenceLedger[0].sourceType).toBe("official");
  });

  it("minRounds: a net-zero round 1 does not converge before the disconfirmation round has run", async () => {
    const state = newForecastState({ eventId: "evt-minrounds", eventText: "t", framing: framing(0.5) });
    let round = 0;
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> => {
      if (prompt.includes("compiling a decision-first forecasting report")) return agentResult(summaryOut);
      round++;
      if (round === 1)
        // offsetting evidence: net move ~0pp — would converge under minRounds 1
        return agentResult(
          roundOut([evidence("https://a.com/1", 0.4), evidence("https://b.com/2", -0.4, { stance: "supports_no" })]),
          ["https://a.com/1", "https://b.com/2"]
        );
      return agentResult(roundOut([evidence("https://c.com/3", 0.9)]), ["https://c.com/3"]);
    };

    const final = await runForecast(state, { maxRounds: 3, minRounds: 2, runAgentFn: fakeAgent });
    expect(final.round).toBeGreaterThanOrEqual(2); // round 2 ran despite the balanced round 1
    expect(final.currentProb).toBeGreaterThan(0.5); // round 2's evidence landed
  });

  it("analyst notes are injected into the round prompt and stamped consumed", async () => {
    const state = newForecastState({ eventId: "evt-analyst", eventText: "t", framing: framing(0.5) });
    saveAnalyst("evt-analyst", {
      notes: [
        {
          id: "note-1",
          text: "look into the union vote",
          stance: "question",
          targetId: null,
          createdAtUtc: "2026-01-01T00:00:00Z",
          consumedRound: null
        }
      ],
      marks: { "led-x": "doubt" }
    });
    const prompts: string[] = [];
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> => {
      if (prompt.includes("compiling a decision-first forecasting report")) return agentResult(summaryOut);
      prompts.push(prompt);
      return agentResult(roundOut([evidence("https://d.com/4", 0.5)]), ["https://d.com/4"]);
    };

    const final = await runForecast(state, { maxRounds: 1, runAgentFn: fakeAgent });
    expect(prompts[0]).toContain("ANALYST INPUT");
    expect(prompts[0]).toContain("[OPEN QUESTION] look into the union vote");

    const after = loadAnalyst("evt-analyst");
    expect(after.notes[0].consumedRound).toBe(1);
    expect(final.roundHistory[0].analystConsumedIds).toContain("note-1");
  });

  it("doubt marks inject once: stamped in doubtsHandled, absent from later prompts", async () => {
    const state = newForecastState({ eventId: "evt-doubt", eventText: "t", framing: framing(0.5) });
    // Seed a prior-round ledger entry the analyst can doubt.
    state.evidenceLedger.push({
      id: "led-1",
      url: "https://prior.com/story",
      urlCanonical: "prior.com/story",
      title: "Prior story",
      claim: "prior claim",
      stance: "supports_yes",
      strength: "moderate",
      kind: "evidence",
      clusterId: "c",
      clusterFactor: 1,
      effectiveLlr: 0.5,
      probBefore: 0.5,
      probAfter: 0.6,
      deltaPp: 10,
      rationale: "r",
      retrievedAtUtc: "2026-01-01T00:00:00Z",
      firstSeenRound: 1,
      verifiedInSearchTrace: true,
      sourceType: "press",
      credibility: "medium"
    });
    state.round = 1;
    state.currentProb = 0.6;
    saveAnalyst("evt-doubt", { notes: [], marks: { "led-1": "doubt" } });

    const prompts: string[] = [];
    let n = 0;
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> => {
      if (prompt.includes("compiling a decision-first forecasting report")) return agentResult(summaryOut);
      prompts.push(prompt);
      n++;
      return agentResult(roundOut([evidence(`https://r${n}.com/x`, 0.6)]), [`https://r${n}.com/x`]);
    };

    await runForecast(state, { maxRounds: 3, runAgentFn: fakeAgent });
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    expect(prompts[0]).toContain("The analyst DOUBTS these prior sources");
    expect(prompts[1]).not.toContain("The analyst DOUBTS these prior sources");
    const after = loadAnalyst("evt-doubt");
    expect(after.marks["led-1"]).toBe("doubt"); // the UI mark survives
    expect(after.doubtsHandled?.["led-1"]).toBe(2); // stamped with the round that injected it
  });

  it("an interrupted final budget round resumes as incomplete with no final summary", async () => {
    const state = newForecastState({ eventId: "evt-resume", eventText: "t", framing: framing(0.5) });
    let calls = 0;
    const fakeAgent = async (prompt: string): Promise<AgentRunResult> => {
      if (prompt.includes("compiling a decision-first forecasting report")) return agentResult(summaryOut);
      calls++;
      return agentResult(roundOut([evidence(`https://s${calls}.com/x`, 0.6)]), [`https://s${calls}.com/x`]);
    };
    const done = await runForecast(state, { maxRounds: 1, runAgentFn: fakeAgent });
    expect(done.status).toBe("max_rounds");
    const summaryBefore = done.summary;

    // A hard interruption after round persistence can leave open at the budget.
    done.status = "open";
    const boom = async (): Promise<AgentRunResult> => {
      throw new Error("no model call should happen on a no-op resume");
    };
    const resumed = await runForecast(done, { maxRounds: 1, runAgentFn: boom });
    expect(resumed.status).toBe("max_rounds");
    expect(resumed.summary).toEqual(summaryBefore);
  });
});

describe("validateSummary new display fields", () => {
  it("maps why_sentence/quip/confidence_reason", () => {
    const s = validateSummary({
      verdict: "v",
      why_sentence: "Because the filing landed.",
      quip: "Dry aside.",
      confidence_reason: "Two independent sources agree."
    });
    expect(s.whySentence).toBe("Because the filing landed.");
    expect(s.quip).toBe("Dry aside.");
    expect(s.confidenceReason).toBe("Two independent sources agree.");
  });
  it("defaults them to undefined and never throws on bad values", () => {
    const s = validateSummary({ verdict: "v" });
    expect(s.whySentence).toBeUndefined();
    expect(s.quip).toBeUndefined();
    expect(s.confidenceReason).toBeUndefined();
    const bad = validateSummary({ verdict: "v", why_sentence: 42, quip: null, confidence_reason: "" });
    expect(bad.whySentence).toBeUndefined();
    expect(bad.quip).toBeUndefined();
    expect(bad.confidenceReason).toBeUndefined();
  });
});
