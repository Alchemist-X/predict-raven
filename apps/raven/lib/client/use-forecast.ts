"use client";

// Polling hook for one forecast: returns the dossier view-model, the child-
// process job (while the engine runs), and the analyst annotation state.
// Poll cadence matches the proven viewer prototype (~1.6s, backoff on error);
// polling stops once the run is terminal and the dossier is complete.

import { useCallback, useEffect, useRef, useState } from "react";
import { withBasePath } from "../base-path";
import type { AnalystState } from "../server/analyst";
import type { IncompleteStatus } from "../vm/forecast-status";
import type { DossierVM } from "../vm/types";

export interface JobInfo {
  status: "running" | "done" | "error" | "unforecastable" | IncompleteStatus;
  question?: string;
  log: string[];
  startedAtUtc: string;
  maxRounds: number;
  provider: string;
}

export interface ForecastPayload {
  dossier: DossierVM | null;
  job: JobInfo | null;
  analyst: AnalystState;
}

const EMPTY_ANALYST: AnalystState = { notes: [], marks: {} };

export function useForecast(id: string) {
  const [data, setData] = useState<ForecastPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const [pollEpoch, setPollEpoch] = useState(0);

  const fetchOnce = useCallback(async (): Promise<ForecastPayload | null> => {
    try {
      const res = await fetch(withBasePath(`/api/forecasts/${encodeURIComponent(id)}`), { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `request failed (${res.status})`);
      }
      const payload = (await res.json()) as ForecastPayload;
      if (alive.current) {
        setData({ ...payload, analyst: payload.analyst ?? EMPTY_ANALYST });
        setError(null);
      }
      return payload;
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [id]);

  useEffect(() => {
    alive.current = true;
    let delay = 1600;
    const loop = async () => {
      const payload = await fetchOnce();
      if (!alive.current) return;
      const running = payload?.job?.status === "running" || payload?.dossier?.status === "running";
      delay = payload ? (running ? 1600 : 0) : 2600;
      if (delay > 0) timer.current = setTimeout(loop, delay);
    };
    void loop();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchOnce, pollEpoch]);

  const refresh = useCallback(async () => {
    const payload = await fetchOnce();
    setPollEpoch(value => value + 1);
    return payload;
  }, [fetchOnce]);
  return { data, error, refresh };
}

export async function apiSetMark(id: string, targetId: string, mark: "keep" | "doubt" | null): Promise<void> {
  const res = await fetch(withBasePath(`/api/forecasts/${encodeURIComponent(id)}/marks`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetId, mark })
  });
  if (!res.ok) throw new Error(`saving mark failed (${res.status})`);
}

export async function apiAddNote(
  id: string,
  input: { id?:string; text: string; stance: "yes" | "no" | "question"; targetId: string | null; continueResearch?:boolean; invite?:string; language?:"en"|"zh" }
): Promise<{continuation?:{status:string}}> {
  const res = await fetch(withBasePath(`/api/forecasts/${encodeURIComponent(id)}/notes`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`saving note failed (${res.status})`);
  return res.json();
}

export async function apiRemoveNote(id: string, noteId: string): Promise<void> {
  const res = await fetch(withBasePath(`/api/forecasts/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`), {
    method: "DELETE"
  });
  if (!res.ok && res.status !== 404) throw new Error(`removing note failed (${res.status})`);
}
