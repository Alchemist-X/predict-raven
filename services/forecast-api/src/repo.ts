// Filesystem bridge to the forecast engine's on-disk artifacts
// (runtime-artifacts/forecasts/<eventId>/). Path + id logic mirrors
// scripts/forecast/store.ts exactly — the engine CLI runs as a child process
// with cwd = repo root, so both sides must resolve the same directories.
// (Same proven pattern as apps/raven/lib/server/repo.ts.)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { ForecastState } from "@autopoly/forecast-engine/types";
import { isStructuredForecast, type AnyForecastState } from "@autopoly/forecast-engine/answer-types";

export type { ForecastState, AnyForecastState };

export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function forecastsRoot(): string {
  return process.env.ARTIFACT_STORAGE_ROOT
    ? path.join(process.env.ARTIFACT_STORAGE_ROOT, "forecasts")
    : path.join(repoRoot(), "runtime-artifacts", "forecasts");
}

// Must stay byte-identical to scripts/forecast/store.ts makeEventId — the API
// computes the id before spawning the CLI, which recomputes it from the same
// question string.
export { makeEventId } from "@autopoly/forecast-engine/store";

export function isSafeEventId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);
}

export function eventDir(eventId: string): string {
  return path.join(forecastsRoot(), eventId);
}

export function statePath(eventId: string): string {
  return path.join(eventDir(eventId), "state.json");
}

export function loadState(eventId: string): ForecastState | null {
  const state = loadAnyState(eventId);
  return state && !isStructuredForecast(state) ? state : null;
}

export function loadAnyState(eventId: string): AnyForecastState | null {
  const file = statePath(eventId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AnyForecastState;
  } catch {
    return null;
  }
}

export function stateMtimeMs(eventId: string): number | null {
  const file = statePath(eventId);
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export function listStates(): ForecastState[] {
  return listAnyStates().filter((state): state is ForecastState => !isStructuredForecast(state));
}

export function listAnyStates(): AnyForecastState[] {
  const root = forecastsRoot();
  if (!existsSync(root)) return [];
  const out: AnyForecastState[] = [];
  for (const id of readdirSync(root)) {
    const state = loadAnyState(id);
    if (state && state.eventId) out.push(state);
  }
  out.sort((a, b) => String(b.updatedAtUtc ?? "").localeCompare(String(a.updatedAtUtc ?? "")));
  return out;
}

// Parse a dotenv-style file (KEY=VALUE lines) without adding a dependency.
export function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !line.trim().startsWith("#")) out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return out;
}
