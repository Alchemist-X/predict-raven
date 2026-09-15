// CLI entry: preserve binary, categorical, numeric and independent-ranking answers.
//
// Usage:
//   ANTHROPIC_BASE_URL=... ANTHROPIC_API_KEY=... \
//   pnpm forecast:event -- "Will SpaceX land Starship before 2027?" \
//     [--resolution "..."] [--max-rounds N] [--model X] [--fresh]
//
// Round 0 frames the prompt into a precise binary question (resolution criteria,
// resolution date, settlement source) before any probability is estimated; an
// ill-posed prompt is flagged for clarification instead of being forecast.
// Re-running the same prompt resumes the existing forecast (adds rounds);
// --fresh starts over. --resolution pins the resolution (the framer keeps it).

import { providerName } from "./agent";
import { runForecast, newForecastState } from "./engine";
import { frameEvent } from "./framing";
import { marketBlind } from "./market-blind";
import { createResearchPlan } from "./research-plan";
import { eventDir, loadState, makeEventId, saveState } from "./store";
import type { ForecastState } from "./types";
import type { AnswerRequest } from "./answer-types";
import { answerLabel } from "./answer-types";
import { classifyQuestion, frameStructuredQuestion, validateAnswerRequest } from "./question-spec";
import { loadStructuredState, newStructuredState, runStructuredForecast, saveStructuredState } from "./structured-engine";
import { researchCommand, researchTools, signalDeskEnabled } from "./research-tools";
import { expandedLibraryRequired } from "./expanded-library";
import { incompleteResearch, researchRoundLimit } from "./research-progress";

interface CliArgs {
  question: string;
  resolution: string | null;
  maxRounds: number | undefined;
  model: string | undefined;
  fresh: boolean;
  answerRequest: AnswerRequest;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let resolution: string | null = null;
  let maxRounds: number | undefined;
  let model: string | undefined;
  let fresh = false;
  let answerRequest: Record<string, unknown> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--resolution") resolution = argv[++i] ?? null;
    else if (a === "--max-rounds") maxRounds = Number(argv[++i]);
    else if (a === "--model") model = argv[++i];
    else if (a === "--question") positional.push(argv[++i] ?? "");
    else if (a === "--fresh") fresh = true;
    else if (a === "--answer-request") answerRequest = JSON.parse(argv[++i] ?? "null");
    else if (a === "--answer-type") answerRequest.answerType = argv[++i];
    else if (a === "--options") {
      const values = JSON.parse(argv[++i] ?? "null");
      answerRequest.options = Array.isArray(values) ? values.map((value, index) => typeof value === "string" ? {id: `option_${index + 1}`, label:value} : value) : values;
    }
    else if (a === "--unit") answerRequest.unit = argv[++i];
    else if (a === "--minimum") answerRequest.minimum = Number(argv[++i]);
    else if (a === "--maximum") answerRequest.maximum = Number(argv[++i]);
    else if (a.startsWith("--")) {
      /* ignore unknown flags */
    } else positional.push(a);
  }
  if (resolution && answerRequest.resolution && resolution !== answerRequest.resolution) throw new Error("Conflicting resolution arguments");
  if (resolution) answerRequest.resolution = resolution;
  researchRoundLimit(maxRounds);
  return { question: positional.join(" ").trim(), resolution: resolution ?? (answerRequest.resolution as string | null) ?? null, maxRounds, model, fresh, answerRequest: validateAnswerRequest(answerRequest) };
}

