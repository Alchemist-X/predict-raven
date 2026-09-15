import { describe, expect, it } from "vitest";
import { buildPlanSteps, nextRoundFor, type BlockVM } from "./research-vm";
import { statusFor } from "../../lib/server/dossier";

const block = (n: number): BlockVM => ({
  n: String(n),
  reasoningId: `r${n}`,
  status: "done",
  span: "40% → 42%",
  move: "+2%",
  moveDir: "up",
  note: "fixture",
  evidence: [],
  reading: null,
  analystFolded: 0
});

describe("Raven progress without a default round budget", () => {
  it("announces observed rounds without inventing a fixed maximum", () => {
    const blocks = Array.from({ length: 8 }, (_, i) => block(i + 1));
    const steps = buildPlanSteps({
      framing: false,
      blocks,
      maxRounds: 0,
      running: true,
      complete: false,
      prior: "40%",
      locale: "en"
    });
    expect(steps.filter((step) => step.key.startsWith("round-"))).toHaveLength(8);
    expect(steps.find((step) => step.key === "round-8")?.state).toBe("active");
    expect(steps.at(-1)?.state).toBe("pending");
    expect(nextRoundFor(8, 0)).toBe(9);
    expect(nextRoundFor(8, 9)).toBe(9);
    expect(nextRoundFor(8, 8)).toBe(8);
    expect(JSON.stringify(steps)).not.toMatch(/Infinity|NaN/);
  });
  it("keeps an explicit three-round plan for the historical replay", () => {
    const steps = buildPlanSteps({
      framing: false,
      blocks: [block(1), block(2)],
      maxRounds: 3,
      running: true,
      complete: false,
      prior: "38%",
      locale: "zh"
    });
    expect(steps.filter((step) => step.key.startsWith("round-"))).toHaveLength(3);
    expect(steps.find((step) => step.key === "round-3")?.state).toBe("pending");
  });
  it.each(["research_failed", "insufficient_evidence", "max_rounds"] as const)(
    "does not present %s as completed research",
    (status) => {
      expect(statusFor({ status })).toBe(status);
      const steps = buildPlanSteps({
        framing: false,
        blocks: [],
        maxRounds: 0,
        running: false,
        complete: false,
        prior: "40%",
        locale: "zh"
      });
      expect(steps.filter((step) => step.key.startsWith("round-"))).toEqual([]);
      expect(steps.at(-1)?.state).toBe("pending");
    }
  );
});
