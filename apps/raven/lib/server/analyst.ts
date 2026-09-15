// Shared persistence keeps app edits and engine consumption atomic.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appendFeedback, readAnalystFile, updateAnalystFile } from "@autopoly/forecast-engine/analyst-feedback";
import type { AnalystNote, AnalystState, AnalystMark, AnalystStance } from "@autopoly/forecast-engine/types";
import { eventDir } from "./repo";
export type { AnalystNote, AnalystState, AnalystMark, AnalystStance };
const file = (eventId: string) => path.join(eventDir(eventId), "analyst.json");
export function loadAnalyst(eventId: string): AnalystState { return readAnalystFile(file(eventId)); }
export function addNote(eventId: string, input: {id?: string; text:string; stance:AnalystStance; targetId:string|null}): AnalystNote {
  const added = appendFeedback(file(eventId), {notes:[input]});
  return added[0] ?? loadAnalyst(eventId).notes.find(note => note.id === input.id)!;
}
export function removeNote(eventId: string, noteId: string): boolean {
  return updateAnalystFile(file(eventId), current => {
    const before = current.notes.length;
    current.notes = current.notes.filter(note => note.id !== noteId);
    return before !== current.notes.length;
  });
}
export function setMark(eventId: string, targetId: string, mark: AnalystMark|null): AnalystState {
  return updateAnalystFile(file(eventId), state => {
    if (state.marks[targetId] !== mark) {
      if (mark === null) delete state.marks[targetId]; else state.marks[targetId] = mark;
      (state.markVersions ??= {})[targetId] = randomUUID();
      delete (state.doubtsHandled ??= {})[targetId];
    }
    return state;
  });
}
