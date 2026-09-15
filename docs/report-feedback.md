# 报告反馈与继续研究

公开投资报告右下角提供“提交反馈”。`POST /api/investment-analysis/feedback` 将建议存入私有 Vercel Blob，保存成功后返回稳定 ID。反馈是待核查线索，匿名提交不启动付费研究。

`GET /api/investment-analysis/feedback?reportSlug=openai-gpt6-sol` 需要 `Authorization: Bearer <REPORT_FEEDBACK_ADMIN_TOKEN>`，按 `cursor` 分页导出 `notes`。管理令牌和 `BLOB_READ_WRITE_TOKEN` 只通过生产环境配置注入，不进入仓库。缺少持久存储时返回 503，不能降级为临时文件或假成功。

研究者保存导出的 `notes` 后，使用原始状态目录继续原生预测：

```bash
ARTIFACT_STORAGE_ROOT=/private/original-store pnpm forecast:event -- \
  --resume-event EVENT_ID --feedback-file /private/feedback.json --additional-rounds 2
```

续跑冻结原问题与答案类型，追加累计研究轮次。二元、数值、互斥选项和独立排名都能读取反馈；只有研究结果成功保存后才确认本次处理的建议，失败和并发新建议继续待处理。重复运行或反馈 ID 会去重。

Raven 原生任务页支持保存并继续。已运行的任务在后续研究中读取建议；已完成的任务重新启动，仍受访问与额度控制。异常终止留下进程锁时，核实锁内的主机与进程已退出后再清理，避免重复研究。

综合研究稿不是原生预测状态：Sol 报告的文件名不能用作事件 ID。应读取报告与反馈、核验后形成当前结论，再发布到稳定 URL。公开报告只显示当前状态；原生 `audit.md/state.json` 保存内部轨迹。

生产入口：[Sol 报告](https://forecasting-agent.com/investment-analysis/openai-gpt6-sol)。上线验收通过报告字节一致性、真实提交/去重/私有导出与测试数据清理；用户明确要求跳过 UI 检查。