const pct = (p: number): string => `${(p * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.question) {
    console.error(
      'Usage: pnpm forecast:event -- "<event prompt>" [--resolution ...] [--max-rounds N] [--model X] [--fresh]'
    );
    process.exit(1);
  }
  // Provider-aware key guard. The claude provider accepts three auth paths and
  // the CLI itself is the authority on them — we only report which one is in
  // play: ANTHROPIC_API_KEY (API billing), CLAUDE_CODE_OAUTH_TOKEN (subscription
  // token from `claude setup-token`, the headless-server path), or the CLI's
  // stored interactive login (assumed when neither var is set).
  const provider = providerName();
  if (expandedLibraryRequired() && !signalDeskEnabled()) throw new Error("Expanded resource library is required but its gateway is disabled");
  if (signalDeskEnabled()) {
    if (provider === "codex") throw new Error("Expanded resource library research currently supports the Claude and DeepSeek providers; choose one explicitly.");
    const registry = await researchTools();
    console.log(`execution mode: research-only · decision source: user-enabled expanded resource library`);
    console.log(`research sources: public web + personal expanded resource library · tools: ${registry.length}`);
    console.log(`research gateway: ${researchCommand()} · trace: ${process.env.RAVEN_RESEARCH_TRACE ?? "private service default"}`);
  }
  if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY is required for the deepseek provider (FORECAST_PROVIDER=deepseek).");
    process.exit(1);
  }
  const claudeAuth = process.env.ANTHROPIC_API_KEY
    ? "api-key"
    : process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? "subscription-token"
      : "cli-login";
  console.log(`provider: ${provider}${provider === "claude" ? ` (auth: ${claudeAuth})` : ""}`);

  const eventId = makeEventId(args.question, args.answerRequest);
  const structured = args.fresh ? null : loadStructuredState(eventId);
  const existingBinary = args.fresh ? null : loadState(eventId);
  const kind = structured?.questionSpec.kind ?? (existingBinary ? "binary" : await classifyQuestion(args.question, args.answerRequest, {model: args.model}));
  if (kind !== "binary") {
    console.log(`execution mode: research-only · answer type: ${kind} · event: ${eventId}`);
    const state = structured ?? newStructuredState(eventId, args.question, args.answerRequest,
      await frameStructuredQuestion(args.question, kind, args.answerRequest, {model: args.model}));
    saveStructuredState(state);
    const result = await runStructuredForecast(state, {maxRounds: args.maxRounds, model: args.model, onLog: console.log});
    console.log(`${incompleteResearch(result.status) ? "INCOMPLETE RESEARCH — PROVISIONAL ESTIMATE" : "FINAL ANSWER"}: ${answerLabel(result.answer)}`);
    if (result.researchBlocker) console.log(`Research incomplete: ${result.researchBlocker}`);
    console.log(JSON.stringify(result.answer));
    console.log(`Status: ${result.status} · Rounds: ${result.round} · Claims: ${result.evidenceLedger.length}`);
    console.log(`Report: ${eventDir(eventId)}/report.md`);
    console.log(`State: ${eventDir(eventId)}/state.json`);
    return;
  }
  let state: ForecastState | null = args.fresh ? null : loadState(eventId);

  if (state) {
    console.log(
      `↻ Resuming forecast \`${eventId}\` (already ran ${state.round} round(s), P(YES)=${pct(state.currentProb)})`
    );
    if (!state.provider) state.provider = provider;
  } else {
    // Round 0 — frame the prompt before any forecasting.
    console.log(`✦ New forecast \`${eventId}\``);
    console.log(`  Prompt: ${args.question}`);
    console.log(`  Endpoint: ${process.env.ANTHROPIC_BASE_URL ?? "(default Anthropic)"}`);
    console.log(`\n▶ Round 0 — framing the question…`);
    const { framing, costUsd, priorSuspect } = await frameEvent(args.question, {
      userResolution: args.resolution,
      model: args.model
    });
    console.log(`  Question:   ${framing.normalizedQuestion}`);
    console.log(`  Resolution: ${framing.resolutionCriteria}`);
    if (framing.resolutionDate) console.log(`  By:         ${framing.resolutionDate}`);
    if (framing.settlementSource) console.log(`  Source:     ${framing.settlementSource}`);
    console.log(`  Prior:      ${pct(framing.priorProbability)} — ${framing.priorRationale}`);
    console.log(
      `  Audit:      confidence=${framing.framingConfidence}${framing.framingCaveats ? `; ${framing.framingCaveats}` : ""}`
    );
    if (costUsd != null) console.log(`  (framing cost $${costUsd.toFixed(3)})`);

    if (!framing.forecastable) {
      console.log(`\n■ This prompt is not forecastable as a clean binary event.`);
      console.log(`  Clarification needed: ${framing.clarificationNeeded || "(unspecified)"}`);
      console.log(`\n  Refine your prompt (or pass --resolution "...") and re-run.`);
      process.exit(2);
    }
    console.log(`\n▶ Focus Center — planning the research…`);
    const researchPlan = await createResearchPlan(framing, { model: args.model });
    console.log(`  Question type: ${researchPlan.archetype}`);
    console.log(`  Probability model: ${researchPlan.modelKind}`);
    console.log(`  Research priorities: ${researchPlan.focusAreas.map((x) => `${x.priority}:${x.id}`).join(", ")}`);
    console.log(
      `  Search breadth: at least ${researchPlan.minimumSearchQueries} distinct queries per round; quality-ranked sources only`
    );
    state = newForecastState({ eventId, eventText: args.question, framing, researchPlan });
    state.provider = provider;
    if (marketBlind()) {
      state.marketBlind = { enabled: true, blockedCount: 0, priorSuspect };
      if (priorSuspect) console.log(`  ⚠ prior rationale still reads market-price-anchored after re-audit — flagged`);
    }
    // Persist immediately: the framed question + prior are real progress a
    // watching UI can show while round 1 (minutes) runs.
    saveState(state);
  }

  const final = await runForecast(state, {
    maxRounds: args.maxRounds,
    model: args.model,
    onLog: (m) => console.log(m)
  });

  const dir = eventDir(final.eventId);
  console.log("\n──────────────────────────────────────────");
  // The band is an uncalibrated internal heuristic — logged for the audit
  // trail, never presented as a confidence interval (user decision 2026-07-02).
  console.log(
    `${incompleteResearch(final.status) ? "INCOMPLETE RESEARCH — PROVISIONAL P(YES)" : "FINAL P(YES)"} = ${pct(final.currentProb)}  (internal band ${pct(final.credibleInterval[0])} – ${pct(final.credibleInterval[1])})`
  );
  console.log(`Status: ${final.status}  ·  Rounds: ${final.round}  ·  Sources: ${final.evidenceLedger.length}`);
  if (final.researchBlocker) console.log(`Research incomplete: ${final.researchBlocker}`);
  if (final.summary?.verdict) console.log(`\n${final.summary.verdict}`);
  const totalCost = final.roundHistory.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  if (totalCost > 0) console.log(`Total round cost: $${totalCost.toFixed(3)}`);
  console.log(`\nTrace:  ${dir}/report.md`);
  console.log(`State:  ${dir}/state.json`);
}

main().catch((err) => {
  console.error(`\n✖ forecast failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
