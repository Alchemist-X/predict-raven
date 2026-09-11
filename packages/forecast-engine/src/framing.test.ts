import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "./claude-agent";

const agent = vi.hoisted(() => ({ runAgent: vi.fn(), providerHasWebSearch: vi.fn() }));
vi.mock("./agent", () => agent);
import { frameEvent } from "./framing";

const PINNED = "截至2027-03-06，Meta正式下调资本开支计划。下一财年首次公布的预算N低于本年指引G或本年实际值A（N<G OR N<A）即满足条件。";
const EDITOR_DRIFT = "Only a midpoint decrease with no increase in the upper bound counts as YES.";
const AUDITOR_DRIFT = "A later revised budget N must be below actual spending A; the initial N does not count.";

function response(criteria: string, query: string, overrides: Record<string, unknown> = {}): AgentRunResult {
  const raw = {
    normalized_question: "Will Meta cut its capex plan by 2027-03-06?",
    resolution_criteria: criteria,
    resolution_date: "2027-03-06",
    settlement_source: "Meta official earnings releases",
    assumptions: "Use the user's specified fiscal-year scope.",
    forecastable: true,
    clarification_needed: "",
    prior_probability: 0.35,
    prior_rationale: "Historical guidance cuts among capital-intensive companies.",
    framing_caveats: "The two annual comparison branches require separate evidence.",
    framing_confidence: "high",
    ...overrides,
  };
  return { rawFinalText: JSON.stringify(raw), jsonObject: raw, jsonError: null, searchQueries: [query],
    searchResultUrls: new Set(), costUsd: 0.01, numTurns: 1, exitCode: 0, stderrTail: "" };
}

beforeEach(() => {
  agent.runAgent.mockReset();
  agent.providerHasWebSearch.mockReset().mockReturnValue(false);
  vi.stubEnv("FORECAST_MARKET_BLIND", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("user-specified resolution through frameEvent", () => {
  it("pins the original rules before audit and after editor/auditor attempts to change them", async () => {
    agent.runAgent.mockResolvedValueOnce(response(EDITOR_DRIFT, "editor"))
      .mockResolvedValueOnce(response(AUDITOR_DRIFT, "audit"));

    const out = await frameEvent("Meta capex over six months", { userResolution: `  ${PINNED}\n`, model: "test-model" });

    expect(out.framing.resolutionCriteria).toBe(PINNED);
    expect(out.framing.framingCaveats).toContain("separate evidence");
    expect(out.framing.priorProbability).toBe(0.35);
    expect(out.searchQueries).toEqual(["editor", "audit"]);
    expect(out.costUsd).toBeCloseTo(0.02);
    expect(agent.runAgent).toHaveBeenCalledTimes(2);
    for (const [prompt, options] of agent.runAgent.mock.calls) {
      expect(prompt).toContain("USER-SPECIFIED RESOLUTION (authoritative");
      expect(prompt).toContain(PINNED);
      expect(prompt).toContain("Copy it verbatim into resolution_criteria");
      expect(options).toEqual({ model: "test-model" });
    }
    const auditPrompt = agent.runAgent.mock.calls[1][0];
    expect(auditPrompt).toContain(`- resolution_criteria: ${PINNED}`);
    expect(auditPrompt).not.toContain(EDITOR_DRIFT);
    expect(auditPrompt).toContain("report them in framing_caveats without changing the rules");
  });

  it.each([false, true])("preserves the first N and OR rule during market-blind re-audit (still contaminated: %s)", async (contaminated) => {
    vi.stubEnv("FORECAST_MARKET_BLIND", "1");
    agent.runAgent.mockResolvedValueOnce(response(EDITOR_DRIFT, "editor"))
      .mockResolvedValueOnce(response(AUDITOR_DRIFT, "audit", { prior_rationale: "Polymarket trades at 70%." }))
      .mockResolvedValueOnce(response(AUDITOR_DRIFT, "re-audit", {
        prior_rationale: contaminated ? "Polymarket trades at 70%." : "Historical capex guidance revisions imply a 35% base rate.",
      }));

    const out = await frameEvent("Meta capex over six months", { userResolution: PINNED });

    expect(out.framing.resolutionCriteria).toBe(PINNED);
    expect(out.priorSuspect).toBe(contaminated);
    expect(out.searchQueries).toEqual(["editor", "audit", "re-audit"]);
    expect(out.costUsd).toBeCloseTo(0.03);
    expect(agent.runAgent).toHaveBeenCalledTimes(3);
    const prompt = agent.runAgent.mock.calls[2][0];
    expect(prompt).toContain("VIOLATION NOTICE");
    expect(prompt).toContain("USER-SPECIFIED RESOLUTION (authoritative");
    expect(prompt).toContain(`- resolution_criteria: ${PINNED}`);
    expect(prompt).toContain("report them in framing_caveats without changing the rules");
    expect(prompt).not.toContain(EDITOR_DRIFT);
  });

  it("retains the pin when malformed model output requires a validation retry", async () => {
    agent.runAgent.mockResolvedValueOnce(response(EDITOR_DRIFT, "invalid", { forecastable: "yes" }))
      .mockResolvedValueOnce(response(EDITOR_DRIFT, "editor retry"))
      .mockResolvedValueOnce(response(AUDITOR_DRIFT, "audit"));

    const out = await frameEvent("Meta capex", { userResolution: PINNED });

    expect(out.framing.resolutionCriteria).toBe(PINNED);
    expect(agent.runAgent).toHaveBeenCalledTimes(3);
    expect(agent.runAgent.mock.calls[0][0]).toBe(agent.runAgent.mock.calls[1][0]);
    expect(agent.runAgent.mock.calls[2][0]).toContain(`- resolution_criteria: ${PINNED}`);
  });

  it.each([undefined, null, "", "  \n"])("keeps independent audit corrections when no resolution is pinned (%s)", async (userResolution) => {
    agent.runAgent.mockResolvedValueOnce(response("Editor rules", "editor"))
      .mockResolvedValueOnce(response("Corrected audit rules", "audit"));

    const out = await frameEvent("A rough event", { userResolution });

    expect(out.framing.resolutionCriteria).toBe("Corrected audit rules");
    expect(agent.runAgent).toHaveBeenCalledTimes(2);
    const prompt = agent.runAgent.mock.calls[1][0];
    expect(prompt).toContain("Re-derive the frame independently");
    expect(prompt).toContain("fix it and say so in framing_caveats");
    expect(prompt).not.toContain("USER-SPECIFIED RESOLUTION");
  });
});
