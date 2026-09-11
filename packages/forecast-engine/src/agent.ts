// Provider dispatch — the single entry point for every model call.
//
// engine/framing/summary call runAgent(); which backend actually runs is chosen
// by env FORECAST_PROVIDER: "claude" (default — Claude Code CLI with real
// WebSearch), "codex" (Codex CLI — GPT-5.x on the user's subscription, with
// server-side web search but a liveness-only citation guard), or "deepseek"
// (OpenAI-compatible HTTP — cheap testing and the Raven app's provider
// toggle). Prompt builders ask providerHasWebSearch() so a search-less
// provider is never told to WebSearch.

import { runAgentRaw } from "./claude-agent";
import type { AgentRunResult, RunAgentOptions } from "./claude-agent";
import { runCodexRaw } from "./codex-agent";
import { recordResearchModel, signalDeskEnabled } from "./research-tools";
import { runDeepSeekRaw, webSearchEnabled } from "./deepseek-agent";

export type ProviderName = "claude" | "codex" | "deepseek";

export function providerName(): ProviderName {
  const v = process.env.FORECAST_PROVIDER;
  if (v === "deepseek") return "deepseek";
  if (v === "codex") return "codex";
  return "claude";
}

export function providerHasWebSearch(name: ProviderName = providerName()): boolean {
  // deepseek/kimi gain a real search trace when the function-calling research
  // loop is enabled (FORECAST_WEB_SEARCH) — prompts may then instruct research.
  // codex always has web search (the adapter force-enables tools.web_search).
  return name === "claude" || name === "codex" || (name === "deepseek" && webSearchEnabled());
}

export async function runAgent(prompt: string, opts: RunAgentOptions = {}): Promise<AgentRunResult> {
  const provider = providerName();
  let result: AgentRunResult;
  switch (provider) {
    case "deepseek":
      result = await runDeepSeekRaw(prompt, opts);
      break;
    case "codex":
      if (signalDeskEnabled()) throw new Error("Signal Desk research currently supports the Claude and DeepSeek providers; choose one explicitly.");
      return runCodexRaw(prompt, opts);
    default:
      result = await runAgentRaw(prompt, opts);
  }
  recordResearchModel(prompt, provider, {
    requested_model: opts.model ?? process.env.FORECAST_MODEL ?? (provider === "deepseek" ? process.env.FORECAST_DEEPSEEK_MODEL ?? "deepseek-chat" : "cli-default"),
    resolved_model: result.resolvedModel ?? null, usage: result.usage ?? null,
    cost_usd: result.costUsd, cost_coverage: result.costCoverage ?? "unavailable", num_turns: result.numTurns,
    search_queries: result.searchQueries, source_urls: [...result.searchResultUrls],
    exit_code: result.exitCode, json_error: result.jsonError, output: result.jsonObject
  });
  return result;
}
