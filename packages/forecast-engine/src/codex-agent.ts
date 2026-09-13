// Codex CLI provider — GPT-5.x through the user's ChatGPT/Codex subscription.
//
// We drive `codex exec --json` headless: prompt on stdin, JSONL events on
// stdout. Sandbox is read-only. Sessions are deliberately PERSISTED (no
// --ephemeral): each rollout file under ~/.codex/sessions records a
// rate_limits snapshot (used_percent + resets_at for the subscription
// windows), which the fleet quota monitor reads as its Codex waterline —
// ephemeral runs would blind it. Session files are uuid-named, so parallel
// books do not collide. Web search is force-enabled (-c
// tools.web_search=true): the engine's research rounds depend on it, and
// codex runs the search server-side.
//
// The event stream carries the model's search QUERIES but not the result
// URLs, so there is no trace to check citations against. Citation
// verification therefore uses the same liveness fallback as the tool-less
// deepseek path (verifyCitedUrls): a cited URL counts unless it provably does
// not exist — weaker than trace membership, and the run result says so by
// leaving searchResultUrls to the liveness-checked set.
//
// Auth is the codex CLI's own stored login (~/.codex); no key handled here.

import { spawn } from "node:child_process";
import { extractJsonObject } from "./claude-agent";
import type { AgentRunResult, RunAgentOptions } from "./claude-agent";
import { collectCitedUrls, verifyCitedUrls } from "./deepseek-agent";

const DEFAULT_TIMEOUT_MS = Number(process.env.FORECAST_AGENT_TIMEOUT_MS) || 360_000;

export interface CodexDeps {
  fetchFn?: typeof fetch; // injectable for tests (liveness check)
}

// Exported for testing: fold a `codex exec --json` JSONL stdout into the final
// assistant text, the real web-search queries, and the turn count.
export function parseCodexEvents(stdout: string): {
  finalText: string;
  searchQueries: string[];
  numTurns: number;
} {
  const texts: string[] = [];
  const queries: string[] = [];
  let turns = 0;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed[0] !== "{") continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type === "turn.completed") turns += 1;
    if (obj.type !== "item.completed") continue;
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item) continue;
    if (item.type === "agent_message" && typeof item.text === "string") {
      texts.push(item.text);
    }
    // item.started for web_search carries an empty query; only the completed
    // event holds the real one.
    if (item.type === "web_search" && typeof item.query === "string" && item.query.trim()) {
      queries.push(item.query);
    }
  }
  return { finalText: texts.length ? texts[texts.length - 1]! : "", searchQueries: queries, numTurns: turns };
}

export async function runCodexRaw(
  prompt: string,
  opts: RunAgentOptions = {},
  deps: CodexDeps = {}
): Promise<AgentRunResult> {
  const model = opts.model ?? process.env.FORECAST_MODEL ?? "";
  const command = process.env.CODEX_COMMAND?.trim() || "codex";
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "-s",
    "read-only",
    "-c",
    "tools.web_search=true"
  ];
  if (model) args.push("-m", model);
  args.push("-"); // read the prompt from stdin

  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd ?? process.cwd(), env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`codex agent timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, exitCode: code ?? -1 });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  const parsed = parseCodexEvents(stdout);
  const jsonObject = parsed.finalText ? extractJsonObject(parsed.finalText) : null;
  const jsonError = jsonObject ? null : "no JSON object found in agent final text";
  // No result-URL trace in the event stream — liveness-check the citations.
  const searchResultUrls = await verifyCitedUrls(collectCitedUrls(jsonObject), deps.fetchFn ?? fetch);
  return {
    rawFinalText: parsed.finalText,
    jsonObject,
    jsonError,
    searchQueries: parsed.searchQueries,
    searchResultUrls,
    costUsd: null, // subscription-billed; the CLI reports no dollar cost
    numTurns: parsed.numTurns || null,
    exitCode,
    stderrTail: stderr.slice(-800)
  };
}
