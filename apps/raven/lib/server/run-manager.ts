// Spawns and tracks forecast engine runs (tsx scripts/forecast/cli.ts) as
// child processes (spawn engine CLI + poll state.json; the standalone viewer
// prototype that pioneered this pattern was removed 2026-07-03)
// server.ts. Jobs live on globalThis so Next dev-server HMR doesn't lose them;
// the engine's own state.json (written after every round) is the durable feed.

import { spawn } from "node:child_process";
import type { AnswerRequest } from "@autopoly/forecast-engine/answer-types";
import path from "node:path";
import { QuotaExceededError, tryConsumeQuota } from "./quota";
import { loadAnyState, makeEventId, readEnvFile, repoRoot } from "./repo";

import { finishedJobStatus, type IncompleteStatus } from "../vm/forecast-status";
import { MaxRoundsSchema } from "./answer-request";

export type JobStatus = "running" | "done" | "error" | "unforecastable" | IncompleteStatus;

export interface Job {
  eventId: string;
  question: string;
  status: JobStatus;
  code: number | null;
  log: string[];
  startedAtUtc: string;
  maxRounds: number;
  provider: string;
}

const globalJobs = globalThis as unknown as { __ravenJobs?: Map<string, Job> };
const jobs: Map<string, Job> = globalJobs.__ravenJobs ?? new Map();
globalJobs.__ravenJobs = jobs;

export function getJob(eventId: string): Job | null {
  return jobs.get(eventId) ?? null;
}

// Build the child env: process env, backfilled from the repo-root .env.deepseek
// (gitignored, local testing only) so `pnpm --filter @autopoly/raven dev` works
// without exporting keys by hand. Secrets never touch the client or the repo.
function buildEnv(provider: string, language?: string): NodeJS.ProcessEnv {
  const fromFile = readEnvFile(path.join(repoRoot(), ".env.deepseek"));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(fromFile)) {
    if (!env[k]) env[k] = v;
  }
  env.FORECAST_PROVIDER = provider;
  // Per-run output language for the engine's user-facing prose (opt-in "zh";
  // absent = English, so trading-pipeline callers are untouched).
  if (language === "zh") env.FORECAST_LANGUAGE = "zh";
  // App runs favor richer dossiers: a balanced round 1 (net ~0pp) must not
  // count as convergence before the round-2 disconfirmation pass has run.
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

export function providerKeyAvailable(provider: string): boolean {
  const env = buildEnv(provider);
  if (provider === "deepseek") return Boolean(env.DEEPSEEK_API_KEY);
  // The claude provider has three auth paths (ANTHROPIC_API_KEY, subscription
  // CLAUDE_CODE_OAUTH_TOKEN, or the CLI's stored login) — the last one is not
  // detectable from env, so never block here; an unauthenticated CLI surfaces
  // its own clear error in the job log.
  return true;
}

export interface StartOptions {
  answerRequest?: AnswerRequest;
  maxRounds?: number;
  fresh?: boolean;
  provider?: string;
  // Daily-quota gate: consumed only on an actual spawn (reattach paths are
  // free). authorizeBypass is called lazily — only when the free quota is
  // exhausted — so an invite code is validated AND metered exactly when it
  // unlocks a run, never while free quota remains.
  quota?: { service: string; limit: number; authorizeBypass?: () => boolean };
  language?: "en" | "zh";
}

// An "open" state whose file changed recently means an engine process is (very
// likely) still writing it — e.g. one that survived a dev-server restart that
// wiped the in-memory jobs map. Spawning a second engine on the same event dir
// would interleave state writes and double LLM spend.
const ORPHAN_RUN_FRESH_MS = 10 * 60_000;

export function startForecast(question: string, opts: StartOptions = {}): Job {
  MaxRoundsSchema.parse(opts.maxRounds);
  const eventId = makeEventId(question, opts.answerRequest);
  const existing = jobs.get(eventId);
  if (existing && existing.status === "running") return existing;

  const onDisk = loadAnyState(eventId);
  if (!opts.fresh && onDisk?.status === "open" && Date.now() - Date.parse(onDisk.updatedAtUtc) < ORPHAN_RUN_FRESH_MS) {
    return {
      eventId,
      question,
      status: "running",
      code: null,
      log: ["an engine process for this event appears to be running already — reattached instead of respawning"],
      startedAtUtc: onDisk.createdAtUtc,
      maxRounds: MaxRoundsSchema.parse(opts.maxRounds),
      provider: (onDisk as { provider?: string }).provider ?? pickProvider(opts.provider)
    };
  }

  // Last gate before money is spent — after every no-spawn shortcut above.
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
    maxRounds,
    provider
  };
  jobs.set(eventId, job);

  const child = spawn(path.join(root, "node_modules/.bin/tsx"), args, {
    cwd: root,
    env: buildEnv(provider, opts.language)
  });
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
  });
  child.on("close", (code) => {
    job.code = code;
    const saved = loadAnyState(eventId);
    const currentStatus =
      saved && Date.parse(saved.updatedAtUtc) >= Date.parse(job.startedAtUtc) ? saved.status : undefined;
    job.status = finishedJobStatus(currentStatus, code);
  });
  return job;
}
