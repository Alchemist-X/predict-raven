// Dictionary for the research-screen subcomponents: analyst desk, annotation
// toolbar/overlays, evidence cards, non-feed state cards and the status strip.
// Labels only — data-borne strings (takeaways, analysis text, note bodies,
// queued-row labels) are rendered exactly as passed.

import type { Entry } from "./index";

export const RP = {
  // --- research focus center ---
  focusTitle: { en: "Research Focus Center", zh: "研究焦点中心" },
  focusMotto: {
    en: "Search wider. Select harder. Keep the source that best proves the claim.",
    zh: "搜索要更广，甄选要更严，只保留最能证明断言的来源。"
  },
  focusSearchStandard: {
    en: "At least {n} distinct search directions per round, including primary evidence and the strongest countercase.",
    zh: "每轮至少规划 {n} 个不同检索方向，其中必须包含原始证据和最强反证。"
  },
  focusModel: { en: "Single probability model", zh: "唯一概率模型" },
  focusSourceOrder: { en: "Source selection order", zh: "来源甄选顺序" },
  focusOpen: { en: "OPEN", zh: "待研究" },
  focusCovered: { en: "SOURCED", zh: "已有来源" },
  focusChecked: { en: "CROSS-CHECKED", zh: "已交叉核验" },
  focusClaims: { en: "{n} accepted claims", zh: "{n} 条已采纳断言" },
  focusPreferred: { en: "Preferred", zh: "优先来源" },
  focusCompleteWhen: { en: "Complete when", zh: "完成标准" },
  focusUseWhen: { en: "Use when", zh: "适用条件" },
  focusRejectWhen: { en: "Reject when", zh: "淘汰条件" },

  // --- analyst desk ---
  deskTitle: { en: "Your feedback", zh: "你的反馈" },
  feedbackAuth: {en:"Feedback saved. Enter a valid invite code to continue research.",zh:"反馈已保存。输入有效邀请码后可继续研究。"},
  feedbackQuota: {en:"Feedback saved. The research quota has been reached.",zh:"反馈已保存，研究额度已用完。"},
  feedbackStopped: {en:"Feedback saved. Research could not start; try again later.",zh:"反馈已保存，研究暂未启动，请稍后重试。"},
  feedbackStarted: {en:"Feedback saved. Research is continuing.",zh:"反馈已保存，正在继续研究。"},
  feedbackQueued: {en:"Feedback saved for the active research.",zh:"反馈已保存，将用于当前研究。"},
  feedbackSaved: {en:"Feedback saved.",zh:"反馈已保存。"},
  feedbackSaveFailed: {en:"Feedback could not be saved. Your draft is still here.",zh:"反馈保存失败，草稿已保留。"},
  feedbackMarkFailed: {en:"The mark could not be saved. Please try again.",zh:"标记保存失败，请重试。"},
  feedbackRemoveFailed: {en:"The note could not be removed. Please try again.",zh:"笔记移除失败，请重试。"},
  feedbackInvite: {en:"Invite code (required to continue on the hosted service)",zh:"邀请码（在线服务继续研究时需要）"},
  feedbackContinue: {en:"Continue with saved feedback",zh:"使用已保存反馈继续研究"},
  feedbackSaveOnly: {en:"Save feedback only",zh:"仅保存反馈"},
  feedbackSaving: {en:"Saving…",zh:"正在保存…"},
  // Helper copy is split around the inline <b> segment: pre + bold + post.
  deskHelpRunPre: {
    en: "Queue a hypothesis or a lead. Raven treats each one as a claim to test in ",
    zh: "排入一个假设或线索。Raven 会把每一条当作待检验的论断，在"
  },
  deskHelpRunBold: { en: "the active research", zh: "当前研究中" },
  deskHelpRunPost: { en: ".", zh: "验证。" },
  deskHelpStopped: { en: "Add a question or source to investigate. Save it and continue research when ready.", zh: "补充需要核查的问题或来源，保存后可继续研究。" },
  deskSavedEmpty: { en: "No notes saved yet.", zh: "暂无已保存笔记。" },
  deskHelpDonePre: {
    en: "Add a question or source. Raven will ",
    zh: "补充问题或来源，Raven 会"
  },
  deskHelpDoneBold: { en: "check it against the evidence", zh: "结合证据核查" },
  deskHelpDonePost: { en: ".", zh: "。" },
  deskPlaceholder: {
    en: "e.g. Check retailer supply-chain listings — physical stock timelines would confirm the date better than press.",
    zh: "例如：查零售商供应链上架记录——实体备货时间线比新闻稿更能确认日期。"
  },
  deskComposerAria: { en: "Queue a hypothesis or a lead", zh: "排入假设或线索" },
  deskStanceAria: { en: "How this note pushes the forecast", zh: "这条笔记对预测的推动方向" },
  stanceYes: { en: "SUPPORTS", zh: "支持" },
  stanceNo: { en: "CHALLENGES", zh: "质疑" },
  stanceQuestion: { en: "QUESTION", zh: "疑问" },
  deskSubmitQueue: { en: "Save feedback", zh: "保存反馈" },
  deskSubmitSave: { en: "Save and continue research", zh: "保存并继续研究" },
  deskQueuedHeading: { en: "Queued · {nn}", zh: "已排入 · {nn}" },
  deskQueuedEmpty: {
    en: "Nothing queued yet. Your circles, strikes and notes land here — and in Raven's next research round.",
    zh: "暂无排入内容。你的圈住、存疑和笔记会汇集到这里，并进入 Raven 的下一轮研究。"
  },
  deskRemoveTitle: { en: "Remove", zh: "移除" },
  deskRemoveAria: { en: "Remove this note", zh: "移除这条笔记" },

  // --- annotation overlays + hover toolbar ---
  annoKept: { en: "KEPT", zh: "已圈住" },
  annoDoubted: { en: "DOUBTED", zh: "已存疑" },
  annoKeep: { en: "KEEP", zh: "圈住" },
  annoDoubt: { en: "DOUBT", zh: "存疑" },
  annoNote: { en: "+ NOTE", zh: "+ 笔记" },
  annoKeepAria: { en: "Keep this {subject}", zh: "圈住这条{subject}" },
  annoDoubtAria: { en: "Doubt this {subject}", zh: "对这条{subject}存疑" },
  annoNoteAria: { en: "Attach a note", zh: "附加笔记" },
  // Subject words for the aria-labels above ({subject} slot).
  subjectEvidence: { en: "evidence", zh: "证据" },
  subjectReasoning: { en: "reasoning", zh: "推理" },

  // --- evidence card ---
  evAria: { en: "Evidence {idx}: {title}", zh: "证据 {idx}：{title}" },
  evRevises: { en: "↻ Revises a prior source", zh: "↻ 修正先前来源" },
  evCredTitle: { en: "How trustworthy the source is", zh: "来源的可信程度" },
  evCredPill: { en: "{tier} credibility", zh: "可信度{tier}" },
  evValueTitle: { en: "How much this source adds to the forecast", zh: "该来源对预测的增益程度" },
  evValuePill: { en: "{tier} value", zh: "价值{tier}" },
  evClaimQuality: { en: "Claim quality {score}/100", zh: "断言质量 {score}/100" },
  evCrossChecked: { en: "Cross-checked", zh: "已交叉核验" },
  evSingleSource: { en: "Single source", zh: "单一来源" },
  evContested: { en: "Contested", zh: "存在冲突" },
  evUnverified: { en: "Unverified", zh: "未核实" },
  evYourNote: { en: "Your note", zh: "你的笔记" },
  evNotePlaceholder: { en: "Attach a note to this evidence…", zh: "给这条证据附加笔记…" },
  evNoteAria: { en: "Attach a note to this evidence", zh: "给这条证据附加笔记" },
  evAdd: { en: "ADD", zh: "添加" },

  // --- state cards (framing skeleton / loading / notice) ---
  // Framing line is split around the inline <b> segment: prefix + bold + rest.
  framingNow: { en: "Now: ", zh: "当前：" },
  framingBold: { en: "framing", zh: "界定问题" },
  framingRest: {
    en: " — normalizing the question, pinning resolution criteria, setting a base-rate prior",
    zh: "——规范化问题、锁定结算标准、设定基准率先验"
  },
  loadingAria: { en: "Loading the run", zh: "正在加载本次运行" },
  loadingText: { en: "Loading the run…", zh: "正在加载本次运行…" },
  backToAsk: { en: "← Back to Ask", zh: "← 返回提问" },

  // --- status strip ---
  stripNow: { en: "Now: ", zh: "当前：" },
  stripFromPrior: { en: "from the {prior}% prior", zh: "较先验 {prior}%" },
  stripAxisNow: { en: "now {n}%", zh: "现值 {n}%" },
  stripAxisPrior: { en: "prior {n}%", zh: "先验 {n}%" }
} satisfies Record<string, Entry>;
