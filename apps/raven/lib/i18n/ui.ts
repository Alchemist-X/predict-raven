// Dictionary for the shared chrome (rv-shell) and the research screen's
// orchestration layer (page, view-model builders, iteration block, progress
// dock, verdict digest). Subcomponent dictionaries live in home.ts /
// verdict.ts / research-parts.ts.

import type { Entry } from "./index";

export const CHROME = {
  navAsk: { en: "01 · Ask", zh: "01 · 提问" },
  navResearch: { en: "02 · Research", zh: "02 · 研究" },
  navVerdict: { en: "03 · Verdict", zh: "03 · 判决" },
  footerInstrument: {
    en: "Raven provides research forecasts with cited sources.",
    zh: "Raven 提供带有来源引用的研究预测。"
  },
  footerMarketBlind: {
    en: "No prediction-market or betting data is used as evidence.",
    zh: "不使用任何预测市场或博彩数据作为证据。"
  },
  themeLight: { en: "LIGHT", zh: "浅色" },
  themeDark: { en: "DARK", zh: "深色" },
  themeToLight: { en: "Switch to light theme", zh: "切换到浅色主题" },
  themeToDark: { en: "Switch to dark theme", zh: "切换到深色主题" },
  langSwitch: { en: "中文", zh: "EN" },
  langSwitchTitle: { en: "切换到中文界面", zh: "Switch to English" }
} satisfies Record<string, Entry>;

