import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnswerRequest } from "@autopoly/forecast-engine/answer-types";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
import { startForecast as startApi } from "./run-manager";
import { startForecast as startRaven } from "../../../apps/raven/lib/server/run-manager";
import { makeEventId } from "./repo";

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
