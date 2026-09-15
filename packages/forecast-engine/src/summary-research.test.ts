import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {newForecastState,runForecast} from './engine';
import {InvalidResearchSummary,summarizeForecast} from './summary';
import type {AgentRunResult} from './claude-agent';
import type {EventFraming} from './types';
vi.mock('./agent',()=>({providerHasWebSearch:()=>false,runAgent:vi.fn()}));
const framing:EventFraming={normalizedQuestion:'Will the company cut its budget?',resolutionCriteria:'Official same-year reduction',resolutionDate:'2027-03-13',settlementSource:'Official filing',assumptions:'',forecastable:true,clarificationNeeded:'',priorProbability:0.2,priorRationale:'Uncalibrated base rate',framingCaveats:'',framingConfidence:'medium'};
const gap={id:'funding',targetIds:['question'],question:'Is financing committed?',whyMaterial:'Funding pressure may not cause a cut',query:'company committed financing',keywords:['company','financing'],priority:'high'};
const bad={verdict:'Needs more evidence',research_gaps:[gap],gap_resolutions:[{id:'nonexistent',reason:'A search returned it',sourceUrls:['https://example.org/no-read']}]};
const result=(jsonObject:unknown):AgentRunResult=>({rawFinalText:JSON.stringify(jsonObject),jsonObject,jsonError:null,searchQueries:[],searchResultUrls:new Set(),costUsd:null,numTurns:1,exitCode:0,stderrTail:''});
let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'summary-research-'));vi.stubEnv('ARTIFACT_STORAGE_ROOT',dir);vi.stubEnv('FORECAST_REQUIRE_EXPANDED_LIBRARY','0');vi.stubEnv('FORECAST_SIGNAL_DESK','0');});
afterEach(()=>{vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
const state=()=>newForecastState({eventId:'summary-questions',eventText:framing.normalizedQuestion,framing});
describe('summary research validation',()=>{
 it('retries invalid question closure atomically, without leaving a misleading summary',async()=>{
  const s=state();s.round=2;
  const agent=vi.fn().mockResolvedValue(result(bad));
  await expect(summarizeForecast(s,{runAgentFn:agent})).rejects.toBeInstanceOf(InvalidResearchSummary);
  expect(agent).toHaveBeenCalledTimes(2);expect(s.summary).toBeNull();expect(s.researchGaps).toBeUndefined();
 });
 it('aborts binary completion when summary mixes a new material gap with an invalid resolution',async()=>{
  const s=state();const round={round_summary:'No new evidence',new_claims:[],reflection:[],confidence:'medium',found_new_information:false};
  await runForecast(s,{maxRounds:1,runAgentFn:vi.fn().mockResolvedValue(result(round))});
  s.status='no_new_info';s.summaryPendingStatus='no_new_info';
  const agent=vi.fn().mockResolvedValue(result(bad));
  await expect(runForecast(s,{maxRounds:1,runAgentFn:agent})).rejects.toBeInstanceOf(InvalidResearchSummary);
  expect(s.status).toBe('aborted');expect(s.round).toBe(1);expect(s.summary).toBeNull();
 });
});
