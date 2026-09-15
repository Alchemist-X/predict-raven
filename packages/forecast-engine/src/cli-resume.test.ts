import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
let root:string;
beforeEach(()=>{root=mkdtempSync(path.join(os.tmpdir(),"cli-resume-test-"));});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
const cli=path.join(import.meta.dirname,"cli.ts");
function run(args:string[]) {
  const result=spawnSync(process.execPath,["--import","tsx",cli,...args],{encoding:"utf8",env:{...process.env,ARTIFACT_STORAGE_ROOT:root,FORECAST_REQUIRE_EXPANDED_LIBRARY:"0",FORECAST_SIGNAL_DESK:"0"},timeout:10000});
  return {code:result.status,output:result.stdout+result.stderr};
}
describe("CLI continuation boundary",()=>{
  it("fails a missing event before provider or research calls",()=>{
    const result=run(["--resume-event","missing","--additional-rounds","2"]);
    expect(result.code).toBe(1);expect(result.output).toContain("No saved forecast");expect(result.output).not.toContain("provider:");
  });
  it.each([["--question","A different question"],["--fresh"],["--max-rounds","5"],["--resolution","A different deadline"],["--answer-type","numeric"]])("rejects conflicting resume arguments %j",(...extra)=>{
    const result=run(["--resume-event","existing","--additional-rounds","2",...extra]);
    expect(result.code).toBe(1);expect(result.output).toContain("cannot change the saved question");expect(result.output).not.toContain("provider:");
  });
  it("requires an explicit additional round budget",()=>{
    expect(run(["--resume-event","existing"]).output).toContain("requires --additional-rounds");
  });
});
