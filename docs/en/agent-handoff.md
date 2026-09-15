# Agent Handoff — Current State and Next Actions

> Current state: research supports binary probabilities, mutually exclusive choices, numeric forecasts and independent event rankings while retaining the requested answer semantics. CLI/API/MCP/Raven research defaults to unlimited rounds; retrieval failure, insufficient evidence and budget exhaustion expose incomplete results and provisional estimates. The expanded library uses source discovery, actual body reads and material-gap follow-up searches. Material inline figures are selected for the current question and their visual observations are archived; the text-only DeepSeek route retains unread-image gaps. The public repository contains generic adapters only; subscription caches and credentials remain private. This release passed 386 engine/API/Raven tests, all three typechecks and the Raven production build. Twenty desktop/mobile page cases had no browser errors or horizontal overflow and received visual review. No new paid model research was run. See [runtime integration](signal-desk-research.md) and [release verification](../internal/review/2026-09-15-research-release.en.md).


> 2026-09-12: Signal Desk research was ported onto current main, preserving planning and claim cross-checking. `FORECAST_SIGNAL_DESK=1` enables combined public/subscription search and Markdown/PDF reading for Claude/DeepSeek. Tool-disabled stages load no MCP servers; Codex mode is explicitly unsupported. The private service/content stays local; this repository contains the adapter. See [integration](signal-desk-research.md).


> Last updated: 2026-09-15 by Codex.
>
> **Startup contract for a new agent: read only this file for current project state.** Do not replay dated handoffs or historical notes at startup. Consult git history, merged PRs, [`docs/internal/review/`](../internal/review/), or [`docs/agent-onboarding.md`](../agent-onboarding.md) only when background is needed.
>
> Chinese canonical version: [`docs/agent-handoff.md`](../agent-handoff.md). Both versions must be updated together; Chinese wins if they diverge.

## 1. One-minute status

- `origin/main` includes two 2026-08-29 safety fixes:
  - PR #133: Delta PM feed and sitemap stories converge on normalized URL identity, and Gate 1 records `fallbackReason`.
  - PR #134: Pulse no longer converts watch-only, nominal, no-trade, pass, or explicit `0%` recommendations into real-money entry plans; render-time parseability and the planner share the same guard.
- Forecast Engine research-quality phase one is on `main`: Research Focus Center, atomic factual claims, independent-origin groups, cross-checks, disconfirmation, one probability authority, and the Evidence Book.
- The Tokyo VM `instance-tokyo-0701-predict-raven` was stopped by GCE's maintenance control service on 2026-09-02. Its previous `onHostMaintenance=TERMINATE` and `automaticRestart=false` settings left `/live-predict-raven` on the August 5 baked fallback. The instance was restored at 2026-09-03 16:27 UTC and changed to `MIGRATE` with automatic restart; the authenticated, internet-reachable `/paper/snapshot` endpoint and production page now read the Tokyo paper book again. Paper evaluations now run once daily at `02:00 UTC` (`10:00` Singapore/China time).
- The primary worktree still contains uncommitted Raven Bench / `live-predict-raven` and forecast-provenance WIP. **Do not checkout, reset, or overwrite it. Continue new work in an independent worktree.**
- The latest Google Driver research deliverables are also not fully on `main`: `outputs/O1-forecast.{md,html}`, `outputs/M1-3M.{md,html}`, plus O1 multi-horizon, M1/C1, and TPU-primary-training research under `runtime-artifacts/google-driver-forecasts/`. Current adopted values are O1 **2% / 4% / 10% / 24%**, M1 **31.0%**, and five-lab TPU primary training **4%**. Do not rerun or overwrite them before the owner session saves its work.
- `codex/harness-gpt-pro-v2`, old `codex/harness-gpt-pro`, `codex/futurex-raven-adapter`, `feat/raven-delta-longport-mcp`, and `claude/agent-prediction-market-demo-74e018` contain value pending extraction. Do not delete them before the extractions below are complete.
- Raven Managed and rough-loop were removed from the mainline. Do not revive them from stale documentation.

## 2. Current product surfaces

