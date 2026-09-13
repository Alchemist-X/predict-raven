// Home (Ask) screen dictionary. Entries are passed straight to t() from
// app/page.tsx; engine-produced words (verdict / confidence / source counts)
// are localized by the label helpers in ./index, not duplicated here.
// Data-borne content (question texts, quips, dossier copy) is never
// translated — labels only.

import type { Entry } from "./index";

export const HOME = {
  answerType: { en: "Answer format", zh: "答案形式" },
  autoType: { en: "Detect from question", zh: "根据问题自动识别" },
  binaryType: { en: "Yes / no probability", zh: "是非事件概率" },
  binaryProbability: { en: "YES probability", zh: "事件发生概率" },
  researchPreview: { en: "RESEARCH PREVIEW", zh: "研究预览" },
  mascotAlt: {
    en: "Raven, a hooded crow holding a glowing orb",
    zh: "Raven——一只捧着发光宝珠的乌鸦"
  },
  heroTitleAccent: { en: "Forecasting Engine", zh: "预测引擎" },
  heroLede: {
    en: "Ask about an event, choose among outcomes, forecast a number, or compare companies. Raven defines the question, researches the evidence, and shows how it reached the answer.",
    zh: "预测事件、选择选项、估计数值，或比较公司。Raven 会明确问题口径，研究证据，并展示结论的形成过程。"
  },
  askPlaceholder: { en: "Will … happen by …?", zh: "……会在……之前发生吗？" },
  askAriaLabel: { en: "Forecast question", zh: "预测问题" },
  submitIdle: { en: "Forecast it", zh: "开始预测" },
  submitBusy: { en: "Framing…", zh: "定题中…" },
  requestFailed: { en: "request failed ({status})", zh: "请求失败（{status}）" },
  hintPrefix: {
    en: "Works best with a deadline and a checkable outcome — try",
    zh: "带明确截止日期、结果可核查的问题效果最好——试试"
  },
  exampleChip: {
    en: "Will the GTA 6 launch slip past November 19, 2026?",
    zh: "GTA 6 发售会推迟到 2026 年 11 月 19 日之后吗？"
  },
  latestDossier: { en: "Latest dossier", zh: "最新档案" },
  liveRun: { en: "LIVE — {question}", zh: "进行中 — {question}" },
  confidenceMeta: { en: "{level} confidence", zh: "{level}置信度" },
  resolvesOn: { en: "resolves {date}", zh: "{date} 结算" },
  readDossier: { en: "Read the dossier", zh: "阅读档案" },
  watchRun: { en: "Watch the run", zh: "查看运行过程" },
  step1Kicker: { en: "01 · FRAME", zh: "01 · 定题" },
  step1Title: { en: "The question is pinned down", zh: "把问题钉死" },
  step1Body: {
    en: "Normalized into something checkable — exact date, exact resolution criteria — and given an honest base-rate prior.",
    zh: "改写成可核查的形式——精确到日期与判定标准——并给出诚实的基准率先验。"
  },
  step2Kicker: { en: "02 · RESEARCH", zh: "02 · 研究" },
  step2Title: { en: "Adversarial rounds", zh: "对抗式多轮研究" },
  step2Body: {
    en: "Gather evidence, weigh its credibility and value, then hunt for whatever would prove the current lean wrong. You can push back mid-run.",
    zh: "收集证据，衡量可信度与价值，再主动寻找能推翻当前倾向的反证。运行中你可以随时质疑。"
  },
  step3Kicker: { en: "03 · VERDICT", zh: "03 · 判决" },
  step3Title: { en: "A number you can audit", zh: "一个可审计的数字" },
  step3Body: {
    en: "A probability, choice, numeric estimate, or ranking, with the evidence and assumptions that produced it.",
    zh: "给出概率、选项、数值估计或排名，并列出形成结论的证据和假设。"
  }
} satisfies Record<string, Entry>;
