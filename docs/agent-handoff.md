# Agent Handoff — 当前状态与下一步

> 当前新增工作：原生多种答案形式及个人扩展资源库已接入。初轮改为跨公司、跨作者广收集并实际读取 PDF；研究轮和总结的关键疑问会触发回搜，未解决问题阻止数值收敛，仍遵守总轮次预算。详见[答案形式](forecast-answer-types.md)。M7 补证与私人原文仅在个人工作区；引擎/API 331 项测试、三处类型检查通过；私人网关 47 项测试通过，真实初轮与定向回搜验收留私人工作区。


> 2026-09-12：Signal Desk 研究网关已迁入最新 main，保留现有研究规划／证据交叉核验。`FORECAST_SIGNAL_DESK=1` 为 Claude/DeepSeek 启用公开＋订阅搜索和 Markdown/PDF 读取；禁用工具的阶段不加载 MCP，Codex 模式暂报不支持。私有服务和材料留在个人工作区，公开仓库仅有适配器。见 [接入说明](signal-desk-research.md)。


> 最后更新：2026-09-06 by Codex。
>
> **新 agent 的启动约定：只读这份文件了解项目当前状态。** 不要在启动时读取旧 handoff 或按日期回放历史；需要背景时再查 git log、PR、[`docs/internal/review/`](internal/review/) 或 [`docs/agent-onboarding.md`](agent-onboarding.md)。
>
> 英文镜像：[`docs/en/agent-handoff.md`](en/agent-handoff.md)。中文为准，中英必须同步更新。

## 1. 一分钟现状

- `origin/main` 当前包含两项 2026-08-29 安全修复：
  - PR #133：Delta PM 的 feed / sitemap 新闻按标准化 URL 归并，并记录 Gate 1 的 `fallbackReason`。
  - PR #134：Pulse 不再把“观望 / 名义侧 / 不参与 / no-trade / pass”或明确 `0%` 仓位转换成真钱 entry plan；render-time parseability 与 planner 使用同一安全判断。
- Forecast Engine 第一阶段研究质量改造已进入 `main`：Research Focus Center、原子事实断言、独立来源组、交叉核验、反证搜索、单一概率权威和 Evidence Book 都已落地。
- 东京 VM `instance-tokyo-0701-predict-raven` 在 2026-09-02 被 GCE 维护控制服务停止；原配置 `onHostMaintenance=TERMINATE` 且 `automaticRestart=false`，导致 `/live-predict-raven` 回退到 8 月 5 日内置快照。实例已在 2026-09-03 16:27 UTC 恢复，调度改为 `MIGRATE` + 自动重启；公网 `/paper/snapshot` 与线上页面均已恢复读取东京模拟盘。模拟盘评估现为每日一次，固定在 `02:00 UTC`（新加坡/北京时间 `10:00`）。
- 主工作区仍有未提交 WIP，涉及 Raven Bench / `live-predict-raven` 与 forecast provenance。**不要在主工作区 checkout、reset 或覆盖这些文件；新任务继续使用独立 worktree。**
- 主工作区的最新 Google Driver 研究交付也尚未全部进入 `main`：`outputs/O1-forecast.{md,html}`、`outputs/M1-3M.{md,html}`，以及 `runtime-artifacts/google-driver-forecasts/` 下的 O1 多期限、M1/C1 与 TPU 主训研究。当前采用口径是 O1 **2% / 4% / 10% / 24%**、M1 **31.0%**、五家 lab TPU 主训 **4%**；不要在 owner 会话保存前重跑或覆盖。
- `codex/harness-gpt-pro-v2`、旧 `codex/harness-gpt-pro`、`codex/futurex-raven-adapter`、`feat/raven-delta-longport-mcp` 和 `claude/agent-prediction-market-demo-74e018` 包含待提取价值，完成下述提取前不要清理。
- Raven Managed 与 rough-loop 已从主线删除；不要依据旧文档复活它们。

## 2. 当前产品面

