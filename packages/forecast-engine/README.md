# Iterative Binary Forecaster (`packages/forecast-engine/src/`)

> 中文在下。An iterative, fully-traceable probability engine for binary (yes/no)
> events, driven by a user prompt. Built for predict-raven on the
> `feat/iterative-forecaster` branch.

## What it does

Give it a rough prompt for a future event. **Round 0** first *frames* it: the
agent turns the prompt into a precise binary question with explicit resolution
criteria, an inferred resolution date, and a settlement source — and if the
prompt is too vague to forecast, it says so and asks for clarification instead of
emitting a false-precision number. A **Research Focus Center** then decomposes the
question, chooses one probability model, sets at least six search directions, and
ranks the source classes worth pursuing. Each research round searches broadly,
tests the strongest countercase, and selects the best evidence.

The probability unit is an **atomic factual claim**, not a web page. One claim can
carry several ranked sources for corroboration or contradiction, but it receives
only one Bayesian log-odds update. The engine verifies each direct link against the
captured search trace, computes the cross-check status, and remains the only
authority allowed to set the probability. This prevents five rewrites of one story
from becoming five probability moves while keeping the entire decision auditable.

This is **not** the trading pipeline and has **no market dependency**: events come
from a prompt, not Polymarket; there is no price, edge, sizing, or order. It does
search the open web (market-blindness is intentionally not enforced here).

## Usage

```bash
# Endpoint is configured purely by env (no secret is committed).
ANTHROPIC_BASE_URL=<endpoint> ANTHROPIC_API_KEY=<key> \
pnpm forecast:event -- "Will Apple ship a foldable iPhone in 2026?" \
  --max-rounds 3
```

The agent infers the resolution and the resolution date itself (Round 0); pass
`--resolution "..."` only to pin an exact resolution (the framer keeps it).
Re-running the **same prompt** resumes the existing forecast and adds rounds
(prior sources are passed back as "do not re-count"). Pass `--fresh` to start
over.

Flags: `--resolution` (optional override), `--max-rounds N`, `--model <id>`,
`--fresh`.

Env: `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` (claude provider auth — optional
when the CLI is already logged in; see Providers), `ANTHROPIC_BASE_URL`,
`FORECAST_MAX_ROUNDS`, `FORECAST_MIN_ROUNDS` (convergence cannot stop the loop
before this many rounds; default 2), `FORECAST_MODEL`, `FORECAST_ALLOWED_TOOLS`
(default `"WebSearch WebFetch"`), `FORECAST_AGENT_TIMEOUT_MS`, `ARTIFACT_STORAGE_ROOT`.

## Providers

Every model call goes through the dispatch in `agent.ts`; the backend is chosen
by env (never hardcode keys):

- `FORECAST_PROVIDER=claude|deepseek` — default `claude` (Claude Code CLI with
  real WebSearch; the fabrication guard reconciles citations against the actual
  search trace). Auth, in the CLI's own precedence: `ANTHROPIC_API_KEY` (API
  billing), `CLAUDE_CODE_OAUTH_TOKEN` (long-lived subscription token from
  `claude setup-token` — the headless-server path), or the CLI's stored
  interactive login. No env var is required when the CLI is already logged in.
- `deepseek` — OpenAI-compatible HTTP (`deepseek-agent.ts`), **no web access**:
  the round prompt is reworded (own-knowledge research, no URL fabrication) and
  the fabrication guard degrades to a *citation liveness* check (a cited URL is
  "verified" unless it provably does not exist — 404/410 or unreachable host;
  anti-bot refusals like 403/429 count as live — weaker than trace membership).
  Requires `DEEPSEEK_API_KEY`; optional `DEEPSEEK_BASE_URL` (default
  `https://api.deepseek.com`), `FORECAST_DEEPSEEK_MODEL` (default
  `deepseek-chat`), and `DEEPSEEK_PRICE_IN_PER_MTOK` / `DEEPSEEK_PRICE_OUT_PER_MTOK`
  (both set => per-round `costUsd` is computed from token usage; else `null`).

## Output

Per forecast, under `runtime-artifacts/forecasts/<eventId>/`:

- `report.md` — decision-first report: result, resolution rules, Research Focus
  Center, one adopted model, ranked claims and direct source links, scenarios,
  monitoring triggers, information gaps, quality checks, and an audit appendix.
- `state.json` — machine state (resumable; persisted after every round).

## Architecture

