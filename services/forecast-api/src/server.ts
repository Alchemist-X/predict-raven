// The HTTP surface (raw node:http — no framework, matching the minimal
// scripts/forecast/viewer/server.ts precedent):
//
//   GET  /healthz                      liveness (no auth)
//   POST /v1/forecasts                 start/resume a forecast ({question, maxRounds?, fresh?, provider?, wait?})
//   GET  /v1/forecasts                 list forecasts
//   GET  /v1/forecasts/:id             answer as JSON (probability + analysis + evidence)
//   GET  /v1/forecasts/:id/text        answer as plain text
//   GET  /v1/forecasts/:id/pdf         answer as a PDF dossier
//   POST /mcp                          MCP streamable-HTTP endpoint (stateless)
//   GET  /paper/snapshot               paper-agent book snapshot (token OR invite code)
//   GET  /paper/cases                  biggest winners/losers + research trail (same auth)
//
// Every /v1 + /mcp route is token-gated (Authorization: Bearer, x-api-key, or ?token=).

import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { buildAnswer } from "./answer";
import { AnswerRequestSchema } from "./answer-request";
import { isAuthorized } from "./auth";
import type { ServiceConfig } from "./config";
import { getDeltaPmAudit, getDeltaPmReflection } from "./delta-pm-audit";
import { authorizeInviteUse, describeInviteState, inviteState } from "./invites";
import { log } from "./log";
import { handleMcpRequest } from "./mcp";
import { getPaperCases, getPaperSnapshot } from "./paper-snapshot";
import { ensurePdf } from "./pdf";
import { QuotaExceededError } from "./quota";
import { renderHtml } from "./render-html";
import { renderText } from "./render-text";
import { isSafeEventId, listAnyStates, loadAnyState, makeEventId, stateMtimeMs } from "./repo";
import { getJob, RunLimitError, startForecast } from "./run-manager";

const MAX_BODY_BYTES = 64 * 1024;

const StartBody = z.object({
  answerRequest: AnswerRequestSchema.optional(),
  question: z.string().trim().min(8).max(400),
  maxRounds: z.number().int().min(1).max(6).optional(),
  fresh: z.boolean().optional(),
  provider: z.enum(["claude", "deepseek"]).optional(),
  wait: z.boolean().optional(),
  invite: z.string().optional()
});

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Block until the run leaves "running" (or the deadline passes) by watching
// the job map + on-disk state; used by POST ?wait=true so curl users get the
// finished answer in one call.
async function waitForCompletion(eventId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = getJob(eventId);
    const state = loadAnyState(eventId);
    const running = job?.status === "running" || (!job && state?.status === "open");
    if (!running && (state || job)) return;
    await sleep(2000);
  }
}

function baseUrlFor(req: IncomingMessage, config: ServiceConfig): string {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const host = req.headers.host ?? `127.0.0.1:${config.port}`;
  return `http://${host}`;
}

function applyCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, x-api-key, content-type, mcp-session-id, mcp-protocol-version"
  );
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

async function handleStart(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServiceConfig,
  body: unknown
): Promise<void> {
  const parsed = StartBody.safeParse(body);
  if (!parsed.success) {
    sendJson(res, 400, {
      error: "invalid request",
      detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      expected: {
        question: "string (8-400 chars)",
        maxRounds: "1-6 optional",
        fresh: "boolean optional",
        wait: "boolean optional"
      }
    });
    return;
  }
  const { question, maxRounds, fresh, provider, wait, invite, answerRequest } = parsed.data;
  const headerInvite = req.headers["x-invite-code"];
  // Prefer a non-empty body field, else the header — an empty body value must
  // not mask a valid header.
  const presentedInvite = invite?.trim() || (typeof headerInvite === "string" ? headerInvite.trim() : "");
  let job;
  try {
    job = startForecast(question, {
      answerRequest,
      maxRounds,
      fresh,
      provider,
      maxConcurrent: config.maxConcurrentRuns,
      quota: {
        service: "forecast-api",
        limit: config.dailyQuota,
        authorizeBypass: presentedInvite
          ? () => authorizeInviteUse(presentedInvite, "forecast-api", makeEventId(question, answerRequest))
          : undefined
      }
    });
  } catch (error) {
    if (error instanceof RunLimitError) {
      sendJson(res, 429, { error: error.message });
      return;
    }
    if (error instanceof QuotaExceededError) {
      sendJson(res, 429, {
        error: presentedInvite ? describeInviteState(inviteState(presentedInvite)) : error.message,
        hint: 'resend with the invite code: header "x-invite-code: <code>" or "invite" in the JSON body'
      });
      return;
    }
    throw error;
  }
  if (wait) await waitForCompletion(job.eventId, config.waitTimeoutMs);
  const state = loadAnyState(job.eventId);
  const answer = buildAnswer(
    job.eventId,
    state,
    getJob(job.eventId) ?? job,
    baseUrlFor(req, config),
    stateMtimeMs(job.eventId)
  );
  sendJson(res, answer.status === "running" ? 202 : 200, { forecast: answer });
}

