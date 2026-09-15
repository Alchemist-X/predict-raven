// Verdict (report) screen dictionary — chrome labels only. Engine-produced
// content (why, quips, summaries, evidence claims) renders untranslated in
// the run's own language. Pure module: safe to import from decorate.ts.

import type { Entry } from "./index";
import type { DossierStatus, Side, SrcType } from "../vm/types";

export const V = {
  // Not-found / loading / run-state banners
  notFound: { en: "Forecast not found", zh: "未找到该预测" },
  backToAsk: { en: "← Back to 01 · Ask", zh: "← 返回 01 · 提问" },
  loadingDossier: { en: "Loading dossier…", zh: "档案加载中…" },
  retrying: { en: "{err} — retrying", zh: "{err} — 重试中" },
  workingEstimate: { en: "Working estimate · not a completed forecast", zh: "暂定估计 · 尚非完成预测" },
  incompleteBody: { en: "Research stopped before a supported forecast was completed. Review the evidence and unresolved questions.", zh: "研究已停止，尚未形成证据充分的完成预测。请查看已收集证据与未解决问题。" },
  stillRunning: { en: "This forecast is still running —", zh: "该预测仍在运行 —" },
  watchLive: { en: "watch it live", zh: "查看实时进展" },
  runAborted: {
    en: "This run aborted — the dossier below is partial.",
    zh: "本次运行已中止 — 以下档案不完整。"
  },

  // Hero
  confidence: { en: "Confidence", zh: "置信度" },
  confTooltip: {
    en: "Overall confidence in this inference: {conf}",
    zh: "本次推断的整体置信度：{conf}"
  },
  // Split around the styled prior value ("started as a <38%> prior")
  priorNotePre: { en: "started as a ", zh: "先验起点为 " },
  priorNotePost: { en: " prior", zh: "" },
  theWhy: { en: "The why", zh: "核心理由" },
  coreSignals: { en: "Three core signals", zh: "三大核心信号" },
  strongestCounter: { en: "Strongest counter-signal", zh: "最强反向信号" },

  // Summary
  ravensSummary: { en: "Raven's summary", zh: "Raven 总结" },
  openRisk: { en: "Open risk", zh: "未决风险" },
  adoptedModel: { en: "Single adopted probability model", zh: "唯一采用的概率模型" },
  scenarios: { en: "Scenario analysis", zh: "情景分析" },
  monitoringSignals: { en: "What to monitor next", zh: "后续监控指标" },
  informationGaps: { en: "Information gaps", zh: "信息缺口" },
  implication: { en: "Implication", zh: "对当前判断的含义" },
  affectedComponent: { en: "Affected component", zh: "影响组件" },
  retrievalPath: { en: "How to retrieve it", zh: "获取方式" },
  directionRaises: { en: "Raises", zh: "上调" },
  directionLowers: { en: "Lowers", zh: "下调" },
  directionMixed: { en: "Mixed", zh: "双向" },

  // Evidence book
  evidenceInOrder: { en: "The evidence, in order — {src}", zh: "全部证据（按序）— {src}" },
  legendSupporting: { en: "supporting", zh: "支持" },
  legendCounter: { en: "counter", zh: "反向" },
  legendNeutral: { en: "neutral", zh: "中性" },
  iteration: { en: "Iteration", zh: "轮次" },
  revisesPrior: { en: "↻ Revises a prior source", zh: "↻ 修正先前来源" },
  verified: { en: "Verified", zh: "已核实" },
  unverified: { en: "Unverified", zh: "未核实" },
  claimQuality: { en: "Claim quality {score}/100", zh: "断言质量 {score}/100" },
  crossChecked: { en: "Cross-checked", zh: "已交叉核验" },
  singleSource: { en: "Single source", zh: "单一来源" },
  contested: { en: "Contested", zh: "存在冲突" },
  selectedSources: { en: "Selected sources", zh: "入选来源" },
  preview: { en: "Preview", zh: "预览" },
  openSource: { en: "Open {dom}", zh: "打开 {dom}" },

  // Evidence pills
  credPill: { en: "{tier} credibility", zh: "可信度·{tier}" },
  credTooltip: { en: "How trustworthy the source is", zh: "来源可信程度" },
  valuePill: { en: "{tier} value", zh: "价值·{tier}" },
  valueTooltip: {
    en: "How much this source adds to the forecast",
    zh: "该来源对预测的增量价值"
  },

  // Resolution & framing (folded section)
  resolutionFraming: { en: "Resolution & framing", zh: "判定与框架" },
  resolutionHint: {
    en: "Normalized question · criteria · prior · assumptions",
    zh: "标准化问题 · 判定标准 · 先验 · 假设"
  },
  normalizedQuestion: { en: "Normalized question", zh: "标准化问题" },
  resolutionCriteria: { en: "Resolution criteria", zh: "判定标准" },
  prior: { en: "Prior", zh: "先验" },
  assumptions: { en: "Assumptions", zh: "假设" },
  settlementSource: { en: "Settlement source", zh: "结算来源" }
} satisfies Record<string, Entry>;

// --- engine-word maps (server/demo emit English keys; display translates) ---

// Header status chip ("COMPLETE · 33m 35s · 13 SOURCES"); en is uppercased at
// the call site, which is a no-op for zh.
export const STATUS_LABELS: Record<DossierStatus, Entry> = {
  research_failed: { en: "retrieval failed · incomplete", zh: "检索失败 · 未完成" },
  insufficient_evidence: { en: "insufficient evidence · incomplete", zh: "证据不足 · 未完成" },
  max_rounds: { en: "round budget exhausted · incomplete", zh: "轮次预算用尽 · 未完成" },
  complete: { en: "complete", zh: "已完成" },
  running: { en: "running", zh: "运行中" },
  failed: { en: "failed", zh: "已中止" },
  unforecastable: { en: "unforecastable", zh: "无法预测" }
};

// Core-signal ranks produced by lib/server/dossier.ts and the demo dossier.
// Unknown ranks fall back to the raw English string in both locales.
const RANK_LABELS: Record<string, Entry> = {
  "Biggest move": { en: "Biggest move", zh: "最大变动" },
  "Key reversal": { en: "Key reversal", zh: "关键反转" },
  "On the record": { en: "On the record", zh: "官方口径" },
  "Strong signal": { en: "Strong signal", zh: "强信号" }
};

export const rankEntry = (rank: string): Entry => RANK_LABELS[rank] ?? { en: rank, zh: rank };

// Source-type label shown in the evidence popover (keyed by srcType so the
// VM's English srcLabel string never needs parsing).
export const SRC_TYPE_LABELS: Record<SrcType, Entry> = {
  official: { en: "Official source", zh: "官方来源" },
  data: { en: "Original data", zh: "原始数据" },
  academic: { en: "Academic research", zh: "学术研究" },
  original_reporting: { en: "Original reporting", zh: "原创报道" },
  press: { en: "Press", zh: "媒体报道" },
  insider: { en: "Insider report", zh: "内部消息" },
  secondary: { en: "Secondary source", zh: "二手来源" }
};

// Templates for decorate.ts's sideLabelFor — {dir} is "YES" | "NO" (kept
// verbatim in zh; P(YES) terms are never translated).
export const SIDE_LABEL_TEMPLATES: Record<Side, Entry> = {
  neutral: { en: "No directional weight", zh: "无方向性影响" },
  support: { en: "Supports the forecast (pushes {dir})", zh: "支持当前预测（推向 {dir}）" },
  counter: { en: "Cuts against the forecast (pushes {dir})", zh: "削弱当前预测（推向 {dir}）" }
};
