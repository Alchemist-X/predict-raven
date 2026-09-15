import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessResearchProgress, researchRoundLimit, retryRetrieval, type ResearchProgressState } from "./research-progress";
import { researchRetrievalAttempt } from "./research-tools";
import { parseStreamJson, type AgentRunResult } from "./claude-agent";
import { newForecastState, runForecast } from "./engine";
import { loadStructuredState, newStructuredState, runStructuredForecast } from "./structured-engine";
import type { EventFraming } from "./types";
import type { QuestionSpec } from "./answer-types";
import { loadState, renderReport } from "./store";

let root: string;
beforeEach(() => {
  root=mkdtempSync(join(tmpdir(),"research-progress-"));
  vi.stubEnv("ARTIFACT_STORAGE_ROOT",root);
  vi.stubEnv("FORECAST_SIGNAL_DESK","1");
  vi.stubEnv("FORECAST_REQUIRE_EXPANDED_LIBRARY","0");
  vi.stubEnv("FORECAST_MAX_ROUNDS",undefined);
  vi.stubEnv("FORECAST_MARKET_BLIND","0");
});
afterEach(() => {vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});

const urls = (n:number) => [`https://example.org/official-${n}`];
function response(jsonObject: unknown, n: number, outcome: "results"|"no_results"|"failed" = "results"): AgentRunResult {
  const sourceUrls=outcome === "results" ? urls(n) : [];
  const queries=Array.from({length:6},(_,i)=>`issuer source-${i} pass-${n}`);
  return {jsonObject,rawFinalText:JSON.stringify(jsonObject),jsonError:null,searchQueries:queries,
    searchResultUrls:new Set(sourceUrls),readSourceUrls:sourceUrls,researchReadings:[],
    retrievalAttempts:queries.map(query=>({tool:"web_search",query,outcome,sourceUrls,librarySearched:outcome!=="failed"})),
    costUsd:null,numTurns:1,exitCode:0,stderrTail:""};
}
const frame:EventFraming={normalizedQuestion:"Will the issuer cut its budget?",resolutionCriteria:"Official same-year budget reduction",resolutionDate:"2027-03-13",settlementSource:"Official filing",assumptions:"",forecastable:true,clarificationNeeded:"",priorProbability:0.2,priorRationale:"Reference class",framingCaveats:"",framingConfidence:"medium"};
const binaryState=()=>newForecastState({eventId:"progress",eventText:frame.normalizedQuestion,framing:frame});
function binaryRound(n:number, empty=false) {
  return {round_summary:"Reviewed original evidence",new_claims:empty?[]:[{
    claim_id:`fact-${n}`,focus_id:"resolution-state",claim:`The issuer confirmed milestone ${n} in its current budget.`,
    stance:"supports_yes",strength:"moderate",llr:0.6,cluster_id:`story-${n}`,category:"direct_evidence",resolution_relevance:"direct",rationale:"Directly affects the frozen event.",
    sources:[{url:urls(n)[0],title:"Issuer filing",source_type:"official",credibility:"high",relation:"supports",support_quality:"direct",is_primary:true,independence_group:`origin-${n}`}]
  }],reflection:[],confidence:"medium",found_new_information:!empty,notes:""};
}
const spec:QuestionSpec={kind:"independent_ranking",question:"Which issuer cuts its budget?",resolutionCriteria:"Official same-year budget reduction",resolutionDate:"2027-03-13",asOfDate:"2026-09-14",settlementSource:"Official filing",assumptions:[],options:[{id:"issuer",label:"Issuer"},{id:"peer",label:"Peer"}],unit:null,minimum:null,maximum:null,scoreRubric:null,prior:{issuer:0.2,peer:0.2},priorRationale:"Reference class",searchQueries:[{targetId:"issuer",query:"issuer budget",keywords:["issuer","budget"]},{targetId:"peer",query:"peer budget",keywords:["peer","budget"]}]};
function typedRound(n:number, empty=false) {
  return {summary:"Reviewed original evidence",confidence:"medium",exclusions:[],claims:empty?[]:["issuer","peer"].map(id=>({id:`${id}-${n}`,claim:`${id} confirmed dated fact ${n}.`,targetIds:[id],sourceUrl:urls(n)[0],sourceTitle:"Issuer filing",sourceType:"official",publishedAt:"2026-09-13",quote:`Confirmed fact ${n}.`,rationale:"Direct evidence",clusterId:`${id}-${n}`,effects:{[id]:0.4},numericSignal:null,articleId:null,epistemicStatus:"fact"}))};
}

