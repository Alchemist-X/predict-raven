// Spawns and tracks forecast engine runs (tsx scripts/forecast/cli.ts) as
// child processes — the same proven seam apps/raven/lib/server/run-manager.ts
// uses. Jobs live in-process; the engine's own state.json (written after every
// round) is the durable feed, so a service restart only loses log tails.

import { spawn } from "node:child_process";
import type { AnswerRequest } from "@autopoly/forecast-engine/answer-types";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QuotaExceededError, tryConsumeQuota } from "./quota";
import { eventDir, loadAnyState, makeEventId, readEnvFile, repoRoot } from "./repo";

import { finishedJobStatus, type IncompleteStatus } from "./forecast-status";
import { MaxRoundsSchema } from "./answer-request";

export type JobStatus = "running" | "done" | "error" | "unforecastable" | IncompleteStatus;

export interface Job {
  eventId: string;
  question: string;
  status: JobStatus;
  code: number | null;
  log: string[];
  startedAtUtc: string;
  endedAtUtc: string | null;
  maxRounds: number;
  provider: string;
}

// Thrown instead of spawning when the service is already running its maximum
// number of engine processes. Reattach/idempotent paths never throw it.
export class RunLimitError extends Error {
  constructor(limit: number) {
    super(`concurrent-run limit reached (${limit}) — retry in a few minutes`);
    this.name = "RunLimitError";
  }
}

const jobs: Map<string, Job> = new Map();

export function getJob(eventId: string): Job | null {
  return jobs.get(eventId) ?? null;
}

export function runningJobCount(): number {
  let n = 0;
  for (const job of jobs.values()) {
    if (job.status === "running") n += 1;
  }
  return n;
}

// Build the child env: process env, backfilled from the repo-root .env.deepseek
// (gitignored, local testing only). Secrets never touch the repo.
function buildEnv(provider: string): NodeJS.ProcessEnv {
  const fromFile = readEnvFile(path.join(repoRoot(), ".env.deepseek"));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(fromFile)) {
    if (!env[k]) env[k] = v;
  }
  env.FORECAST_PROVIDER = provider;
  // A balanced round 1 (net ~0pp) must not count as convergence before the
  // round-2 disconfirmation pass has run.
  if (!env.FORECAST_MIN_ROUNDS) env.FORECAST_MIN_ROUNDS = "2";
  return env;
}

export function pickProvider(requested?: string): string {
  if (requested === "claude" || requested === "deepseek") return requested;
  if (process.env.FORECAST_PROVIDER) return process.env.FORECAST_PROVIDER;
  const fromFile = readEnvFile(path.join(repoRoot(), ".env.deepseek"));
  if (process.env.DEEPSEEK_API_KEY || fromFile.DEEPSEEK_API_KEY) return "deepseek";
  return "claude";
}

export interface StartOptions {
  answerRequest?: AnswerRequest;
  maxRounds?: number;
  fresh?: boolean;
  provider?: string;
  maxConcurrent?: number;
  // Daily-quota gate: consumed only on an actual spawn (reattach/idempotent
  // paths are free). authorizeBypass is called lazily — only when the free
  // quota is exhausted — so an invite code is validated AND metered exactly
  // when it unlocks a run, never while free quota remains.
  quota?: { service: string; limit: number; authorizeBypass?: () => boolean };
}

// An "open" state (or spawn lock) whose file changed recently means an engine
// process is (very likely) still writing it — possibly in the raven app
// container, which shares the artifacts volume but not this job map. Spawning
// a second engine on the same event dir would interleave state writes and
// double LLM spend.
const ORPHAN_RUN_FRESH_MS = 10 * 60_000;

// The state.json only appears after Round 0 framing (~a minute); the lock file
// covers that window so a restarted/parallel API can't double-spawn.
function lockPath(eventId: string): string {
  return path.join(eventDir(eventId), ".engine-lock");
}

