# General Collaboration Rules (Team Template)

> **Sync rule:** If a repository keeps both `CLAUDE.md` and `AGENTS.md`, the two files must stay aligned. Keeping only one is also acceptable, but do not leave them diverged for long.

Chinese version: see [`/CLAUDE.md`](../../CLAUDE.md).

Last updated: 2026-06-12

## 0. Scope

- This is a reusable cross-project collaboration baseline for most software, automation, data, and frontend work.
- Project-specific content goes at the bottom of this file under "## Project Execution Notes," or in a separate `project-rules.md`. Project rules should be "executable constraints + a date," not background prose.
- If rules conflict, the default priority is:
  - the user's explicit request in the current task
  - project-specific addendum (the "Project Execution Notes" at the bottom)
  - this general template

## 1. Language and Documentation

- Code comments must be in English.
- Human-facing Markdown defaults to Chinese, with an English copy (`*.en.md` or under `docs/en/`).
- Chinese keeps the primary filename; English uses `*.en.md`.
- If the Chinese and English versions diverge, the Chinese version is the source of truth and the English version must be brought back into alignment quickly.
- Any update to human-facing docs should update both language versions together.
- If one iteration can only update one language first, mark the file clearly as "translation pending" and complete the sync before handoff.

## 2. Terminal Interaction and Progress Visibility

- Every critical workflow must print visible stage output in the terminal.
- Long-running tasks must emit heartbeat progress updates: current stage, elapsed time, remaining time or timeout signal if available.
- Background jobs and sub-agents are allowed to do heavy work quietly, but the main session must keep visible progress flowing to the user.
- Terminal output should preferably be colorful and leveled (`INFO/WARN/ERR/OK`).
- Errors must be actionable and should preferably be archived under `run-error/<timestamp>-<reason>/`, including at least: failure stage, key context, concise cause, next command(s) or recovery action.
- If the task produces logs, reports, or artifact directories, print the important paths at the end.

## 3. Communication Style and Human Review Entry Point

- Default to language that a normal product manager can understand; do not hide behind jargon or buzzwords.
- Necessary technical terms get a first-mention explanation: what they mean and what they affect.
- Every substantive reply or progress update should **start with a human review entry point**: 1-5 concrete files / routes / commands / sections most worth manual review, before any abstract summary.
- Right after the review entry point, explain what was changed and the effect of the change.
- When describing a plan, answer these four things first: what the problem is / what it affects / how it will be handled / what the user needs to decide.
- If model, reasoning, infrastructure, deployment, or execution details matter, give the plain-English conclusion first and technical detail second.
- Avoid reporting nouns without a conclusion. "Framework / loop / pipeline / enablement" are not answers by themselves.

## 4. Collaboration and Delegation Baseline

- Default flow: the main session decomposes the task, decides "what is the most blocking thing the main session itself should drive right now," and delegates parallelizable parts to sub-agents.
- The main session owns goal alignment, dependency handling, integration, external communication, and final acceptance.
- Unless a task is tiny, strictly serial, or involves high-risk permission ops, do not pile every heavy step onto the main session.
- The agent should make low-stakes decisions on its own and keep iterating + testing until the issue is genuinely resolved; do not bounce obviously inferable choices back to the user.
- When blocked, classify whether the issue is code, environment, external service, permission boundary, or your own over-cautious judgement — then decide the next step.
- Stop and ask the user only when external permissions, irreversible risk, cost/safety/production impact, or genuine product-goal ambiguity is involved.
- Save in-progress work periodically with timestamps; do not wait until the entire task is done to flush state.
- If more than `12h` has passed since the last saved or pushed checkpoint, prioritise saving a usable update before continuing the long task.

## 5. Sub-agent Usage Rules

- Only split when the task has obvious parallelizable subproblems (implementation vs tests, cross-module independent edits, code change vs reference look-up).
- Do not split small / tightly-coupled / continuous-context tasks.
- Do not split first when high-risk operations are involved (production data changes, permission changes, deletions, fund operations, public releases) — those default to the main session.
- Before splitting, the main session defines each sub-agent's goal / ownership / inputs and outputs / success criteria.
- Parallel only works when sub-tasks have low dependencies, clear interfaces, and isolatable change surfaces; if a prerequisite result will reshape later work, run them serially.
- Before parallel execution, the main session establishes shared constraints: data structures, naming, interface contracts, directory layout, which shared files may be touched.
- Sub-agents stay within their ownership; cross-boundary changes must be raised to the main session, not "fixed in passing."
- Sub-agent reports must be merge-ready units: what was done / which files or logic were affected / current status / blockers / impact on parallel work.
- When two sub-agents conflict on the same file / interface / behaviour, the main session arbitrates; sub-agents must not overwrite each other.
- Main session must take over when: sub-tasks deadlock / shared abstraction needs change / root cause diverges from the original split / cross-module architecture trade-off needed.
- Pause and ask the user when: goal is unclear / irreversible op required / behaviour the user explicitly specified would change / new external dependency or permission needed / clear cost/safety/production risk.
- Final integration is the main session's job and is not further delegated: unify behaviour, resolve conflicts, verify the original goal is met.
- At task end, leave a minimal traceable record: who owned what, which conclusions were adopted, which approaches were dropped, what residual risk remains.