| 产品 | 当前入口 / 代码 | 状态 |
| --- | --- | --- |
| Forecast Engine | `packages/forecast-engine`、`apps/raven`、`/engine` | 核心主线；claim-level 研究第一阶段完成 |
| Forecast API + MCP | `services/forecast-api` | 已提供 JSON / text / PDF 与 MCP 工具 |
| Paper Agent | `services/paper-agent`、`/live-predict-raven` | 模拟盘；不持有私钥、不发真实订单 |
| Delta PM | `services/delta-pm`、`apps/delta-pm-console`、`/live-delta-pm` | 新闻→重要性→priced-in→纸面决策审计链 |
| Raven Delta | `apps/raven-delta`、`/delta` | 美股新闻影响分析、邮件 / WebSocket 推送 |
| World Cup blind forecast | `scripts/world-cup`、`apps/web/app/world-cup` | 预测生成严禁读取市场价格；事后评分可使用市场基准 |
| AI 投研系统案例 | `apps/web/app/[locale]/investment-analysis`、`/investment-analysis` | 三份公开案例：腾讯混元 × WorkBuddy、Hassabis × Alphabet、[Meta 半年资本开支](https://forecasting-agent.com/investment-analysis/meta-capex-6m)（v5，截点 2026-09-06） |
| Polymarket live pipeline | `services/orchestrator`、`services/executor` | 真钱路径；任何 live 命令、风控调整或订单测试都需要用户明确确认 |

后续投资资料统一去除客户品牌标签。Meta v5 增加“我们判断”的立场，以多个内部业务需求、资源重配、融资缓冲解释预算支撑，单列六类产出与预算申请证据，并解释交付/付款跨年。恢复首次次年预算与上年最终指引或实际值分别比较的原规则，主概率由 32% 调至 34%（范围仍 20–45%）；约 2 个百分点为新增事件差集的主观估计，不是新证据权重。公开摘要与审计附件，完整字幕留在本地。本站报告 iframe 统一不设置 `sandbox`，脚本与附件下载保持可用。

## 3. 当前最主要的技术 WIP：GPT Pro v2 harness

工作区：`/Users/Aincrad/dev-proj/predict-raven-harness-gpt-pro-v2`，分支 `codex/harness-gpt-pro-v2`。目前价值主要在未提交 worktree，不在 branch tip。

正在实现：

- direct OpenAI 与 OpenRouter Responses provider；
- GPT Pro 显式 opt-in，并可只在 `forecast_round` 使用 Pro，其他阶段使用普通模式控制成本；
- `organization` research profile：驱动因素→机制→可观察证据、期限曲线、敏感性分析和下一步研究动作；
- CLI、Raven API、Hosted Forecast API、MCP 的 provider / reasoning / profile 接线；
- secret-safe provenance：requested/actual model、reasoning mode/effort、token、搜索次数、成本、上游 provider 和 prompt SHA-256。

合入前必须完成：

1. 修复空价格 env 被 `Number("")` 解释为 `0`、进而错误标记“成本完整且为 $0”的问题。
2. 从旧 `codex/harness-gpt-pro` 移植 provider 失败留档、secret redaction、requested/actual 分离等 provenance 测试。
3. 保留 Claude 的 cache token、WebFetch、runtime version、turn count、measured/priced call 等 telemetry。
4. 与主工作区现有 provenance WIP 对齐后，从最新 `main` 整理成可 review 的小提交；不要整体合并旧 harness 分支。
5. OpenRouter 是付费外部 provider；真实 paid smoke 必须另行获得用户授权。

## 4. 三个独立产品方向

这三项彼此独立，不应塞进 GPT Pro provider PR，也不应作为一个大分支整体合并。

### A. FutureX benchmark adapter

- 现有原型：`codex/futurex-raven-adapter`。
- 已完成：FutureX 题目严格解析与 Yes/No / A/B 适配；12 道二元题批量 runner；多模型 profile；token / cost / latency 统计；分片合并；PDF 报告；官方 `{id,prediction}` JSONL submission；默认 dry-run，只有显式 `--allow-paid` 才允许付费运行。
- 当前问题：基于旧 forecast-engine，直接合并会覆盖新的 claim/source-group 研究语义；历史 cutoff 只进 prompt、没有确定性阻止未来信息；报告仍写死 pilot 数据；A/B 统计和 shard 一致性校验有缺口。
- 下一步产品判断：如果 FutureX 会长期使用，从最新 `main` 重写 adapter / runner / submission；如果只是一次性 pilot，则归档后清理，不进主线。

### B. Raven Delta LongPort MCP

- 现有原型：PR #84 / `feat/raven-delta-longport-mcp`。
- 已完成：给 Raven Delta 的分析器提供实时报价、K 线、盘口、估值与基本面读取工具；默认关闭；临时 MCP 配置权限 `0600`；token 脱敏；读工具清单与已知交易工具 denylist；要求 evidence 带报价和时间戳。
- 当前问题：分支已与 `main` 冲突；Claude `--allowedTools` 不是严格的唯一安全边界；`longport:live` 目前只表示配置开启，不能证明真实工具调用成功；UI 仍可能显示“无实时价格”。
- 下一步产品判断：只有继续维护 `/delta` 的实时行情 grounding 才重做。必须使用 quote-only 凭证、隔离全局权限、校验实际 `tools/list`、未知工具 fail closed，并以 execution trace 证明成功读价后才标记 live。

### C. Time Machine / forecast trajectory contracts

- 现有原型：`claude/agent-prediction-market-demo-74e018` 的未提交 worktree。
- 已完成：
  - `forecast-case`：一个事件、多轮 forecast、证据 / tool calls、概率变化、仓位生命周期与结算；
  - `forecasting-trajectory`：账户级 research→forecast→trade→settlement→equity 时间线；
  - Zod 校验覆盖事件顺序、唯一 ID、概率 delta 一致性，并明确禁止保存 provider raw reasoning / hidden chain-of-thought。
- 当前问题：还没有正式 producer / consumer；现有 exporter 从静态 HTML 和重建 archive 取数；根目录 HTML、`.tmp-*` JSON 和手工 demo 不适合进入 `main`。
- 下一步产品判断：确认要做 Time Machine、统一审计 API 或 benchmark 数据层后，只提取两个 contract + tests，并先定义真实生产写入方和消费方。

## 5. 下一步优先级

### P0 — 保护并收口当前 WIP

- [ ] 让当前主工作区的 Raven Bench / provenance 会话先保存自己的改动；不要从其他 worktree 覆盖。
- [ ] 以 `harness-gpt-pro-v2` 为唯一 GPT Pro 集成主线，完成第 3 节的五项合入前工作并开独立 PR。
- [ ] Raven Bench 的统一主评分使用 **Brier Index**：`100 × (1 − √mean Brier)`；必须先跨题求 mean Brier 再转换。排名同时展示完成题数、置信区间、延迟、整轮墙钟时间、美元成本和 token；并行 arm 的耗时不得相加冒充等待时间。

### P1 — Forecast Engine 第二、三阶段

- [ ] 多期限联合预测与单调性校验；最高影响证据簇的 leave-one-cluster-out 敏感性分析；真正的增量更新与搜索预算分配。
- [ ] 建立结算与离线评测闭环：Brier、校准曲线、来源质量 / 断言权重后验调参，并增加常见结算源的监控适配器。
- [ ] 对 FutureX、LongPort MCP、Time Machine 三项分别做 go / archive 产品判断；任何一项获批后都从最新 `main` 建独立小 PR。

### P2 — 已知但不阻塞

- [ ] `paper-agent` 的 `market-scan.test.ts` 有两项固定日期测试于 2026-09-01 过期，当前 CI 因此失败；测试和实现与发布前主线一致。后续应固定测试时钟，勿修改实际到期过滤规则来迎合测试。

- [ ] 东京 VM 根盘使用率 82%（约 8.6 GiB 可用）；继续监控，并在部署新镜像前先做可恢复的缓存 / 旧镜像清理。
- [ ] 将 live Pulse 的结算回填 / 离线评分按当前 ledger 重新设计；不要直接搬 PR #77 的旧实现。
- [ ] 修 `scripts/world-cup/deploy-web.sh` 在新版 Vercel CLI 下解析 deploy 输出的 promote 步。
- [ ] World Cup Monte Carlo 淘汰赛点球规则仍有已确认偏差；是否重算并重发需要用户产品决定。

## 6. 已定规则，不要重复讨论

- Forecast Engine 的概率只由 engine 维护；研究代理不再输出第二套整体概率。
- GPT Pro 不是独立 model slug：使用 `gpt-5.6` / resolved model，并显式设置 `reasoning.mode=pro`；model、mode、effort 分别归档。
- World Cup / market-blind 的预测生成禁止读取市场价格；结算后的对照评分允许读取预测时刻市场基准。
- Delta PM 新闻身份由首条记录和标准化 URL 共同确定；重复 sitemap/feed 条目不得重新跑 gates。
- Pulse 的观望、名义侧、no-trade、pass 和明确 `0%` 建议不得生成新开仓。
- 真钱操作默认不可逆；未获明确授权时只能 recommend-only / read-only。

## 7. 安全与执行边界

- `pnpm daily:forecast` / `pnpm forecast:live` 默认可能发送真实订单；只读必须显式使用 `--recommend-only`。
- 默认钱包配置是 `.env.pizza`；不得上传 `.env*`、私钥或 API key。
- 风控默认值可以讨论，但 agent 不得擅自修改、绕过或放宽。
- 多个 agent / 会话必须使用独立 git worktree；主工作区脏时严禁 checkout / stash / reset。
- LongPort、OpenRouter、FutureX paid run、任何真钱 probe 都需要各自明确授权；一次授权不扩展到其他外部付费或交易动作。

## 8. 按需参考

| 需要了解 | 读取 |
| --- | --- |
| 风控完整规则 | [`docs/risk-controls.md`](risk-controls.md) |
| 命令、部署、依赖矩阵 | [`docs/diagrams/dev-reference.md`](diagrams/dev-reference.md) |
| Delta PM 运维 | [`docs/delta-pm-operations.md`](delta-pm-operations.md) |
| Forecasting 成本画像 | [`docs/diagrams/forecasting-cost-profile.md`](diagrams/forecasting-cost-profile.md) |
| 历史设计 / review | [`docs/internal/review/`](internal/review/) 与 [`docs/internal/plan/`](internal/plan/) |
| 已完成历史 | git log、merged PR、`docs/archive/` |

## 维护规则

- handoff 只保留当前状态和未完成动作，目标控制在约 150 行以内。
- wrap-up 时**原地更新**状态和优先级，不要在文件顶部继续追加“上次更新”日记。
- 完成项从待办移除；值得保留的过程写进 git commit、PR 或 `docs/internal/review/`。
- 任何新增 / 修改必须同步英文镜像；中文为准。
