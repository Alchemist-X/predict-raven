// A local filesystem lease prevents overlapping writers and duplicate model spend.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
export function acquireRunLock(directory: string): () => void {
  mkdirSync(path.dirname(directory), { recursive: true });
  try { mkdirSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`A forecast already holds ${directory}. If it crashed, verify the recorded process stopped before removing the lock.`);
    throw error;
  }
  try { writeFileSync(path.join(directory, "owner.json"), JSON.stringify({pid:process.pid,host:os.hostname(),createdAtUtc:new Date().toISOString()}), {mode:0o600}); }
  catch (error) { rmSync(directory,{recursive:true,force:true}); throw error; }
  let released = false;
  return () => { if (!released) { released = true; rmSync(directory, { recursive:true, force:true }); } };
}