## 6. Execution Safety and State Consistency

- Every critical execution prints the current `execution mode` (`inspect / dry-run / live / migration / release`) plus the decision source (human / script / AI).
- Silent degradation or quiet fallback after a critical check fails is not allowed.
- When internal limits, external thresholds, missing permissions, or environment conditions guarantee failure, warn explicitly and surface both the internal and external constraints.
- Single state source; whenever environment / account / wallet / dataset / working directory / state file is involved, print the value actually in use.
- **Concurrent sessions / agents on the same repo must each use a separate git worktree** (learned the hard way on 2026-06-14): never run `git checkout` / `stash` / `reset` from multiple Claude sessions in the same working directory — they clobber each other's working tree and drop uncommitted changes. Before starting, confirm you own the working directory exclusively, or `git worktree add ../<name> -b <branch>` into an isolated directory first.
- If environment / account / multi-state-file mixing is detected, warn and suggest a fix.
- Fallback configuration must be clearly labelled as fallback, never disguised as live truth.
- For user-visible critical changes, do not declare success based on exit code alone; verify real behaviour matches expectations.

## 7. Traceable Artifacts

- All critical runs must produce traceable artifacts: preflight, input parameters, recommendations, execution results, error info, summary reports.
- On failure, preserve intermediate artifacts (checkpoint, temp files, provider output, log fragments) for resume or post-mortem.
- After every run, print the archive directory and key file paths.
- Content meant to explain or document for users (flowcharts, FAQs, key mechanism notes, retros) goes under `docs/diagrams/`.
- `docs/` files follow the same bilingual rule: Chinese primary `*.md` + English mirror under `docs/en/` or `*.en.md`.
- Working logs and retros live in their own directory; do not pile them into `CLAUDE.md` / `AGENTS.md`.

## 8. Deployment and Release Verification

- For external deployment, release, or environment switches, do not declare success purely on a green CLI exit, URL, or log; perform real acceptance.
- After every public deployment, the main session must at minimum:
  - open the actual deployed result or target service
  - capture screenshots or visible evidence
  - compare the live result against the local target version or user reference
  - verify the target API, key data path, or core user flow is healthy
- If the homepage or the target view is already a full styled page, also confirm the layout / shell is not still wrapping a legacy frame, so the new and old pages do not stack.
- Do not tell the user "this matches local" before doing real online verification.

## 9. Visual Acceptance for Frontend / Design Work

For any user-visible change, close out with: **screenshot → read the image → self-review**.

- Screenshot: capture the changed page and affected neighbours with a headless browser (`scripts/visual-qa.mjs` exists — pass a url list + an output dir; the tool itself is not mandatory). Desktop + mobile viewports recommended.
- Read: actually load the PNGs with the Read tool — do not judge by file paths.
- Self-review: layout intact, no text overflow, interactions work; **any console error / pageerror means the task is not done — fix first**.
- Sub-agents doing frontend work follow the same loop and include screenshot paths + self-review in their reports.

**Whenever you change any user-visible page in `apps/web` (mandatory trio):**

- **i18n**: all user-facing copy goes through i18n (fill in `en` / `zh-CN` / `zh-TW` under `apps/web/lib/world-cup/messages/`; put new strings in the message resources, never hardcode; `zh-TW` is generated — update the generator when needed).
- **Mobile**: adapt and self-review on both desktop and mobile viewports (layout intact, no overflow, interactions work).
- **Auto-publish**: merging to `main` triggers a GitHub→Vercel auto-deploy (currently to the `autopoly-pizza-spectator` project, to be folded into `forecasting-agent.com` later; `forecasting-agent.com` itself is the separate `web` project, currently a manual deploy). Either way, before merging a local `pnpm --filter @autopoly/web build` must pass plus a desktop/mobile screenshot self-review — never ship a broken build to production. ⚠️ **Use `build`, NOT `exec next build`** — the latter skips prebuild (which builds `@autopoly/contracts/db/norns`), so it fails in a fresh worktree with `@autopoly/*` not found. **Prereqs: Node ≥20 (repo ships a `.nvmrc`, run `nvm use`); in a fresh worktree run `pnpm install` first.**
- **PR merge lanes**: for changes to the **public World Cup site (`apps/web`, non-trading path)** and **docs / i18n only** — if the local build passes, desktop/mobile self-review is OK, and the change stays within the PR's scope, you may open AND merge the PR without per-change confirmation. For anything touching the **trading / executor / risk-control params / secrets / market-blind or other policy / any irreversible or money-related operation** — always stop and confirm with the user.

---

## Project Execution Notes (predict-raven specific)

> ⚠️ **This is a real-money live trading project.** Every `forecast:live` run places real, irreversible orders on Polymarket.

### 30-second must-read