function lockFreshAt(eventId: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(lockPath(eventId), "utf8")) as { startedAtUtc?: string };
    const started = raw.startedAtUtc ?? null;
    if (started && Date.now() - Date.parse(started) < ORPHAN_RUN_FRESH_MS) return started;
    return null;
  } catch {
    return null;
  }
}

function reattachedJob(eventId: string, question: string, startedAtUtc: string, opts: StartOptions): Job {
  return {
    eventId,
    question,
    status: "running",
    code: null,
    log: ["an engine process for this event appears to be running already — reattached instead of respawning"],
    startedAtUtc,
    endedAtUtc: null,
    maxRounds: MaxRoundsSchema.parse(opts.maxRounds),
    provider: pickProvider(opts.provider)
  };
}

export function startForecast(question: string, opts: StartOptions = {}): Job {
  MaxRoundsSchema.parse(opts.maxRounds);
  const eventId = makeEventId(question, opts.answerRequest);
  const existing = jobs.get(eventId);
  if (existing && existing.status === "running") return existing;

  if (!opts.fresh) {
    const onDisk = loadAnyState(eventId);
    if (onDisk?.status === "open" && Date.now() - Date.parse(onDisk.updatedAtUtc) < ORPHAN_RUN_FRESH_MS) {
      return {
        ...reattachedJob(eventId, question, onDisk.createdAtUtc, opts),
        provider: onDisk.provider ?? pickProvider(opts.provider)
      };
    }
    const lockStarted = lockFreshAt(eventId);
    if (lockStarted) return reattachedJob(eventId, question, lockStarted, opts);
  }

  if (opts.maxConcurrent && runningJobCount() >= opts.maxConcurrent) {
    throw new RunLimitError(opts.maxConcurrent);
  }
  // Last gate before money is spent — after every no-spawn shortcut above, so
  // a 429 for concurrency never burns a quota unit or an invite use.
  if (opts.quota && !tryConsumeQuota(opts.quota.service, opts.quota.limit)) {
    if (!(opts.quota.authorizeBypass?.() ?? false)) {
      throw new QuotaExceededError(opts.quota.limit);
    }
  }

  const provider = pickProvider(opts.provider);
  const maxRounds = MaxRoundsSchema.parse(opts.maxRounds);
  const root = repoRoot();
  const args = [path.join(root, "scripts/forecast/cli.ts"), question, "--max-rounds", String(maxRounds)];
  if (opts.fresh) args.push("--fresh");
  if (opts.answerRequest) args.push("--answer-request", JSON.stringify(opts.answerRequest));

  const job: Job = {
    eventId,
    question,
    status: "running",
    code: null,
    log: [],
    startedAtUtc: new Date().toISOString(),
    endedAtUtc: null,
    maxRounds,
    provider
  };
  jobs.set(eventId, job);
  try {
    mkdirSync(eventDir(eventId), { recursive: true });
    writeFileSync(lockPath(eventId), JSON.stringify({ pid: process.pid, startedAtUtc: job.startedAtUtc }), "utf8");
  } catch {
    // Lock is best-effort; the run must not fail because of it.
  }

  const child = spawn(path.join(root, "node_modules/.bin/tsx"), args, {
    cwd: root,
    env: buildEnv(provider)
  });
  const releaseLock = (): void => {
    if (existsSync(lockPath(eventId))) rmSync(lockPath(eventId), { force: true });
  };
  const onData = (buf: Buffer) => {
    for (const line of buf.toString().split("\n")) {
      const t = line.trim();
      if (t) {
        job.log.push(t);
        if (job.log.length > 80) job.log.shift();
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (err) => {
    job.log.push("spawn error: " + err.message);
    job.status = "error";
    job.endedAtUtc = new Date().toISOString();
    releaseLock();
  });
  child.on("close", (code) => {
    job.code = code;
    const saved = loadAnyState(eventId);
    const currentStatus =
      saved && Date.parse(saved.updatedAtUtc) >= Date.parse(job.startedAtUtc) ? saved.status : undefined;
    job.status = finishedJobStatus(currentStatus, code);
    job.endedAtUtc = new Date().toISOString();
    releaseLock();
  });
  return job;
}