describe("retrieval outcome and stop conditions",()=>{
  it("has no implicit research-round limit and preserves explicit budgets",()=>{
    expect(researchRoundLimit()).toBe(Infinity); expect(researchRoundLimit(0)).toBe(Infinity);
    expect(researchRoundLimit(25)).toBe(25);
    vi.stubEnv("FORECAST_MAX_ROUNDS","7"); expect(researchRoundLimit()).toBe(7); expect(researchRoundLimit(0)).toBe(Infinity);
    for(const v of [-1,1.5,NaN,Infinity]) expect(()=>researchRoundLimit(v)).toThrow();
  });
  it("separates a failed call from a successful empty search and preserves partial failures",()=>{
    expect(researchRetrievalAttempt("web_search",{query:"TPU"},{status:"error",source_urls:[]}).outcome).toBe("failed");
    expect(researchRetrievalAttempt("web_search",{query:"TPU"},{status:"ok",results:[],source_urls:[]}).outcome).toBe("no_results");
    const partial=researchRetrievalAttempt("web_search",{query:"TPU"},{status:"partial",source_urls:urls(1),sources:{signal_desk:{status:"error"}}});
    expect(partial.outcome).toBe("partial"); expect(partial.librarySearched).toBe(false);
  });
  it("captures correlated Claude search failures, empty successes and missing tool results",()=>{
    const wire=(id:string,result:unknown)=>[
      {type:"assistant",message:{content:[{type:"tool_use",id,name:"mcp__raven_research__web_search",input:{query:id}}]}},
      ...(result===null?[]:[{type:"user",message:{content:[{type:"tool_result",tool_use_id:id,content:[{type:"text",text:JSON.stringify(result)}]}]}}])
    ];
    const trace=parseStreamJson([...wire("error",{status:"error",error:"403"}),...wire("empty",{status:"ok",source_urls:[],results:[]}),...wire("missing",null)].map(x=>JSON.stringify(x)).join("\n"));
    expect(trace.retrievalAttempts.map(a=>a.outcome)).toEqual(["failed","no_results","failed"]);
  });
  it("does not allow empty mandatory-library validation to hide failed collection",()=>{
    const s:ResearchProgressState={expandedLibrary:{required:true,searchedAtUtc:"now",queries:[{targetId:"issuer",query:"issuer",status:"error",total:0,error:"403"}],readings:[],usedArticleIds:[],exclusions:[]}};
    const r=response({},1); r.retrievalAttempts!.forEach(a=>a.librarySearched=false);
    const input={round:1,evidenceCount:1,covered:true,openGapCount:0,newClaimCount:0};
    expect(assessResearchProgress(s,r,input).status).toBe("retry");
    expect(assessResearchProgress(s,r,{...input,round:2}).status).toBe("research_failed");
    const recovered=response({},3);
    expect(assessResearchProgress(s,recovered,{...input,round:3}).status).toBe("ready");
  });
  it("does not stop useful gap research just because the next pass adds no claims",()=>{
    const s:ResearchProgressState={};
    expect(assessResearchProgress(s,response({},1),{round:1,evidenceCount:2,covered:true,openGapCount:1,newClaimCount:2}).status).toBe("retry");
    expect(assessResearchProgress(s,response({},2),{round:2,evidenceCount:2,covered:true,openGapCount:1,newClaimCount:0}).status).toBe("retry");
    expect(assessResearchProgress(s,response({},3),{round:3,evidenceCount:3,covered:true,openGapCount:0,newClaimCount:1}).status).toBe("ready");
  });
  it("retries missing or unsuccessful retrieval statuses instead of treating them as empty success",async()=>{
    for (const bad of [{}, {status:"unavailable"}, {status:"denied"}]) {
      const call=vi.fn().mockResolvedValue(bad);
      expect(await retryRetrieval(call,"web_search",{query:"TPU"})).toMatchObject({status:"error"});
      expect(call).toHaveBeenCalledTimes(2);
    }
  });
  it("counts automatic library searches without pretending the model read the precollected text",()=>{
    const s:ResearchProgressState={expandedLibrary:{required:true,searchedAtUtc:"now",queries:[{targetId:"issuer",query:"issuer budget",status:"ok",total:0}],readings:[],usedArticleIds:[],exclusions:[]}};
    const checkpoint=assessResearchProgress(s,{retrievalAttempts:[],searchQueries:[]},{round:1,evidenceCount:1,covered:true,openGapCount:0,newClaimCount:1});
    expect(checkpoint.status).toBe("ready");
    expect(checkpoint.successfulQueries).toEqual(["issuer budget"]);
    expect(checkpoint.readKeys).toEqual([]);
  });
  it("does not clear another target's library failure after a successful single-target search",()=>{
    const s:ResearchProgressState={expandedLibrary:{required:true,searchedAtUtc:"now",queries:["issuer","peer"].map(targetId=>({targetId,query:targetId,status:"error",total:0,error:"403"})),readings:[],usedArticleIds:[],exclusions:[]}};
    const input={round:1,evidenceCount:2,covered:true,openGapCount:0,newClaimCount:0};
    expect(assessResearchProgress(s,response({},1),input).status).toBe("retry");
    expect(assessResearchProgress(s,response({},2),{...input,round:2}).status).toBe("research_failed");
    const both=response({},3);
    both.retrievalAttempts!.push({...both.retrievalAttempts![0],query:"peer budget"});
    expect(assessResearchProgress(s,both,{...input,round:3}).status).toBe("ready");
  });
  it("allows new original-source reads to continue research while identical reads do not manufacture progress",()=>{
    const s:ResearchProgressState={};
    const input={round:1,evidenceCount:1,covered:true,openGapCount:1,newClaimCount:0};
    const pass=(key:string)=>({...response({},1),retrievalAttempts:[...response({},1).retrievalAttempts!,{tool:"fetch_page",query:"https://example.org/report",outcome:"results" as const,sourceUrls:urls(1),librarySearched:false,readKey:key}]});
    expect(assessResearchProgress(s,pass("page1"),input).status).toBe("retry");
    expect(assessResearchProgress(s,pass("page2"),{...input,round:2}).status).toBe("retry");
    expect(assessResearchProgress(s,pass("page2"),{...input,round:3}).status).toBe("retry");
    expect(assessResearchProgress(s,pass("page2"),{...input,round:4}).status).toBe("insufficient_evidence");
  });
});