| Product | Entry point / code | State |
| --- | --- | --- |
| Forecast Engine | `packages/forecast-engine`, `apps/raven`, `/engine` | Core mainline; claim-level research phase one complete |
| Forecast API + MCP | `services/forecast-api` | JSON / text / PDF output and MCP tools available |
| Paper Agent | `services/paper-agent`, `/live-predict-raven` | Simulation only; no private key or real order endpoint |
| Delta PM | `services/delta-pm`, `apps/delta-pm-console`, `/live-delta-pm` | News → importance → priced-in → paper-decision audit chain |
| Raven Delta | `apps/raven-delta`, `/delta` | US-equity news-impact analysis with email / WebSocket delivery |
| World Cup blind forecast | `scripts/world-cup`, `apps/web/app/world-cup` | Generation may not read prices; post-hoc scoring may use a market benchmark |
| AI investment research cases | `apps/web/app/[locale]/investment-analysis`, `/investment-analysis` | Four public cases: Tencent, Hassabis, Meta and [GPT-6 Sol naming](https://forecasting-agent.com/investment-analysis/openai-gpt6-sol), with private report feedback |
| Polymarket live pipeline | `services/orchestrator`, `services/executor` | Real-money path; live runs, risk changes, and order probes require explicit user approval |

Investment reports show current conclusions, reasons, scenarios and gaps. Revision numbers, probability trajectories and feedback receipts remain internal. Sol naming is estimated at 70% conditionally and 50% for the strict 6.0 six-month event, as of September 15. Naming history and arguments remain. Report iframes omit `sandbox`, preserving scripts and downloads.

Native feedback continuation supports all four answer types. Public `report.md` shows current state; `audit.md` preserves internal history. See [feedback usage](report-feedback.md).

POST `/api/investment-analysis/feedback` persists submissions to private Vercel Blob. Authenticated GET using `REPORT_FEEDBACK_ADMIN_TOKEN` exports stable-ID `notes`. Anonymous submissions save unverified leads and do not start paid research. The production `web` project uses `BLOB_READ_WRITE_TOKEN`; never commit secrets. Personal `scripts/report_feedback.py` exports notes, and `scripts/research.py forecast --resume-run … --feedback-file … --additional-rounds …` reuses native state. Synthesized report filenames are not native run IDs. The user expressly skipped UI checks; validation uses builds, functional tests and live API persistence/retrieval.

## 3. Primary technical WIP: GPT Pro v2 harness

Worktree: `/Users/Aincrad/dev-proj/predict-raven-harness-gpt-pro-v2`; branch: `codex/harness-gpt-pro-v2`. Most value is uncommitted worktree state, not the branch tip.

In progress:

- direct OpenAI and OpenRouter Responses providers;
- explicit GPT Pro opt-in, optionally scoped to `forecast_round` while cheaper modes handle framing and summary;
- an `organization` research profile with driver → mechanism → observable-evidence trees, horizon curves, sensitivity analysis, and next research actions;
- provider / reasoning / profile wiring through CLI, Raven API, Hosted Forecast API, and MCP;
- secret-safe provenance: requested/actual model, reasoning mode/effort, tokens, searches, cost, upstream provider, and prompt SHA-256.

Required before merge:

1. Fix blank pricing env values being interpreted by `Number("")` as `0`, which can falsely report complete `$0` cost.
2. Port provider-failure persistence, secret-redaction, and requested-vs-actual provenance tests from old `codex/harness-gpt-pro`.
3. Preserve Claude cache-token, WebFetch, runtime-version, turn-count, and measured/priced-call telemetry.
4. Reconcile the primary worktree's provenance WIP, then organize small reviewable commits from current `main`; do not merge the old harness branch wholesale.
5. OpenRouter is a paid external provider. A real paid smoke requires separate user approval.

## 4. Three independent product directions

These are independent products. Do not bundle them into the GPT Pro provider PR or one large branch merge.

### A. FutureX benchmark adapter

- Existing prototype: `codex/futurex-raven-adapter`.
- Already built: strict FutureX parsing and Yes/No / A/B adaptation; a 12-question binary runner; multiple model profiles; token / cost / latency tracking; shard merge; PDF report; official `{id,prediction}` JSONL export; dry-run by default with paid calls gated by `--allow-paid`.
- Current gaps: it targets an older forecast-engine and would overwrite the current claim/source-group semantics; cutoff is prompt-only rather than a deterministic future-information filter; the report contains pilot-specific constants; A/B statistics and shard-consistency checks need fixes.
- Product decision: if FutureX is ongoing, rebuild adapter / runner / submission on current `main`. If it was a one-off pilot, archive and delete instead of merging.

### B. Raven Delta LongPort MCP

- Existing prototype: PR #84 / `feat/raven-delta-longport-mcp`.
- Already built: live quotes, candles, order book, valuation, and fundamentals for Raven Delta; disabled by default; `0600` temporary MCP config; token redaction; a read-tool list plus known trading-tool denylist; evidence instructions requiring quote timestamps.
- Current gaps: the branch conflicts with `main`; Claude `--allowedTools` is not a strict sole authorization boundary; `longport:live` currently proves configuration, not a successful quote call; the UI may still say that no live prices are used.
- Product decision: rebuild only if `/delta` still needs live-price grounding. Require quote-only credentials, isolated global permissions, actual `tools/list` inventory validation, unknown-tool fail-closed behavior, and execution traces before marking a result live.

### C. Time Machine / forecast trajectory contracts

- Existing prototype: uncommitted state in `claude/agent-prediction-market-demo-74e018`.
- Already built:
  - `forecast-case`: one event, repeated forecasts, evidence / tool calls, probability changes, position lifecycle, and settlement;
  - `forecasting-trajectory`: account-level research → forecast → trade → settlement → equity timeline;
  - Zod invariants for event order, unique IDs, and probability-delta consistency, with provider raw reasoning / hidden chain-of-thought explicitly forbidden.
- Current gaps: no production producer or consumer exists; exporters reconstruct data from static HTML and archives; root HTML, `.tmp-*` JSON, and hand-built demos do not belong on `main`.
- Product decision: after committing to Time Machine, a unified audit API, or a benchmark data layer, extract only the two contracts plus tests and define the real producer and consumer first.

## 5. Next priorities

### P0 — Protect and close current WIP

- [ ] Let the current Raven Bench / provenance session save its primary-worktree changes; do not overwrite them from another worktree.
- [ ] Use `harness-gpt-pro-v2` as the sole GPT Pro integration line, complete the five prerequisites in section 3, and open a focused PR.
- [ ] Raven Bench's primary score is **Brier Index**: `100 × (1 − √mean Brier)`. Compute mean Brier across questions before conversion. Rankings must also show completion count, confidence interval, latency, round wall-clock time, dollar cost, and tokens; never sum parallel-arm durations and present them as actual wait time.

### P1 — Forecast Engine phases two and three

- [ ] Add joint multi-horizon forecasts with monotonicity checks, leave-one-evidence-cluster-out sensitivity analysis, true delta updates, and research-budget allocation.
- [ ] Build settlement and offline evaluation: Brier, calibration curves, posterior source/claim-weight tuning, and monitoring adapters for common settlement sources.
- [ ] Make independent go/archive decisions for FutureX, LongPort MCP, and Time Machine. Any approved direction starts as its own small PR from current `main`.

### P2 — Known, non-blocking

- [ ] Two fixed-date `paper-agent` tests in `market-scan.test.ts` expired on 2026-09-01 and now fail CI; both the tests and implementation match the pre-publication baseline. Pin the test clock in a follow-up without changing the actual expiry filter to satisfy fixtures.

- [ ] The Tokyo VM root disk is 82% used (about 8.6 GiB free). Keep monitoring it and perform recoverable cache / old-image cleanup before the next image deployment.
- [ ] Redesign live Pulse settlement backfill / offline scoring against the current ledger; do not raw-port PR #77.
- [ ] Fix `scripts/world-cup/deploy-web.sh` promotion output parsing for the newer Vercel CLI.
- [ ] The World Cup Monte Carlo knockout shootout rule has a confirmed bias; recalculation and republication require a user product decision.

## 6. Settled rules — do not reopen

- Forecast Engine owns the one probability. Research agents do not emit a second holistic probability.
- GPT Pro is not a separate model slug: use `gpt-5.6` / the resolved model and explicitly set `reasoning.mode=pro`; archive model, mode, and effort separately.
- World Cup / market-blind generation may not read market prices. Post-settlement evaluation may use the prediction-time market benchmark.
- Delta PM story identity is determined by first ownership plus normalized URL. Duplicate sitemap/feed arrivals do not rerun gates.
- Watch-only, nominal, no-trade, pass, and explicit `0%` Pulse recommendations never create a new entry.
- Real-money actions are irreversible by default. Without explicit approval, stay recommend-only / read-only.

## 7. Safety and execution boundaries

- `pnpm daily:forecast` / `pnpm forecast:live` may place real orders by default. Read-only work must explicitly use `--recommend-only`.
- The default wallet config is `.env.pizza`. Never upload `.env*`, private keys, or API keys.
- Risk defaults may be discussed, but an agent may not loosen, bypass, or rewrite them without approval.
- Concurrent agents / sessions require independent git worktrees. Never checkout / stash / reset a dirty primary worktree.
- LongPort, OpenRouter, FutureX paid runs, and any real-money probe each require their own explicit approval. Approval for one does not authorize the others.

## 8. Read only when needed

| Need | Read |
| --- | --- |
| Full risk controls | [`docs/risk-controls.md`](../risk-controls.md) |
| Commands, deployment, dependency matrix | [`docs/diagrams/dev-reference.md`](../diagrams/dev-reference.md) |
| Delta PM operations | [`docs/delta-pm-operations.md`](../delta-pm-operations.md) |
| Forecasting cost profile | [`docs/diagrams/forecasting-cost-profile.md`](../diagrams/forecasting-cost-profile.md) |
| Historical design / review | [`docs/internal/review/`](../internal/review/) and [`docs/internal/plan/`](../internal/plan/) |
| Completed history | git log, merged PRs, `docs/archive/` |

## Maintenance rules

- Keep this file to current state and unfinished actions, targeting roughly 150 lines or fewer.
- At wrap-up, **update sections in place**. Do not prepend another dated session diary.
- Remove completed items. Preserve worthwhile process detail in commits, PRs, or `docs/internal/review/`.
- Update the Chinese canonical file and this mirror together.