- **Live by default**: `pnpm daily:forecast` / `pnpm forecast:live` places real orders. To inspect without trading, explicitly pass `--recommend-only` or say so in the prompt.
- **Default wallet**: `.env.pizza`. Preflight prints the current wallet address + collateral and aborts on mismatch; switch ad-hoc with `ENV_FILE=.env.<name>`. Deployment/wallet details: [`docs/diagrams/dev-reference.en.md`](../diagrams/dev-reference.en.md).
- **Risk caps are env-tunable defaults, not a constitution**: per-trade ≤ 15% / total exposure ≤ 80% / per-event ≤ 30% / max 22 positions / min $5. When a more aggressive or conservative profile would serve better, **proactively propose retuning to the user** (see `.env.example` for the knobs); any change requires user confirmation and lands in env — the agent never edits parameters unilaterally and never bypasses the executor-layer trimming.
- **Probabilities that orders rely on must come from the forecasting pipeline** (commands are `forecast:*`; the old `pulse:*` names remain as compatibility aliases) with archives (`recommendation.json` / report markdown / evidence artifacts). Quick conversational estimates are allowed but must be labelled "not a trading basis". Position reviews: `ENV_FILE=.env.pizza pnpm forecast:positions -- --json`; new opportunities: `pnpm forecast:recommend`.
- **Position exit rule: sell when net edge is negative.** If the review's fee-adjusted edge is < 0, reduce/close — no extra "contradicting evidence" needed; stop-loss keeps top priority.
- **World Cup forecasting product = forecast-blind (user decision 2026-06-11)**: the forecast *generation* path may never read or cite market prices / implied probabilities to form a forecast; the pipeline uses market data only for event structure and settlement mapping (see `stripPrices` in `scripts/world-cup/`). **Refinement (user decision 2026-06-19)**: the `/world-cup/performance` (预测效果) page is an explicit *post-hoc benchmark* — it MAY display Polymarket's prediction-time implied probabilities and derive Mock PNL / Brier skill ("相对市场水平") / calibration ECE from them. That grades the blind forecasts after the fact; it does not feed forecast generation, so it does not break the blind rule. Prediction-time prices are captured once by `scripts/world-cup/fetch-baseline-prices.ts` and recomputed daily by `build-performance.ts`.
- **Forecasting time / token costs are measured, not folklore**: see [`docs/diagrams/forecasting-cost-profile.en.md`](../diagrams/forecasting-cost-profile.en.md) (a live run ≈ 12–15 min, rendering is ~95% of it, a silent 0-byte stretch under 5 min is normal). Append fresh numbers after every session.

### Key paths

| Topic | File |
| --- | --- |
| **Only status entry point for a new session** — current state + TODOs (updated in place at wrap-up) | [`docs/en/agent-handoff.md`](agent-handoff.md) |
| Historical / environment background (on demand, not startup reading) | [`docs/en/agent-onboarding.md`](agent-onboarding.md) |
| Full risk-control rules | [`docs/risk-controls.en.md`](../risk-controls.en.md) |
| Forecasting cost profile | [`docs/diagrams/forecasting-cost-profile.en.md`](../diagrams/forecasting-cost-profile.en.md) |
| Command cheatsheet / deployment / dependency matrix | [`docs/diagrams/dev-reference.en.md`](../diagrams/dev-reference.en.md) |
| Launch-page front-end style sample (default for public metrics pages) | [`docs/diagrams/dashboard-style-reference.en.md`](../diagrams/dashboard-style-reference.en.md) |
| Wallet & account setup (4 fields) | README "Wallet and Account Setup" section |
| Live run summary archive | `runtime-artifacts/pulse-live/<ts>-<runId>/run-summary.md` |
| Forecasting AI reasoning report | `runtime-artifacts/reports/pulse/YYYY/MM/DD/pulse-*.md` |

### Wrap-up rituals

- Update current state and P0/P1/P2 in [`docs/en/agent-handoff.md`](agent-handoff.md) in place; remove completed items instead of prepending dated session diaries.
- Update immediately when the user says "记一下" / "save this" / "update handoff" — do not wait until wrap-up.
- Keep the handoff doc tight (target roughly 150 lines or fewer): actionable, not a running log; details belong in git history, PRs, or `docs/internal/review/`.

> **Current P0 / P1 / P2 TODOs all live in [`docs/en/agent-handoff.md`](agent-handoff.md)** — this section no longer maintains its own task list to avoid two-source drift.


### Research answers and the expanded resource library (2026-09-13)

- Preserve the requested answer space: binary probability, exclusive option distribution, numerical value/score, or per-entity event ranking. Do not normalize events that may co-occur, rewrite “most likely” as “first,” or disguise scores as probabilities. See [answer types](forecast-answer-types.md).
- Research calls Geoscope / Signal Desk the “expanded resource library”; technical tool identifiers remain compatible. Personal research must actually search and read it, cover every compared entity, and use relevant quotations as evidence or counterevidence. Explain specific exclusions and record failed attempts/coverage gaps without inventing usage.
- The personal workflow enables `FORECAST_REQUIRE_EXPANDED_LIBRARY=1` with the gateway. Never copy personal subscription bodies, keys or caches into shared repositories/servers. Distinguish official facts, author opinion, sell-side forecasts and model estimates; preserve short quotes, attribution, dates and sources. A summary is not a PDF.
