import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveState } from "../../../../packages/forecast-engine/src/store";
import type { ForecastState, RoundRecord } from "../../../../packages/forecast-engine/src/types";
import { continueForecast, getJob } from "./run-manager";
import { POST } from "../../app/api/forecasts/[id]/notes/route";
import { loadAnalyst } from "./analyst";
import { quotaUsed, QuotaExceededError } from "./quota";
import { createInvite } from "./invites";
const spawned=vi.hoisted(()=>({calls:[] as unknown[][], children:[] as Array<EventEmitter & {stdout:EventEmitter;stderr:EventEmitter}>}));
vi.mock("node:child_process",()=>({spawn:(...args:unknown[])=>{
  spawned.calls.push(args);
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter()});
  spawned.children.push(child); return child;
}}));
let root:string;
beforeEach(()=>{
  root=mkdtempSync(path.join(os.tmpdir(),"raven-feedback-api-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT",root);vi.stubEnv("NODE_ENV","test");vi.stubEnv("FORECAST_DAILY_QUOTA","2");vi.stubEnv("FORECAST_PROVIDER","claude");
  spawned.calls.length=0;spawned.children.length=0;
  (globalThis as unknown as {__ravenJobs?:Map<string,unknown>}).__ravenJobs?.clear();
});
afterEach(()=>{for(const child of spawned.children)child.emit("close",1);vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
function saved(id="saved",round=3){
  const state:ForecastState = {createdAtUtc:new Date().toISOString(),updatedAtUtc:new Date().toISOString(),round:0,roundHistory:[],status:"converged",evidenceLedger:[],summary:null,currentProb:0.5,credibleInterval:[0.3,0.7],eventId:id,eventText:"Will the new official model be called Sol?",framing:{normalizedQuestion:"Frozen official name?",resolutionCriteria:"Official record",resolutionDate:"2027-01-01",settlementSource:"Official documentation",forecastable:true,priorProbability:0.5,priorRationale:"Prior",assumptions:"",clarificationNeeded:"",framingCaveats:"",framingConfidence:"medium"}};
  state.round=round;state.roundHistory=Array.from({length:round},(_,i)=>({round:i+1}) as RoundRecord);state.status="converged";saveState(state);return state;
}
const post=(id:string,input:Record<string,unknown>)=>POST(new Request(`http://localhost/api/forecasts/${id}/notes`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:"Please check the historical naming examples",stance:"question",id:"feedback-1",...input})}),{params:Promise.resolve({id})});
describe("feedback continuation API",()=>{
  it("saves feedback for a completed forecast and resumes its exact event with cumulative budget",async()=>{
    const state=saved();
    const response=await post(state.eventId,{continueResearch:true,additionalRounds:2});
    expect(response.status).toBe(200);
    expect((await response.json()).continuation.status).toBe("running");
    expect(loadAnalyst(state.eventId).notes[0]!.consumedRound).toBeNull();
    expect(spawned.calls).toHaveLength(1);
    expect(spawned.calls[0]![1]).toEqual(expect.arrayContaining(["--resume-event",state.eventId,"--additional-rounds","2"]));
    expect(getJob(state.eventId)?.maxRounds).toBe(5);
    expect(quotaUsed("raven-web")).toBe(1);
  });
  it("appends feedback to a running forecast without duplicate spawn or quota consumption",async()=>{
    saved();await post("saved",{continueResearch:true});
    await post("saved",{id:"feedback-2",text:"Check a second source",continueResearch:true});
    expect(spawned.calls).toHaveLength(1);expect(quotaUsed("raven-web")).toBe(1);
    expect(loadAnalyst("saved").notes).toHaveLength(2);
  });
  it("preserves saved feedback when quota prevents continuation",async()=>{
    saved();vi.stubEnv("FORECAST_DAILY_QUOTA","0");
    const response=await post("saved",{continueResearch:true});
    expect((await response.json()).continuation.status).toBe("quota_exceeded");
    expect(loadAnalyst("saved").notes).toHaveLength(1);expect(spawned.calls).toHaveLength(0);
    expect(()=>continueForecast("saved",{additionalRounds:2,quota:{service:"raven-web",limit:0}})).toThrow(QuotaExceededError);
  });
  it("does not expose anonymous paid continuation in production, but still saves the note",async()=>{
    saved();vi.stubEnv("NODE_ENV","production");
    const response=await post("saved",{continueResearch:true});
    expect((await response.json()).continuation.status).toBe("authorization_required");
    expect(loadAnalyst("saved").notes).toHaveLength(1);expect(spawned.calls).toHaveLength(0);
    const invite=createInvite({code:"private-test-invite",maxUses:2});
    const retry=await post("saved",{continueResearch:true,invite:invite.code});
    expect((await retry.json()).continuation.status).toBe("running");
    expect(loadAnalyst("saved").notes).toHaveLength(1);
  });
  it("rejects a nonexistent forecast and invalid budgets without saving orphan feedback",async()=>{
    expect((await post("missing",{continueResearch:true})).status).toBe(404);
    saved();expect((await post("saved",{continueResearch:true,additionalRounds:0})).status).toBe(400);
    expect(loadAnalyst("saved").notes).toHaveLength(0);
    expect(spawned.calls).toHaveLength(0);
  });
  it("keeps feedback pending when a spawned process fails",async()=>{
    saved();await post("saved",{continueResearch:true});
    spawned.children[0]!.emit("error",new Error("spawn failed"));
    expect(getJob("saved")?.status).toBe("error");
    expect(loadAnalyst("saved").notes[0]!.consumedRound).toBeNull();
  });
});
