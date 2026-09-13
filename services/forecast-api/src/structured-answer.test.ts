import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAnswer } from "./answer";
import { AnswerRequestSchema } from "./answer-request";
import { AnswerRequestSchema as RavenRequestSchema } from "../../../apps/raven/lib/server/answer-request";
import { adaptState, listRuns } from "../../../apps/raven/lib/server/dossier";
import { loadState as ravenBinaryState, loadAnyState as ravenAnyState } from "../../../apps/raven/lib/server/repo";
import { renderHtml } from "./render-html";
import { renderText } from "./render-text";
import { loadState, loadAnyState, listStates, makeEventId } from "./repo";
import { structuredFixture } from "./structured-fixture";
import { createRequestHandler } from "./server";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function storeFixture(kind: Parameters<typeof structuredFixture>[0] = "independent_ranking") {
  const root = mkdtempSync(path.join(tmpdir(), "typed-consumers-"));
  dirs.push(root);
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", root);
  const state = structuredFixture(kind);
  const dir = path.join(root, "forecasts", state.eventId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
  return state;
}

describe("typed forecast consumers", () => {
  it.each(["categorical", "numeric", "independent_ranking"] as const)(
    "serves %s without a fake binary probability or full subscription body",
    (kind) => {
      const state = structuredFixture(kind);
      const result = buildAnswer(state.eventId, state, null, "http://localhost");
      expect(result.answer).toEqual(state.answer);
      expect(result.answerType).toBe(kind);
      expect(result.probability).toBeNull();
      expect(result.probabilityPct).toBeNull();
      const text = renderText(result);
      const html = renderHtml(result);
      for (const output of [text, html, JSON.stringify(result)]) {
        expect(output).not.toContain("NaN");
        expect(output).not.toContain("PRIVATE_FULL_BODY");
        expect(output).toContain("fixture-");
      }
      expect(text).not.toContain("P(YES)");
      expect(html).not.toContain("answer is YES");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(text).toContain("https://example.com/source");
      if (kind === "numeric") {
        expect(text).toContain("78 points");
        expect(text).not.toContain("78%");
      }
      if (kind === "independent_ranking") {
        expect(text).toContain("80.0%");
        expect(text).toContain("70.0%");
        expect(text).toContain("do not sum to 100%");
      }
    }
  );

  it("keeps typed states out of binary-only readers and provides a dedicated Raven view", () => {
    const state = storeFixture();
    expect(loadState(state.eventId)).toBeNull();
    expect(ravenBinaryState(state.eventId)).toBeNull();
    expect(listStates()).toEqual([]);
    expect(loadAnyState(state.eventId)).toEqual(state);
    expect(ravenAnyState(state.eventId)).toEqual(state);
    const dossier = adaptState(state, null);
    expect(dossier.currentProb).toBeNull();
    expect(dossier.priorProb).toBeNull();
    expect(dossier.iterations).toEqual([]);
    expect(dossier.structured?.answer).toEqual(state.answer);
    expect(dossier.structured?.evidence[0]?.quote).toContain("original excerpt");
    expect(JSON.stringify(dossier)).not.toContain("PRIVATE_FULL_BODY");
    expect(listRuns()[0]).toMatchObject({ answerType: "independent_ranking", prob: "Alpha · 80.0%" });
  });

  it("maintains request validation parity across HTTP and Raven and separates changed contracts", () => {
    const valid = { answerType: "numeric", unit: "points", minimum: 0, maximum: 100 };
    expect(AnswerRequestSchema.parse(valid)).toEqual(RavenRequestSchema.parse(valid));
    for (const invalid of [
      { answerType: "other" },
      { minimum: 20, maximum: 10 },
      { minimum: Infinity },
      {
        options: [
          { id: "a", label: "A" },
          { id: "a", label: "B" }
        ]
      },
      { answerType: "binary", unit: "points" },
      { unknown: true }
    ]) {
      expect(AnswerRequestSchema.safeParse(invalid).success).toBe(false);
      expect(RavenRequestSchema.safeParse(invalid).success).toBe(false);
    }
    const request = AnswerRequestSchema.parse(valid);
    expect(makeEventId("Synthetic question", request)).not.toBe(makeEventId("Synthetic question"));
    expect(makeEventId("Synthetic question", { answerType: "auto" })).toBe(makeEventId("Synthetic question"));
  });

  it("returns typed JSON, list and text through the real authenticated HTTP handler", async () => {
    const state = storeFixture("numeric");
    const server = createServer(
      createRequestHandler({
        port: 0,
        host: "127.0.0.1",
        token: "fixture-token",
        maxConcurrentRuns: 1,
        waitTimeoutMs: 100,
        publicBaseUrl: null,
        dailyQuota: 0,
        inviteCode: "fixture"
      })
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${addr.port}`;
    const headers = { authorization: "Bearer fixture-token" };
    try {
      const response = await fetch(`${base}/v1/forecasts/${state.eventId}`, { headers });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.forecast.answer.kind).toBe("numeric");
      expect(data.forecast.probability).toBeNull();
      const list = await (await fetch(`${base}/v1/forecasts`, { headers })).json();
      expect(list.forecasts?.[0]?.answerType ?? list.runs?.[0]?.answerType).toBe("numeric");
      const text = await (await fetch(`${base}/v1/forecasts/${state.eventId}/text`, { headers })).text();
      expect(text).toContain("78 points");
      expect(text).not.toContain("P(YES)");
      const invalid = await fetch(`${base}/v1/forecasts`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          question: "Synthetic question",
          answerRequest: { answerType: "numeric", minimum: 100, maximum: 0 }
        })
      });
      expect(invalid.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