function handleList(req: IncomingMessage, res: ServerResponse, config: ServiceConfig): void {
  const base = baseUrlFor(req, config);
  const all = listAnyStates();
  const runs = all.slice(0, 100).map((state) => {
    const answer = buildAnswer(state.eventId, state, getJob(state.eventId), base, stateMtimeMs(state.eventId));
    return {
      id: answer.id,
      question: answer.normalizedQuestion ?? answer.question,
      status: answer.status,
      answerType: answer.answerType,
      answer: answer.answer,
      answerLabel: answer.answerLabel,
      probability: answer.probability,
      probabilityPct: answer.probabilityPct,
      verdict: answer.verdict,
      rounds: answer.rounds,
      updatedAtUtc: answer.updatedAtUtc,
      links: { json: answer.links.json }
    };
  });
  sendJson(res, 200, { runs, total: all.length });
}

async function handleGet(
  req: IncomingMessage,
  res: ServerResponse,
  config: ServiceConfig,
  id: string,
  format: "json" | "text" | "pdf"
): Promise<void> {
  if (!isSafeEventId(id)) {
    sendJson(res, 400, { error: "invalid forecast id" });
    return;
  }
  const state = loadAnyState(id);
  const job = getJob(id);
  if (!state && !job) {
    sendJson(res, 404, { error: `no forecast found for id ${id}` });
    return;
  }
  const answer = buildAnswer(id, state, job, baseUrlFor(req, config), stateMtimeMs(id));
  if (format === "json") {
    sendJson(res, 200, { forecast: answer });
    return;
  }
  if (format === "text") {
    sendText(res, 200, renderText(answer));
    return;
  }
  try {
    const pdfPath = await ensurePdf(id, renderHtml(answer));
    const { readFileSync } = await import("node:fs");
    const pdf = readFileSync(pdfPath);
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="forecast-${id}.pdf"`,
      "content-length": pdf.length
    });
    res.end(pdf);
  } catch (error) {
    log.error(`pdf render failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    sendJson(res, 500, { error: "pdf rendering failed — the text and json formats are still available" });
  }
}

// Never log credentials: ?token= is a supported auth path and error logs go
// to docker logs.
function redactUrl(url: string | undefined): string {
  return (url ?? "").replace(/([?&]token=)[^&]*/gi, "$1***");
}

export function createRequestHandler(config: ServiceConfig): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void route(req, res, config).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`unhandled: ${req.method} ${redactUrl(req.url)} — ${message}`);
      if (!res.headersSent) {
        sendJson(res, message.includes("too large") ? 413 : message.includes("JSON") ? 400 : 500, { error: message });
      } else {
        res.end();
      }
    });
  };
}

