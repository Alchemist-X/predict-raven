# Signal Desk 投研运行接入

[English](en/signal-desk-research.md)

研究模式通过本机网关同时搜索公开资料和个人订阅材料。接入点是 `forecast-engine` 的 Claude / DeepSeek 工具循环；红薯仓库的 OpenRouter `orgpt.py --tools` 也使用相同网关。

## 运行方式

在红薯仓库运行：

```bash
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 check
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 forecast \
  --question "未来六个月 Meta 是否会下调资本开支指引？" --max-rounds 3
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 orgpt \
  --prompt-file path/to/research-prompt.md --out path/to/report.md
```

日期是订阅目录的检索窗口，不是预测事件的期限，也不保证是原始发布日期。问题中的“六个月”须由 framing 明确结算标准；历史研究还须核验正文原始日期。

个人工作流在 `~/.config/raven/research/runtime.json` 中设置 `forecast_repo`，或通过 `RAVEN_FORECAST_REPO` 指向含本接入的 checkout。本次已将接线迁移到最新 main，保留研究规划和证据交叉核验逻辑。Signal Desk 的服务实现由个人私有工作区维护，公开仓库只包含通用进程调用适配器；内容缓存和凭证不随代码分发。

直接调用本引擎时，显式设置：

```bash
FORECAST_SIGNAL_DESK=1 FORECAST_SIGNAL_DESK_COMMAND="$HOME/.local/bin/raven-signal-desk" \
  pnpm forecast:event -- "研究问题" --max-rounds 3
```

全局默认关闭；上述专用入口自动开启。`FORECAST_PROVIDER=deepseek` 使用 OpenAI-compatible 工具循环；默认 Claude 使用 CLI 自身配置的模型和鉴权。Codex provider 暂未接入这个网关，显式启用 Signal Desk 时会报出不支持，避免静默漏掉订阅检索。没有新增交易、下单、定时运行、共享服务或公开网页接入。

## 工具与调用策略

| 工具 | 行为 |
| --- | --- |
| `web_search` | 每次同时调用公开搜索与 Signal Desk；默认每侧 6 条候选，状态分别返回 |
| `fetch_page` | 读取公开网页；严格匹配的订阅 Markdown URL 转交鉴权读取 |
| `signal_desk_search` | 按关键词、日期、出版社、标题／正文、分页精确检索 |
| `signal_desk_read` | 按文章 ID 分段读取 Markdown；区分摘要和全文 |
| `signal_desk_pdf` | 按需下载或复用缓存 PDF，返回页码及提取文本 |

Claude 研究模式通过 `--mcp-config` 加载这五项工具，同时关闭内置工具，确保通用搜索经过汇聚入口。OpenRouter / DeepSeek 使用同一份 JSON Schema 和 `research-call` 分发。专用摘要阶段显式禁用工具的设置继续生效。

公开搜索优先使用环境中的 Exa / Tavily Key，没有配置则使用 DuckDuckGo；403、超时等按来源显示错误。订阅侧失败时仍保留公开结果，反之亦然。`research_keywords=["Meta","capex"]` 使用全部关键词匹配，中文 Meta 问题会提取公司与主题；复杂问题应显式给简短关键词，避免自然语言字词污染匹配。

## 证据与边界

- 结果保留稳定 URL、来源、内容类型、覆盖情况和读取范围。候选命中标记 `search_candidate`，摘要读取为 `summary_verified`，正文／PDF 页文读取为 `body_verified`；这些标记说明取得的材料类型，不保证材料观点真实，也不代表整篇已读。
- 引擎只从成功工具返回的 `source_urls` 建立来源轨迹。私有来源读取失败不会因 URL 存在而被当成成功；正文里的其他链接不会自动变成已核验来源。
- 订阅目录覆盖与正文覆盖不同，Foreign Research 大量条目仍仅有标题索引。零命中不能推出没有相关材料；查找原文后可按需读取。公开搜索的日期过滤不作硬保证。
- PDF 已取消本任务原先的本地五次预算，仍如实返回上游权限、限流等错误。提取的页文可能缺图表或被截短；需要精确表格时检查原 PDF。检索不会自动批量下载全部报告。
- Key 由原本机服务管理，不进入模型参数或仓库。订阅正文、PDF 与模型工具内容会用于用户授权的个人研究，报告应引用和概括，不整篇转载。

## 运行记录与验证

`scripts/research.py` 每次在 `~/.local/share/raven/signal-desk/research-runs/<runId>/` 创建私人归档，包含请求、运行输出、退出状态和工具账本；模型调用的解析输出、实际返回的模型／用量（若可用）与检索轨迹写入旁边的 `.models.jsonl`。工具账本不保存整篇正文、Key 或临时签名链接，正文缓存仍由原服务管理。

验证覆盖：工具参数和错误处理、来源轨迹、完整 JSON 分页、原公开搜索兼容，以及真实 Claude MCP 联合搜索 → 读取摘要。真实验收两侧均成功，模型正确报告已读 500 字符且仍有下一页；完整验收记录留在个人私人运行目录。OpenRouter 与 DeepSeek 的循环使用模拟模型响应验证，未另发付费模型请求。服务侧另验证真实搜索、读取和已有 PDF 的缓存页文提取。

研究调用涉及外部搜索费用时，引擎成本标为 `partial`，避免把模型账单冒充完整研究成本。
