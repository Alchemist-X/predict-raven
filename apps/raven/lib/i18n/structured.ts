import type { Entry } from "./index";

export const STRUCTURED = {
  categorical: { en: "Choice forecast", zh: "选项预测" },
  independent_ranking: { en: "Event probability ranking", zh: "事件概率排名" },
  numeric: { en: "Numeric forecast", zh: "数值预测" },
  complete: { en: "Research complete", zh: "研究完成" },
  running: { en: "Research in progress · provisional result", zh: "研究进行中 · 暂定结果" },
  failed: { en: "Research interrupted · incomplete result", zh: "研究中断 · 结果不完整" },
  research: { en: "Research progress", zh: "研究进展" },
  verdict: { en: "Forecast report", zh: "预测报告" },
  independent: {
    en: "These are separate event probabilities. Multiple companies may meet the condition; the values need not add up to 100%.",
    zh: "各公司的事件概率分别列示，多家公司可以同时满足条件，合计不要求为 100%。"
  },
  exclusive: {
    en: "These choices are mutually exclusive. Their probabilities add up to 100%.",
    zh: "这些选项互斥，概率合计为 100%。"
  },
  option: { en: "Option / company", zh: "选项 / 公司" },
  probability: { en: "Probability", zh: "概率" },
  rank: { en: "Rank", zh: "排名" },
  tied: { en: "Tied leaders", zh: "并列领先" },
  range: { en: "Model range", zh: "模型区间" },
  analysis: { en: "Analysis", zh: "分析" },
  findings: { en: "Key findings", zh: "关键发现" },
  counter: { en: "Counterarguments", zh: "反面证据" },
  uncertainty: { en: "Uncertainties", zh: "不确定性" },
  rounds: { en: "Research rounds", zh: "研究轮次" },
  round: { en: "Round {n}", zh: "第 {n} 轮" },
  evidence: { en: "Evidence and original excerpts", zh: "证据与原文摘录" },
  fact: { en: "Fact", zh: "事实" },
  source_opinion: { en: "Source opinion", zh: "来源观点" },
  estimate: { en: "Estimate", zh: "估算" },
  verified: { en: "Source recorded in tool trace", zh: "来源已在工具记录中核对" },
  unverified: { en: "Source not verified", zh: "来源尚未核实" },
  scope: { en: "Resolution and scope", zh: "结算与口径" },
  asOf: { en: "As of", zh: "研究截至" },
  deadline: { en: "Deadline", zh: "截止日期" },
  settlement: { en: "Settlement source", zh: "结算来源" },
  rubric: { en: "Scoring rubric", zh: "评分规则" },
  library: { en: "Expanded resource library", zh: "扩展资源库" },
  libraryCounts: {
    en: "{searched} searches · {read} articles read · {used} articles used",
    zh: "检索 {searched} 次 · 阅读 {read} 篇 · 采用 {used} 篇"
  },
  awaiting: { en: "Research findings will appear as each round completes.", zh: "每轮研究完成后，将在这里显示结果。" },
  unknownDate: { en: "Publication date unverified", zh: "原始发布日期未核实" },
  sources: { en: "{n} sources", zh: "{n} 个来源" }
} satisfies Record<string, Entry>;
