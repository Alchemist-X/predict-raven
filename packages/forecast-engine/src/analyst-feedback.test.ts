import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFeedback, consumeFeedback, feedbackSnapshot, parseFeedbackInput, readAnalystFile, updateAnalystFile } from "./analyst-feedback";
import { prepareResume } from "./resume";
import { newForecastState } from "./engine";
import { saveState, analystPath } from "./store";
import { acquireRunLock } from "./run-lock";
import type { EventFraming } from "./types";
let dir:string, file:string;
beforeEach(() => { dir=mkdtempSync(path.join(os.tmpdir(),"feedback-test-")); file=path.join(dir,"analyst.json"); vi.stubEnv("ARTIFACT_STORAGE_ROOT",dir); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir,{recursive:true,force:true}); });
const source = {id:"source-1",url:"https://example.org/record",claim:"A prior source"};
const framing:EventFraming = {normalizedQuestion:"Frozen question?",resolutionCriteria:"Official release",resolutionDate:"2027-01-01",settlementSource:"Official record",assumptions:"",forecastable:true,clarificationNeeded:"",priorProbability:0.5,priorRationale:"Reference class",framingCaveats:"",framingConfidence:"medium"};
describe("durable human feedback", () => {
  it("only consumes injected ids, preserving concurrent notes and renewed doubts", () => {
    appendFeedback(file, {notes:[{id:"first",text:"Check costs"}],doubtIds:[source.id]});
    const snapshot=feedbackSnapshot(readAnalystFile(file),[source],true);
    appendFeedback(file,{notes:[{id:"arrived-later",text:"Check launch dates"}]});
    updateAnalystFile(file,state => { state.markVersions![source.id]="renewed"; });
    consumeFeedback(file,snapshot,3);
    const after=readAnalystFile(file);
    expect(after.notes.map(n=>n.consumedRound)).toEqual([3,null]);
    expect(after.doubtsHandled?.[source.id]).toBeUndefined();
    expect(snapshot.prompt).toContain("not as established fact");
    expect(snapshot.prompt).toContain("Check costs");
    expect(snapshot.prompt).not.toContain("Check launch dates");
  });
  it("keeps unknown doubt ids pending and does not consume a removed and re-added mark", () => {
    appendFeedback(file,{notes:[],doubtIds:[source.id,"missing"]});
    const snapshot=feedbackSnapshot(readAnalystFile(file),[source]);
    consumeFeedback(file,snapshot,2);
    expect(readAnalystFile(file).doubtsHandled).toEqual({[source.id]:2});
    expect(feedbackSnapshot(readAnalystFile(file),[]).prompt).toBe("");
  });
  it("deduplicates idempotent note retries and refuses conflicting content", () => {
    const input={notes:[{id:"same-request",text:"Check the official documentation"}]};
    appendFeedback(file,input); appendFeedback(file,input);
    expect(readAnalystFile(file).notes).toHaveLength(1);
    expect(() => appendFeedback(file,{notes:[{id:"same-request",text:"Different suggestion"}]})).toThrow(/different content/);
    expect(readAnalystFile(file).notes[0].text).toBe(input.notes[0].text);
  });
  it("retains the previous file when a mutation fails", () => {
    appendFeedback(file,{notes:[{text:"Important feedback"}]});
    const before=readFileSync(file,"utf8");
    expect(()=>updateAnalystFile(file,state=>{state.notes=[];throw new Error("failed");})).toThrow("failed");
    expect(readFileSync(file,"utf8")).toBe(before);
  });
  it("refuses malformed imports or corrupt persisted files without overwriting them", () => {
    expect(()=>parseFeedbackInput({notes:[{text:"x",consumedRound:2}]})).toThrow();
    writeFileSync(file,"broken input");
    expect(()=>appendFeedback(file,{notes:[{text:"new note"}]})).toThrow();
    expect(readFileSync(file,"utf8")).toBe("broken input");
  });
});
describe("explicit safe continuation", () => {
  it("requires a saved state and positive additional budget", () => {
    expect(()=>prepareResume({eventId:"missing",additionalRounds:2})).toThrow(/No saved forecast/);
    expect(()=>prepareResume({eventId:"../escape",additionalRounds:2})).toThrow(/Invalid/);
    expect(()=>prepareResume({eventId:"missing",additionalRounds:0})).toThrow(/positive/);
  });
  it("keeps a frozen binary question and adds budget to completed rounds", () => {
    const state=newForecastState({eventId:"saved",eventText:"Original human question",framing});
    state.status="converged";
    saveState(state);
    const input=path.join(dir,"feedback.json"); writeFileSync(input,JSON.stringify({notes:[{id:"human-1",text:"Consider the naming history"}]}));
    const resumed=prepareResume({eventId:"saved",additionalRounds:2,feedbackFile:input});
    expect(resumed.maxRounds).toBe(state.round+2);
    expect(resumed.state).toEqual(state);
    expect(readAnalystFile(analystPath("saved")).notes[0].consumedRound).toBeNull();
  });
  it("does not allow concurrent writers on the same event", () => {
    const lock=path.join(dir,"engine.lock"); const release=acquireRunLock(lock);
    expect(()=>acquireRunLock(lock)).toThrow(/already holds/);
    release(); acquireRunLock(lock)();
  });
});
