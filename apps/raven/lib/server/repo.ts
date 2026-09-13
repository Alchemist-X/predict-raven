// Filesystem bridge between the Next.js app and the forecast engine's on-disk
// artifacts (runtime-artifacts/forecasts/<eventId>/). Path logic mirrors
// packages/forecast-engine/src/store.ts — the engine CLI runs as a child
// process with cwd = repo root, so both sides must resolve the same
// directories.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ForecastState } from "@autopoly/forecast-engine/types";
import { isStructuredForecast, type AnyForecastState } from "@autopoly/forecast-engine/answer-types";

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

// Intentional cwd-compensating reimplementation — do NOT replace with the
// engine's store.forecastsRoot: the engine resolves from process.cwd(), which
// under Next dev is not the repo root, so this walks up to the workspace root
// first (see repoRoot above).
export function forecastsRoot(): string {
  return process.env.ARTIFACT_STORAGE_ROOT
    ? path.join(process.env.ARTIFACT_STORAGE_ROOT, "forecasts")
    : path.join(repoRoot(), "runtime-artifacts", "forecasts");
}

// The event id must stay byte-identical between the API (computes it before
// spawning the CLI) and the engine (recomputes it from the same question
// string). Importing the engine's implementation directly makes that contract
// hold by construction — it is the same code.
export { makeEventId } from "@autopoly/forecast-engine/store";

export function eventDir(eventId: string): string {
  return path.join(forecastsRoot(), eventId);
}

export function loadState(eventId: string): ForecastState | null {
  const state = loadAnyState(eventId);
  return state && !isStructuredForecast(state) ? state : null;
}

export function loadAnyState(eventId: string): AnyForecastState | null {
  const file = path.join(eventDir(eventId), "state.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AnyForecastState;
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