```
cli.ts        parse args -> frame -> Research Focus Center -> runForecast -> summary
framing.ts    Round 0: normalize the prompt into a binary question + resolution
              criteria + resolution date + settlement source; flag if unforecastable
research-plan.ts  build the Focus Center: decomposition, search breadth, source order,
                  completion criteria, and the one adopted probability model
engine.ts     the round loop: prior-aware prompt -> agent -> validate ->
              claim/source verification -> claim dedupe -> Bayesian update -> persist
claims.ts     rank sources, score claim quality, and compute cross-check weights
claude-agent.ts  spawn `claude --print --output-format stream-json --verbose
                 --allowedTools WebSearch`; parse JSONL to capture the agent's
                 actual search queries + result URLs; runAgentRaw + validators
bayes.ts      logit / invLogit / applyLlrs (per-claim attribution) / clamps
store.ts      per-event state.json + report.md; eventId; canonical paths
summary.ts    final whole-forecast synthesis after the last round (explains the
              number — verdict + factors-for/against + uncertainties; never re-decides it)
url.ts        canonicalizeUrl — source-trace and direct-link normalization
types.ts      shared types + EventFraming + the agent round-output contract
forecast.test.ts  unit tests for the deterministic core (run with `pnpm test`)
```

The agent emits **structured JSON** per round (validated fail-closed — a malformed
round throws and retries once, never silently degrades to a guessed number). The
engine, not the agent, sets the probability: the agent proposes one signed
log-likelihood ratio per atomic claim, and the engine threads those claims through
log-odds space. Additional sources change verification quality, not update count.

## P0 risk mitigations (why it behaves)

- **No page-counting bias** — atomic claims are deduplicated across rounds. Several
  pages may verify one claim without creating several probability updates; repeated
  causal stories are still discounted by cluster.
- **No oscillation from re-picking** — continuity invariant: round *n* prior ==
  round *n-1* posterior; the agent moves *from* the supplied prior. Per-claim
  log-likelihood ratio
  magnitude is clamped (≤2 nats); probability clamped to [1%, 99%].
- **No fabricated citations** — every cited URL is reconciled against the agent's
  actual WebSearch result trace (from stream-json); unmatched URLs are flagged
  `⚠ not in trace` in the report.
- **Research breadth before convergence** — a web-enabled round must meet its Focus
  Center search minimum before a small net move can be called convergence. A hard
  `--max-rounds` cap still bounds cost.

## Known limitations / next steps

- **No automatic scoring (Brier/calibration)** — by design (per project decision);
  arbitrary prompt events have no settlement oracle. The state schema records
  enough (deadline, per-round history) to add resolution tracking later.
- **Binary only** — v1 scope. Multi-outcome / continuous would need a per-outcome
  probability vector and a different update.
- **Credible interval** — still a heuristic band, not a statistically calibrated
  interval; the report labels it accordingly.

---

## 中文说明

输入一个**事件 prompt**(可以比较粗)。**Round 0 先"框定"**:agent 把它归一化成一个清晰的
二元问题 + 结算标准 + 结算日期(自己推断)+ 结算来源;**如果问题太模糊没法预测,它会直接
指出并要求澄清,而不是硬给一个假精度数字**。随后先生成**研究焦点中心**：拆解问题、只选择
一个概率模型、规划每轮至少六个不同检索方向，并明确什么来源更值得优先找。每轮会先广搜，
再找原始来源、交叉核验关键事实、主动搜索最强反证，最后才甄选入账证据。

概率更新的单位改成了**一个可核验的原子事实断言**，不再是一张网页。一个断言可以有多条按
质量排序的支持或反驳来源，但只产生一次贝叶斯更新；额外来源只提高或降低交叉核验质量，
不会因为同一新闻被五家媒体转载就更新五次。概率只由引擎维护，研究模型不再输出第二个概率。

**与交易线无关、不依赖市场**:事件来自 prompt 而非 Polymarket,没有价格/edge/下单。会联网
搜索(此处不强制市场盲测)。

运行见上面 Usage。`--resolution` 是可选的(钉死结算口径),不传 agent 自己写;不再有
`--deadline`(结算日期由 Round 0 推断)。产物在 `runtime-artifacts/forecasts/<eventId>/`:
`report.md`(结论优先的完整报告，含焦点中心、来源排序、情景、监控指标和审计附录)+
`state.json`(可恢复的机器状态)。重复同一 prompt 会
**续跑加轮**,已计入的断言作为"不要重复计数"传回 agent。

关键防护:跨轮按事实断言**去重**、同一事实的多个来源只做核验、连续性不变量**防震荡**、
用真实搜索轨迹**核对信源防编造**、达到检索广度后才允许判定收敛、`--max-rounds` **封顶成本**。

局限:暂不自动打分(无统一结算源)、仅二元、置信区间仍是启发式。


## Personal subscription research / 个人订阅投研

Opt in with `FORECAST_SIGNAL_DESK=1` to route Claude/DeepSeek research through the local public-web + Signal Desk gateway. General searches query both sources; Markdown/PDF reads preserve provenance. Planning and summary stages with tools disabled load no MCP servers. The Codex provider explicitly rejects this mode until supported. See [runtime integration](../../docs/en/signal-desk-research.md).

设置 `FORECAST_SIGNAL_DESK=1` 后，Claude/DeepSeek 投研通过本机网关联合检索公开网页与个人订阅。规划、总结等禁止工具的阶段不会加载 MCP；Codex provider 暂未接入，会明确报错。全局默认关闭，不改变交易入口。详见[投研接入说明](../../docs/signal-desk-research.md)。
