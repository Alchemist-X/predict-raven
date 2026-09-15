"use client";

// Optimistic analyst annotations over the server-persisted state: marks apply
// instantly and are confirmed (or rolled back with a toast) by the API; notes
// get a temp entry until the server copy lands via refresh().

import { useT } from "../../lib/i18n";
import { RP } from "../../lib/i18n/research-parts";
import { useCallback, useMemo, useState } from "react";
import { apiAddNote, apiRemoveNote, apiSetMark } from "../../lib/client/use-forecast";
import type { AnalystMark, AnalystNote, AnalystState, AnalystStance } from "../../lib/server/analyst";

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _dropped, ...rest } = record;
  return rest;
}

export interface Annotations {
  marks: Record<string, AnalystMark>;
  notes: AnalystNote[];
  keptCount: number;
  doubtedCount: number;
  toggleMark: (targetId: string, val: AnalystMark) => void;
  addNote: (input: { id?:string; text: string; stance: AnalystStance; targetId: string | null; continueResearch?:boolean; invite?:string; language?:"en"|"zh" }) => Promise<boolean>;
  removeNote: (noteId: string) => void;
  toast: string | null;
  clearToast: () => void;
}

export function useAnnotations(
  id: string,
  server: AnalystState | undefined,
  refresh: () => Promise<unknown>
): Annotations {
  const t = useT();
  const [markOverlay, setMarkOverlay] = useState<Readonly<Record<string, AnalystMark | null>>>({});
  const [tempNotes, setTempNotes] = useState<readonly AnalystNote[]>([]);
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const marks = useMemo(() => {
    const merged: Record<string, AnalystMark> = { ...(server?.marks ?? {}) };
    for (const [key, val] of Object.entries(markOverlay)) {
      if (val === null) delete merged[key];
      else merged[key] = val;
    }
    return merged;
  }, [server, markOverlay]);

  const notes = useMemo(() => {
    const persisted = (server?.notes ?? []).filter((n) => !removedIds.includes(n.id));
    return [...persisted, ...tempNotes.filter(note => !persisted.some(item => item.id === note.id))];
  }, [server, removedIds, tempNotes]);

  const toggleMark = useCallback(
    (targetId: string, val: AnalystMark) => {
      const next: AnalystMark | null = marks[targetId] === val ? null : val;
      setMarkOverlay((o) => ({ ...o, [targetId]: next }));
      apiSetMark(id, targetId, next)
        .then(async () => {
          await refresh();
          setMarkOverlay((o) => withoutKey(o, targetId));
        })
        .catch(() => {
          setMarkOverlay((o) => withoutKey(o, targetId));
          setToast(t(RP.feedbackMarkFailed));
        });
    },
    [id, marks, refresh, t]
  );

  const addNote = useCallback(
    async (input: { id?:string; text: string; stance: AnalystStance; targetId: string | null; continueResearch?:boolean; invite?:string; language?:"en"|"zh" }): Promise<boolean> => {
      const text = input.text.trim();
      if (!text) return false;
      const temp: AnalystNote = {id:input.id ?? `note-${crypto.randomUUID()}`, text, stance:input.stance, targetId:input.targetId,createdAtUtc:new Date().toISOString(),consumedRound:null};
      setTempNotes(notes => [...notes,temp]);
      try {
        const result = await apiAddNote(id, {...input,id:temp.id,text});
        await refresh();
        const status = result.continuation?.status;
        setToast(t(status === "authorization_required" ? RP.feedbackAuth : status === "quota_exceeded" ? RP.feedbackQuota : status === "failed" || status === "provider_unavailable" ? RP.feedbackStopped : status === "running" ? RP.feedbackStarted : status === "queued" ? RP.feedbackQueued : RP.feedbackSaved));
        return true;
      } catch { setToast(t(RP.feedbackSaveFailed)); return false; }
      finally { setTempNotes(notes => notes.filter(note => note.id !== temp.id)); }
    }, [id,refresh,t]
  );

  const removeNote = useCallback(
    (noteId: string) => {
      if (noteId.startsWith("temp-")) {
        setTempNotes((t) => t.filter((n) => n.id !== noteId));
        return;
      }
      setRemovedIds((r) => [...r, noteId]);
      apiRemoveNote(id, noteId)
        .then(async () => {
          await refresh();
          setRemovedIds((r) => r.filter((x) => x !== noteId));
        })
        .catch(() => {
          setRemovedIds((r) => r.filter((x) => x !== noteId));
          setToast(t(RP.feedbackRemoveFailed));
        });
    },
    [id, refresh, t]
  );

  const keptCount = useMemo(() => Object.values(marks).filter((v) => v === "keep").length, [marks]);
  const doubtedCount = useMemo(() => Object.values(marks).filter((v) => v === "doubt").length, [marks]);
  const clearToast = useCallback(() => setToast(null), []);

  return { marks, notes, keptCount, doubtedCount, toggleMark, addNote, removeNote, toast, clearToast };
}