async function route(req: IncomingMessage, res: ServerResponse, config: ServiceConfig): Promise<void> {
  applyCors(res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, service: "forecast-api" });
    return;
  }
  if (url.pathname === "/" && method === "GET") {
    sendJson(res, 200, {
      service: "Raven Forecasting Engine API",
      usage: {
        start: "POST /v1/forecasts {question, maxRounds?, wait?} (Authorization: Bearer <token>)",
        answer: "GET /v1/forecasts/:id · /text · /pdf",
        mcp: "POST /mcp (streamable HTTP, same token)"
      }
    });
    return;
  }

  // Paper-book snapshot for the /live-predict-raven review page. Simulation
  // data only (no keys, no live-trading state); the page's invite code is
  // accepted as a lighter credential so the web app needs no extra secret.
  if (url.pathname === "/paper/snapshot" && method === "GET") {
    if (!isAuthorized(req, url, config.token) && !isAuthorized(req, url, config.inviteCode)) {
      sendJson(res, 401, {
        error: "unauthorized — provide the access token or invite code (Authorization: Bearer, x-api-key, or ?token=)"
      });
      return;
    }
    const snapshot = getPaperSnapshot();
    // A zeroed book means the artifacts are missing/moved (root misconfig,
    // volume remount) — surface a real error instead of a plausible-looking
    // empty payload that consumers would render as "the fund went to zero".
    if (!(snapshot.bankrollUsd > 0)) {
      sendJson(res, 503, { error: "paper book not found on this host — check ARTIFACT_STORAGE_ROOT / volume mounts" });
      return;
    }
    sendJson(res, 200, snapshot);
    return;
  }

  // Delta PM audit chain for the /live-delta-pm review page: per-news IC-memo
  // cases (news → analyst thesis → market check → PM arithmetic → guards →
  // execution). Simulation data only; same credential rules as /paper/snapshot.
  if (url.pathname === "/delta-pm/audit" && method === "GET") {
    if (!isAuthorized(req, url, config.token) && !isAuthorized(req, url, config.inviteCode)) {
      sendJson(res, 401, {
        error: "unauthorized — provide the access token or invite code (Authorization: Bearer, x-api-key, or ?token=)"
      });
      return;
    }
    const requestedLimit = Number(url.searchParams.get("limit") ?? "30");
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 100 ? requestedLimit : 30;
    const audit = getDeltaPmAudit(limit);
    if (!audit) {
      sendJson(res, 503, {
        error: "delta-pm book not found on this host — check ARTIFACT_STORAGE_ROOT / volume mounts"
      });
      return;
    }
    sendJson(res, 200, audit);
    return;
  }

  // Latest Delta PM daily calibration report — same credentials as the audit.
  if (url.pathname === "/delta-pm/reflection" && method === "GET") {
    if (!isAuthorized(req, url, config.token) && !isAuthorized(req, url, config.inviteCode)) {
      sendJson(res, 401, {
        error: "unauthorized — provide the access token or invite code (Authorization: Bearer, x-api-key, or ?token=)"
      });
      return;
    }
    const reflection = getDeltaPmReflection();
    if (!reflection) {
      sendJson(res, 503, { error: "no delta-pm reflection report yet" });
      return;
    }
    sendJson(res, 200, reflection);
    return;
  }

  // Case walk-throughs for the same review page: biggest winners/losers with
  // their engine dossier and decision timeline. Same credential rules as the
  // snapshot (simulation data only), same 503 when the book is missing.
  if (url.pathname === "/paper/cases" && method === "GET") {
    if (!isAuthorized(req, url, config.token) && !isAuthorized(req, url, config.inviteCode)) {
      sendJson(res, 401, {
        error: "unauthorized — provide the access token or invite code (Authorization: Bearer, x-api-key, or ?token=)"
      });
      return;
    }
    const requested = Number(url.searchParams.get("perBucket") ?? "2");
    const perBucket = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : 2;
    const cases = getPaperCases(perBucket);
    if (cases.winners.length === 0 && cases.losers.length === 0) {
      sendJson(res, 503, { error: "paper book not found on this host — check ARTIFACT_STORAGE_ROOT / volume mounts" });
      return;
    }
    sendJson(res, 200, cases);
    return;
  }

  if (!isAuthorized(req, url, config.token)) {
    sendJson(res, 401, {
      error: "unauthorized — provide the access token (Authorization: Bearer, x-api-key, or ?token=)"
    });
    return;
  }

  if (url.pathname === "/mcp") {
    if (method === "POST") {
      const body = await readBody(req);
      await handleMcpRequest(req, res, body, config);
      return;
    }
    // Stateless mode: no SSE stream to resume, no session to delete.
    sendJson(res, 405, { error: "method not allowed — this MCP endpoint is stateless; use POST" });
    return;
  }

  if (url.pathname === "/v1/forecasts" && method === "POST") {
    await handleStart(req, res, config, await readBody(req));
    return;
  }
  if (url.pathname === "/v1/forecasts" && method === "GET") {
    handleList(req, res, config);
    return;
  }
  const match = url.pathname.match(/^\/v1\/forecasts\/([^/]+)(?:\/(text|pdf))?$/);
  if (match && match[1] && method === "GET") {
    const format = match[2] === "text" ? "text" : match[2] === "pdf" ? "pdf" : "json";
    await handleGet(req, res, config, match[1], format);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}