describe("complete outer research loops",()=>{
  it("binary research continues beyond three rounds by default and then stops on successful exhaustion",async()=>{
    let n=0;
    const agent=vi.fn(async(prompt:string)=>prompt.includes("ROUND:") ? response(binaryRound(++n,n>4),n,n>4?"no_results":"results") : response({verdict:"Evidence explains the engine probability."},n));
    const s=await runForecast(binaryState(),{runAgentFn:agent});
    expect(s.round).toBe(5);expect(s.status).toBe("no_new_info");expect(s.summary?.verdict).toBeTruthy();
    expect(agent.mock.calls[0][0]).toContain("unlimited");
  });
  it("typed research continues beyond three rounds and preserves source-backed stopping",async()=>{
    let n=0;
    const agent=vi.fn(async(prompt:string)=>prompt.includes("ROUND:") ? response(typedRound(++n,n>4),n,n>4?"no_results":"results") : response({verdict:"Evidence explains the engine answer.",keyFindings:[],counterarguments:[],uncertainties:[]},n));
    const s=await runStructuredForecast(newStructuredState("typed-progress",spec.question,{},spec),{runAgentFn:agent,collectLibraryFn:async()=>null});
    expect(s.round).toBe(5);expect(s.status).toBe("no_new_info");expect(s.summary?.verdict).toBeTruthy();
  });
  for(const outcome of ["failed","no_results"] as const) {
    it(`binary ${outcome} retries research and returns an incomplete state with no final synthesis`,async()=>{
      const agent=vi.fn(async(_prompt:string)=>response(binaryRound(1,true),1,outcome));
      const s=await runForecast(binaryState(),{runAgentFn:agent});
      expect(s.round).toBe(2);expect(agent).toHaveBeenCalledTimes(2);
      expect(s.status).toBe(outcome==="failed"?"research_failed":"insufficient_evidence");
      expect(s.summary).toBeNull();expect(renderReport(s)).toMatch(/Research incomplete|研究未完成/);
      expect(agent.mock.calls[1][0]).toContain("PREVIOUS PASS NEEDS FURTHER RESEARCH");
    });
    it(`typed ${outcome} keeps empty claims as missing evidence instead of forcing fabricated coverage`,async()=>{
      const agent=vi.fn(async(_prompt:string)=>response(typedRound(1,true),1,outcome));
      const s=await runStructuredForecast(newStructuredState("typed-empty",spec.question,{},spec),{runAgentFn:agent,collectLibraryFn:async()=>null});
      expect(s.status).toBe(outcome==="failed"?"research_failed":"insufficient_evidence");expect(s.summary).toBeNull();
      expect(agent).toHaveBeenCalledTimes(2);expect(agent.mock.calls[1][0]).toContain("PREVIOUS PASS NEEDS FURTHER RESEARCH");
    });
  }
  it("an explicit exhausted budget remains incomplete and does not call synthesis",async()=>{
    const agent=vi.fn(async()=>response(binaryRound(1),1));
    const s=await runForecast(binaryState(),{maxRounds:1,runAgentFn:agent});
    expect(s.status).toBe("max_rounds");expect(s.summary).toBeNull();expect(agent).toHaveBeenCalledTimes(1);
  });
  it("rejects a binary provider failure even when its JSON and source trace look valid",async()=>{
    const s=binaryState(), agent=vi.fn().mockResolvedValue({...response(binaryRound(1),1),exitCode:9,stderrTail:"Provider unavailable"});
    await expect(runForecast(s,{runAgentFn:agent})).rejects.toThrow(/provider failed/);
    expect(s.status).toBe("aborted");expect(s.evidenceLedger).toEqual([]);expect(s.summary).toBeNull();
  });
  for (const typed of [false,true]) {
    it(`recovers ${typed?"typed":"binary"} pending synthesis after a hard interruption without repeating research`,async()=>{
      const agent=vi.fn().mockResolvedValue(response(typed?typedRound(1):binaryRound(1),1));
      const s=typed
        ? await runStructuredForecast(newStructuredState("pending",spec.question,{},spec),{maxRounds:1,runAgentFn:agent,collectLibraryFn:async()=>null})
        : await runForecast(binaryState(),{maxRounds:1,runAgentFn:agent});
      s.status="no_new_info";s.summaryPendingStatus="no_new_info";
      const synthesis=vi.fn(async(_prompt:string,_options:unknown)=>{
        const saved=typed ? loadStructuredState(s.eventId) : loadState(s.eventId);
        expect(saved).toMatchObject({status:"open",summary:null,summaryPendingStatus:"no_new_info"});
        return response({verdict:"Reviewed evidence.",keyFindings:[],counterarguments:[],uncertainties:[]},1);
      });
      if ("questionSpec" in s) await runStructuredForecast(s,{maxRounds:1,runAgentFn:synthesis,collectLibraryFn:async()=>null});
      else await runForecast(s,{maxRounds:1,runAgentFn:synthesis});
      expect(synthesis).toHaveBeenCalledTimes(1);expect(s.round).toBe(1);
      expect(s.status).toBe("no_new_info");expect(s.summaryPendingStatus).toBeUndefined();
      expect(synthesis.mock.calls[0][1]).toMatchObject({allowedTools:""});
    });
  }
  it("recovers an open typed state saved at its budget as incomplete",async()=>{
    const s=await runStructuredForecast(newStructuredState("at-budget",spec.question,{},spec),{maxRounds:1,runAgentFn:vi.fn().mockResolvedValue(response(typedRound(1),1)),collectLibraryFn:async()=>null});
    s.status="open";
    const agent=vi.fn();
    await runStructuredForecast(s,{maxRounds:1,runAgentFn:agent});
    expect(s.status).toBe("max_rounds");expect(s.summary).toBeNull();expect(agent).not.toHaveBeenCalled();
  });
});
