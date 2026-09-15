// Explicit continuation keeps the persisted question and answer contract frozen.
import { readFileSync } from "node:fs";
import type { AnyForecastState } from "./answer-types";
import { appendFeedback, parseFeedbackInput } from "./analyst-feedback";
import { analystPath, loadState } from "./store";
import { loadStructuredState } from "./structured-engine";

export interface ResumeOptions { eventId: string; additionalRounds: number; feedbackFile?: string }
export function prepareResume(options: ResumeOptions): { state: AnyForecastState; maxRounds: number } {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(options.eventId)) throw new Error("Invalid resume event id");
  if (!Number.isSafeInteger(options.additionalRounds) || options.additionalRounds <= 0) throw new Error("--additional-rounds must be a positive integer");
  const state = loadStructuredState(options.eventId) ?? loadState(options.eventId);
  if (!state) throw new Error(`No saved forecast for ${options.eventId}; select its original ARTIFACT_STORAGE_ROOT. Resume never starts a new question.`);
  if (state.eventId !== options.eventId || !Number.isSafeInteger(state.round) || state.round < 0 || !Array.isArray(state.roundHistory) || state.roundHistory.length !== state.round || !state.eventText || !("questionSpec" in state || state.framing)) throw new Error("Saved forecast is invalid; refusing to resume");
  const maxRounds = state.round + options.additionalRounds;
  if (!Number.isSafeInteger(maxRounds)) throw new Error("Additional round budget is too large");
  if (options.feedbackFile) {
    const input = parseFeedbackInput(JSON.parse(readFileSync(options.feedbackFile, "utf8")));
    const sources = new Set(state.evidenceLedger.map(entry => entry.id));
    if (input.doubtIds?.some(id => !sources.has(id))) throw new Error("A doubt id does not belong to this forecast's evidence");
    appendFeedback(analystPath(options.eventId), input);
  }
  return { state, maxRounds };
}