export const RS = {
  // --- plan message ---
  planIntroA: {
    en: "On it. I'll pin this down to a checkable yes-or-no question with a base-rate prior, then research it in up to {n} rounds — each round deliberately hunts for evidence that cuts against the current lean. ",
    zh: "收到。我会先把它界定成一个可判定的是/否问题并设定基础概率先验，然后最多研究 {n} 轮——每一轮都刻意寻找与当前倾向相反的证据。"
  },
  planIntroUnbounded: {
    en: "On it. I'll frame a checkable question and research until the evidence supports completion. There is no default round limit; access failures and insufficient evidence are reported as unfinished research. Each round investigates the strongest countercase. ",
    zh: "收到。我会先界定可判定的问题，再持续研究，直到证据支持完成。默认不设轮次上限；访问失败或证据不足会明确报告为未完成研究。每轮都会调查最强反证。"
  },
  planIntroStopped: { en: "Research has stopped. Review the evidence and unresolved questions below before resuming. ", zh: "研究已停止。继续研究前，请查看下方证据与未解决问题。" },
  planIntroBold: {
    en: "Circle what holds up, strike what you doubt",
    zh: "圈住站得住的、存疑靠不住的"
  },
  planIntroB: {
    en: ", or queue a hypothesis; I fold analyst pushback into the next round.",
    zh: "，或排入你的假设；分析师的质疑会折入下一轮。"
  },

  // --- plan steps ---
  frameLabel: { en: "Frame the question", zh: "界定问题" },
  frameSubPending: { en: "resolution criteria + base-rate prior", zh: "判定标准 + 基础概率先验" },
  frameSubDone: { en: "checkable yes/no · prior {prior}", zh: "可判定的是/否 · 先验 {prior}" },
  roundLabel: { en: "Research round {k}", zh: "研究第 {k} 轮" },
  roundSubFirst: { en: "gather the first evidence", zh: "收集第一批证据" },
  roundSubLater: { en: "hunt for evidence that cuts the other way", zh: "寻找反向证据" },
  roundSubLive: { en: "gathering evidence · {span}", zh: "正在收集证据 · {span}" },
  roundSubDone: { en: "{sources} · {span}", zh: "{sources} · {span}" },
  verdictLabel: { en: "Weigh signals, deliver the verdict", zh: "权衡信号，给出判决" },
  verdictSubDone: { en: "dossier ready", zh: "档案已生成" },
  verdictSubPending: { en: "YES probability + confidence + open risks", zh: "YES 概率 + 置信度 + 未决风险" },

  // --- block status words (view-model) ---
  statusRunningSpan: { en: "running · {from} → {to} so far", zh: "进行中 · {from} → {to}（至今）" },
  statusCompleteSpan: { en: "complete · {from} → {to}", zh: "已完成 · {from} → {to}" },
  moveSoFar: { en: "{arrow} {net} so far", zh: "{arrow} {net}（至今）" },
  placeholderNote: {
    en: "Question framed — starting from a {p} base-rate prior. Round 1 is gathering its first evidence.",
    zh: "问题已界定——从 {p} 的基础概率先验出发。第 1 轮正在收集第一批证据。"
  },

  // --- reading line tails (readingFromJob) ---
  readingTailWeighing: { en: " — weighing what it changes…", zh: "——正在评估它改变了什么…" },
  readingTailEvidence: { en: "weighing evidence…", zh: "正在评估证据…" },
  readingTailSearching: { en: "searching for new evidence…", zh: "正在搜索新证据…" },

  // --- header status ---
  headerLive: {
    en: "LIVE · ITERATION {cur} OF {max} · {elapsed} · {n} SOURCES",
    zh: "进行中 · 第 {cur}/{max} 轮 · {elapsed} · {n} 个来源"
  },
  headerLiveUnbounded: { en: "LIVE · ITERATION {cur} · {elapsed} · {n} SOURCES", zh: "进行中 · 第 {cur} 轮 · {elapsed} · {n} 个来源" },
  headerComplete: { en: "COMPLETE · {dur} · {n} SOURCES", zh: "已完成 · {dur} · {n} 个来源" },
  headerAborted: { en: "RUN ABORTED", zh: "运行中止" },
  headerUnforecastable: { en: "UNFORECASTABLE", zh: "无法预测" },

  // --- status strip ---
  framingQuestion: { en: "Framing the question…", zh: "正在界定问题…" },
  nowRoundBold: { en: "research round {n}", zh: "研究第 {n} 轮" },
  nowRoundRest: { en: " — gathering evidence and updating the estimate.", zh: "——收集证据并更新估计。" },
  quantProvisional: {
    en: "Probability of YES (P(YES)) · provisional",
    zh: "YES 概率（P(YES)）· 暂定"
  },
  quantFinal: { en: "YES probability · final", zh: "YES 概率 · 最终" },

  // --- notices ---
  notFoundTitle: { en: "Forecast not found", zh: "未找到该预测" },
  notFoundBody: {
    en: "There's no run with this id — it may have been cleared when the server restarted. Ask a new question from the Ask screen.",
    zh: "没有找到这个 id 对应的运行——可能在服务器重启时被清除了。请回到提问页重新提问。"
  },
  loadFailTitle: { en: "Couldn't load this run", zh: "无法加载这次运行" },
  loadFailBody: { en: "{err} — retrying automatically.", zh: "{err}——正在自动重试。" },
  vagueTitle: { en: "This question is too vague to forecast", zh: "问题太模糊，无法预测" },
  vagueBodyQuoted: {
    en: "Raven couldn't pin “{q}” down to a checkable yes-or-no outcome with a deadline.",
    zh: "Raven 无法把「{q}」界定成带截止日期、可判定的是/否结果。"
  },
  vagueBodyPlain: {
    en: "Raven couldn't pin the question down to a checkable yes-or-no outcome with a deadline.",
    zh: "Raven 无法把这个问题界定成带截止日期、可判定的是/否结果。"
  },
  vagueBodyTail: {
    en: "Rephrase it with a concrete event and date — “Will … happen by …?” — and ask again.",
    zh: "请改成具体事件加日期——「……会在……之前发生吗？」——再问一次。"
  },
  incompleteTitle: { en: "Research stopped · forecast incomplete", zh: "研究已停止 · 预测未完成" },
  incompleteBody: { en: "The evidence does not support a completed forecast yet. The working estimate and collected evidence below are provisional. Review the blocker before resuming research.", zh: "现有证据尚不支持完成预测。下方估计和已收集证据均为暂定记录；继续研究前请查看阻碍与缺口。" },
  abortedTitle: { en: "The run aborted", zh: "运行中止了" },
  abortedBodyTerminal: {
    en: "The engine stopped before finishing this run. The last log lines may explain why.",
    zh: "引擎在完成这次运行前停止了。最后几行日志可能说明原因。"
  },
  abortedBodyInline: {
    en: "The engine stopped before this run finished. Everything it gathered so far is shown below.",
    zh: "引擎在这次运行完成前停止了。已收集到的内容都显示在下方。"
  },

  // --- analyst summary + queued rows (view-model) ---
  markSummary: { en: "{k} kept · {d} doubted · {n} notes", zh: "圈住 {k} · 存疑 {d} · 笔记 {n}" },
  stancePushYes: { en: "Pushes YES", zh: "推 YES" },
  stancePushNo: { en: "Pushes NO", zh: "推 NO" },
  stanceQuestion: { en: "Open question", zh: "开放问题" },
  targetGeneral: { en: "General", zh: "一般" },
  targetOnEvidence: { en: "on evidence {idx}", zh: "针对证据 {idx}" },
  tagFolded: { en: "FOLDED INTO IT {n}", zh: "已折入第 {n} 轮" },
  tagSaved: { en: "SAVED", zh: "已保存" },
  tagQueued: { en: "QUEUED · IT {n}", zh: "排队 · 第 {n} 轮" },

  // --- iteration block ---
  iterationWord: { en: "Iteration", zh: "迭代" },
  reasoningLabel: { en: "Raven's reasoning", zh: "Raven 的推理" },
  pushbackChip: { en: "↳ analyst pushback folded in ({n})", zh: "↳ 分析师质疑已折入（{n}）" },
  pushbackTitle: {
    en: "Your queued notes were injected into this round's research prompt",
    zh: "你排入的笔记已注入本轮研究的提示词"
  },
  readWord: { en: "Read", zh: "已读" },
  readingWord: { en: "Reading", zh: "正在阅读" },
  trailAria: { en: "Sources visited this round", zh: "本轮已访问的来源" },
  foldAria: { en: "Fold iteration {n}", zh: "收起第 {n} 轮" },
  foldedAria: { en: "Iteration {n} (folded)", zh: "第 {n} 轮（已收起）" },

  // --- progress dock ---
  dockComplete: { en: "Forecast complete — YES probability {p}", zh: "预测完成——YES 概率 {p}" },
  dockIncomplete: { en: "Research stopped — forecast incomplete", zh: "研究已停止——预测未完成" },
  dockStep: { en: "Step {n}", zh: "第 {n} 步" },
  dockAborted: { en: "Run aborted — partial evidence kept", zh: "运行中止——已保留部分证据" },
  dockWorking: { en: "Working…", zh: "进行中…" },
  dockCta: { en: "Read the dossier →", zh: "阅读档案 →" },
  dockShowPlan: { en: "Show the run plan", zh: "展开运行计划" },
  dockHidePlan: { en: "Hide the run plan", zh: "收起运行计划" },

  // --- verdict digest ---
  digestLead: { en: "Forecast complete — YES probability {p}, {verdict}.", zh: "预测完成——YES 概率 {p}，{verdict}。" },
  chipVsPrior: { en: "vs the {prior} prior", zh: "相对先验 {prior}" },
  chipConfidence: { en: "confidence {c}", zh: "置信度{c}" },
  cardTitle: { en: "Dossier — {q}", zh: "档案——{q}" },
  cardSub: {
    en: "{verdict} · YES probability {p} · evidence book · resolution criteria",
    zh: "{verdict} · YES 概率 {p} · 证据书 · 判定标准"
  },
  cardRead: { en: "READ →", zh: "查看 →" },
  messageAria: { en: "Raven's message", zh: "Raven 的消息" },
  planAria: { en: "Run plan", zh: "运行计划" }
} satisfies Record<string, Entry>;
