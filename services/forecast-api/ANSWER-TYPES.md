# 预测答案类型

HTTP `POST /v1/forecasts`、MCP `forecast_start` 和 Raven `POST /api/forecasts` 都接受可选的 `answerRequest`。未指定时由引擎识别问题；Raven 首页也可显式选择答案形式。

```json
{
  "question": "未来半年，候选公司中哪家最可能下调资本开支？",
  "answerRequest": {
    "answerType": "independent_ranking",
    "options": [
      { "id": "a", "label": "公司 A" },
      { "id": "b", "label": "公司 B" }
    ],
    "resolution": "按同一会计口径，比较此前公布的同年度资本开支指引。"
  }
}
```

| answerType            | 结果含义                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `auto`                | 根据问题识别；不改变用户的问题与候选范围。                                                  |
| `binary`              | 原有是非事件概率，保留旧接口字段。                                                          |
| `categorical`         | 互斥选项的概率分布、选中项及并列项；总概率为 1。                                            |
| `numeric`             | 有单位的点估计和模型区间；支持 `unit`、`minimum`、`maximum`。模型区间不是经校准的置信区间。 |
| `independent_ranking` | 各实体事件的独立列示概率及排名；可同时发生，概率不做总和为 1 的归一化。                     |

新类型的 JSON 将结果放在 `answer` 中，`answerType` 和 `answerLabel` 供展示。`probability`、`probabilityPct` 均为 `null`；不得用最高选项概率替代原二元字段。`structured` 提供结算口径、研究轮次、选中的证据与原文摘录。扩展资源库整篇缓存正文不包含在 API 或 Raven 页面数据中。

文本与 PDF 使用相同的结构化内容。Raven 新类型进入专门的结果与研究视图，保留来源链接、原文摘录、事实/观点/估算标记，不进入旧的二元概率图表。

同一问题的显式类型、选项、单位与结算规则参与任务 ID。API 与 CLI 使用同一个 `makeEventId`；同一契约可恢复，改变契约不会误用旧档案。仅支持二元的内部消费者继续使用 `loadState`；它对 `schemaVersion: 2` 返回 `null`。预测 API 与 Raven 使用 `loadAnyState`。

## 验证

- 195 项引擎及 forecast-api 回归通过，涵盖旧二元行为、新类型输出、请求边界及任务 ID。
- API/Raven 类型检查和 Raven 生产构建通过。
- 合成数据验证三种新类型的真实 HTTP JSON、text、PDF 与 MCP 状态响应；未运行付费模型或交易。
- 对三种类型的结果/研究页，以及首页和旧二元演示页，完成 1440px/390px 共 16 张截图验收，无页面错误或新类型水平溢出。中文切换正常，原文引文可定位。
- 本次合成运行证据位于工作树的 `output/playwright/typed-answer/`，不提交截图、PDF 或本地运行状态。

中文为准。英文版本见 [ANSWER-TYPES.en.md](ANSWER-TYPES.en.md)。
