import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerRequest } from "@autopoly/forecast-engine/answer-types";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
import { startForecast as startApi } from "./run-manager";
import { startForecast as startRaven } from "../../../apps/raven/lib/server/run-manager";
import { makeEventId } from "./repo";
import { structuredFixture } from "./structured-fixture";
import { MaxRoundsSchema } from "./answer-request";
import { MaxRoundsSchema as RavenMaxRoundsSchema } from "../../../apps/raven/lib/server/answer-request";

afterEach(() => {
  vi.unstubAllEnvs();
  spawn.mockReset();
});

describe("typed request process boundary", () => {
  it.each([
    ["HTTP/MCP service", startApi],
    ["Raven", startRaven]
  ] as const)("%s passes the unchanged answer contract as one CLI argument", (_label, start) => {
    const root = mkdtempSync(path.join(tmpdir(), "typed-start-"));
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    spawn.mockReturnValue(child);
    const request: AnswerRequest = {
      answerType: "categorical",
      options: [
        { id: "a", label: "Alpha $(literal)" },
        { id: "b", label: "Beta" }
      ],
      resolution: "A literal multiline\nresolution"
    };
    const question = `Synthetic start ${_label}`;
    try {
      const job = start(question, { answerRequest: request, provider: "claude", maxRounds: 1 });
      expect(job.eventId).toBe(makeEventId(question, request));
      expect(spawn).toHaveBeenCalledTimes(1);
      const args = spawn.mock.calls[0]?.[1] as string[];
      const index = args.indexOf("--answer-request");
      expect(index).toBeGreaterThan(0);
      expect(JSON.parse(args[index + 1] ?? "")).toEqual(request);
      expect(spawn.mock.calls[0]?.[2]?.shell).toBeUndefined();
      child.emit("close", 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("explicit research budgets and terminal outcomes", () => {
  it("both request boundaries default to unlimited and accept explicit budgets above six", () => {
    for (const schema of [MaxRoundsSchema, RavenMaxRoundsSchema]) {
      expect(schema.parse(undefined)).toBe(0);
      expect(schema.parse(0)).toBe(0);
      expect(schema.parse(41)).toBe(41);
      for (const bad of [-1, 1.5, Infinity, NaN, "3"]) expect(schema.safeParse(bad).success).toBe(false);
    }
  });

  it.each([
    ["API", startApi],
    ["Raven", startRaven]
  ] as const)("%s preserves unlimited/default and explicit budgets across the CLI boundary", (label, start) => {
    const root = mkdtempSync(path.join(tmpdir(), "research-budget-"));
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
    try {
      for (const budget of [undefined, 0, 41]) {
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
        spawn.mockReturnValue(child);
        const job = start(`Budget fixture ${label} ${String(budget)}`, { provider: "claude", maxRounds: budget });
        const args = spawn.mock.calls.at(-1)?.[1] as string[];
        expect(args[args.indexOf("--max-rounds") + 1]).toBe(String(budget ?? 0));
        expect(job.maxRounds).toBe(budget ?? 0);
        child.emit("close", 0);
        expect(job.status).toBe("error"); // A clean exit without a saved result is not completion.
      }
      const calls = spawn.mock.calls.length;
      expect(() => start(`Bad budget ${label}`, { maxRounds: -1 })).toThrow();
      expect(spawn).toHaveBeenCalledTimes(calls);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["API", startApi],
    ["Raven", startRaven]
  ] as const)("%s reads the saved outcome instead of treating exit zero as done", (label, start) => {
    const root = mkdtempSync(path.join(tmpdir(), "research-outcome-"));
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
    try {
      for (const status of ["research_failed", "insufficient_evidence", "max_rounds", "converged"] as const) {
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
        spawn.mockReturnValue(child);
        const question = `Outcome fixture ${label} ${status}`;
        const job = start(question, { provider: "claude" });
        const directory = path.join(root, "forecasts", job.eventId);
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          path.join(directory, "state.json"),
          JSON.stringify({
            ...structuredFixture(),
            eventId: job.eventId,
            eventText: question,
            status,
            updatedAtUtc: new Date(Date.now() + 1000).toISOString()
          })
        );
        child.emit("close", 0);
        expect(job.status).toBe(status === "converged" ? "done" : status);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
