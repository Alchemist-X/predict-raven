import { afterEach, describe, expect, it, vi } from "vitest";
import { recordModelReads, applyResearchReview, materialResearchGaps, parseResearchReview, researchGapSources, retrieveResearchGaps } from "./research-review";
import type { ResearchGapRequest, ResearchReviewState } from "./research-review";

const request: ResearchGapRequest = {id:"lease_scope",targetIds:["meta"],question:"Does capex include lease payments?",whyMaterial:"The spending forecasts use different accounting scopes.",query:"Meta capex finance lease official",keywords:["Meta","capex"],priority:"high"};
function pending(): ResearchReviewState { const s = {}; applyResearchReview(s,{researchGaps:[request],gapResolutions:[]},1,[]); return s; }
afterEach(() => vi.unstubAllEnvs());

describe("question-led retrieval", () => {
  it("keeps legacy outputs compatible while validating explicit questions and targets", () => {
    expect(parseResearchReview({})).toEqual({researchGaps:[],gapResolutions:[]});
    expect(parseResearchReview({research_gaps:[request]},["meta"]).researchGaps).toEqual([request]);
    expect(() => parseResearchReview({research_gaps:[request]},["google"])).toThrow(/outside/);
    expect(() => parseResearchReview({research_gaps:[request,request]})).toThrow(/unique/);
    expect(() => parseResearchReview({gap_resolutions:[{id:"g",reason:"resolved",sourceUrls:["https://user:secret@example.com"]}]})).toThrow(/credentials/);
  });
  it("does not allow a gap to be declared resolved immediately or with an unobserved source", () => {
    const s=pending(), resolution={id:request.id,reason:"Official footnote confirms the accounting scope.",sourceUrls:["https://example.com/filing"]};
    expect(() => applyResearchReview(s,{researchGaps:[],gapResolutions:[resolution]},1,resolution.sourceUrls)).toThrow(/later evidence/);
    expect(() => applyResearchReview(s,{researchGaps:[],gapResolutions:[resolution]},2,[])).toThrow(/absent/);
    expect(materialResearchGaps(s)).toHaveLength(1);
    applyResearchReview(s,{researchGaps:[],gapResolutions:[resolution]},2,resolution.sourceUrls);
    expect(materialResearchGaps(s)).toHaveLength(0);
    expect(s.researchGaps![0].resolution?.reason).toContain("footnote");
  });
  it("preserves a gap's identity and does not reopen a resolved question", () => {
    const s=pending();
    expect(() => applyResearchReview(s,{researchGaps:[{...request,question:"Different issue"}],gapResolutions:[]},2,[])).toThrow(/repurposed/);
    applyResearchReview(s,{researchGaps:[],gapResolutions:[{id:request.id,reason:"Actual footnote",sourceUrls:["https://example.com/f"]}]},2,["https://example.com/f"]);
    applyResearchReview(s,{researchGaps:[request],gapResolutions:[]},3,[]);
    expect(s.researchGaps![0].status).toBe("resolved");
  });
  it("actually searches and reads before another evidence pass, but search success alone never resolves a gap", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK","1");
    const s=pending(), collect=vi.fn().mockResolvedValue(null);
    const call=vi.fn().mockImplementation(async (tool,args) => tool==="web_search"
      ? {status:"ok",source_urls:["https://example.com/filing"],results:[{url:"https://example.com/filing"}]}
      : {status:"ok",url:args.url,source_urls:[args.url],text:"Capital expenditures include lease principal.",sha256:"hash",offset:0});
    await retrieveResearchGaps(s,2,()=>{}, {callTool:call,collectLibrary:collect});
    expect(collect).toHaveBeenCalledWith({searchQueries:[{targetId:"meta",query:request.query,keywords:request.keywords}]},expect.any(Function),expect.objectContaining({mode:"focused"}));
    expect(call.mock.calls.map(c=>c[0])).toEqual(["web_search","fetch_page"]);
    expect(s.researchGaps![0].status).toBe("searched");
    expect(materialResearchGaps(s)).toHaveLength(1);
    expect(researchGapSources(s)).toEqual(["https://example.com/filing"]);
    applyResearchReview(s,{researchGaps:[],gapResolutions:[{id:request.id,reason:"The retrieved footnote reconciles the scopes.",sourceUrls:researchGapSources(s)}]},2,[]);
    expect(s.researchGaps![0].status).toBe("resolved");
  });
  it("keeps failed retrieval as an unresolved limitation and respects attempt bounds", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK","1");
    const s=pending(), call=vi.fn().mockRejectedValue(new Error("HTTP 403")), collect=vi.fn().mockResolvedValue(null);
    await retrieveResearchGaps(s,2,()=>{}, {callTool:call,collectLibrary:collect});
    await retrieveResearchGaps(s,3,()=>{}, {callTool:call,collectLibrary:collect});
    await retrieveResearchGaps(s,4,()=>{}, {callTool:call,collectLibrary:collect});
    expect(call).toHaveBeenCalledTimes(2);
    expect(s.researchGaps![0]).toMatchObject({status:"unavailable"});
    expect(s.researchGaps![0].attempts[0].errors).toContain("HTTP 403");
    expect(materialResearchGaps(s)).toHaveLength(1);
    expect(researchGapSources(s)).toEqual([]);
  });
  it("never promotes links embedded only in returned search text into verified sources", async () => {
    vi.stubEnv("FORECAST_SIGNAL_DESK","1");
    const s=pending(), collect=vi.fn().mockResolvedValue(null), call=vi.fn().mockResolvedValue({status:"ok",source_urls:[],results:[{url:"https://example.com/invented"}]});
    await retrieveResearchGaps(s,2,()=>{}, {callTool:call,collectLibrary:collect});
    expect(call).toHaveBeenCalledTimes(1);
    expect(researchGapSources(s)).toEqual([]);
  });
});


describe("model-initiated follow-up reads", () => {
  it("retains new pages for exact quotation checks without erasing the original passage", () => {
    const s: ResearchReviewState = {expandedLibrary:{required:true,searchedAtUtc:"2026-09-13",queries:[],readings:[{articleId:"bank",targetId:"meta",url:"https://example.org/bank/pdf",title:"Bank report",text:"First page introduction",offset:0,sha256:"hash",contentKind:"pdf",apiDate:"2026-09-12",startPage:1}],usedArticleIds:[],exclusions:[]}};
    const result = {readSourceUrls:["https://example.org/bank/pdf"],researchReadings:[{tool:"signal_desk_pdf" as const,article_id:"bank",url:"https://example.org/bank/pdf",text:"[Page 12] Hardware spending is flexible.",sha256:"hash",access:"body_verified" as const,content_kind:"pdf",start_page:12,pages:[{page:12,text_chars:35,truncated:false}]}]};
    recordModelReads(s,result);recordModelReads(s,result);
    expect(s.expandedLibrary!.readings).toHaveLength(2);
    expect(s.expandedLibrary!.readings[0].text).toContain("First page");
    expect(s.expandedLibrary!.readings[1]).toMatchObject({startPage:12,text:result.researchReadings[0].text});
    expect(s.readSourceUrls).toEqual(result.readSourceUrls);
  });
});
