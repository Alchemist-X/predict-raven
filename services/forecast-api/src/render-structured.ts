import { answerLabel } from "@autopoly/forecast-engine/answer-types";
import type { ForecastAnswer } from "./answer";

export interface ReportSection {
  title: string;
  paragraphs: string[];
}

// Shared content for text and PDF: one typed result, identical evidence and scope.
export function structuredSections(a: ForecastAnswer): ReportSection[] {
  if ((!a.answer && !a.workingEstimate?.answer) || !a.structured) return [];
  const result = (a.answer ?? a.workingEstimate?.answer)!;
  const detail = a.structured;
  const sections: ReportSection[] = [];
  const values =
    result.kind === "numeric"
      ? [
          `${result.pointEstimate} ${result.unit}`,
          `Model range / 模型区间: ${result.modelRange[0]} – ${result.modelRange[1]} ${result.unit}. ${result.rangeDescription}`
        ]
      : [
          result.kind === "independent_ranking"
            ? "Independent event probabilities; several outcomes may occur. They do not sum to 100%. / 各事件概率独立列示，可同时发生，不要求合计为 100%。"
            : "Mutually exclusive choices; probabilities sum to 100%. / 互斥选项的概率合计为 100%。",
          ...(result.kind === "categorical" ? result.probabilities : result.ranking).map(
            (row) => `${"rank" in row ? `${row.rank}. ` : ""}${row.label}: ${(row.probability * 100).toFixed(1)}%`
          ),
          ...(result.tiedIds.length > 1
            ? [
                `Tied leaders / 并列领先: ${result.tiedIds.map((id) => detail.questionSpec.options.find((option) => option.id === id)?.label ?? id).join(", ")}`
              ]
            : [])
        ];
  sections.push({ title: a.isFinal ? "Answer / 预测结果" : "Working estimate, not a completed forecast / 暂定估计，尚非完成预测", paragraphs: values });
  if (detail.summary) {
    sections.push({ title: "Analysis / 分析", paragraphs: [detail.summary.verdict] });
    if (detail.summary.keyFindings.length)
      sections.push({ title: "Key findings / 关键发现", paragraphs: detail.summary.keyFindings });
    if (detail.summary.counterarguments.length)
      sections.push({ title: "Counterarguments / 反面证据", paragraphs: detail.summary.counterarguments });
    if (detail.summary.uncertainties.length)
      sections.push({ title: "Uncertainties / 不确定性", paragraphs: detail.summary.uncertainties });
  }
  if (detail.rounds.length)
    sections.push({
      title: "Research rounds / 研究轮次",
      paragraphs: detail.rounds.map(
        (round) =>
          `Round / 第 ${round.round} 轮: ${answerLabel(round.before)} → ${answerLabel(round.after)}\n${round.reasoning}`
      )
    });
  if (detail.evidence.length)
    sections.push({
      title: "Evidence / 原文证据",
      paragraphs: detail.evidence.map(
        (entry, index) =>
          `[${String(index + 1).padStart(2, "0")}] ${entry.sourceTitle}\n${entry.sourceUrl}\n${entry.claim}${entry.quote ? `\n“${entry.quote}”` : ""}\n${entry.rationale}\n${entry.epistemicStatus} · ${entry.sourceType} · ${entry.publishedAt ?? "date unknown / 日期未知"} · ${entry.targetIds.join(", ")} · ${entry.verifiedInSearchTrace ? "source in tool trace / 来源已核对" : "source not verified / 来源未核实"}`
      )
    });
  const spec = detail.questionSpec;
  sections.push({
    title: "Resolution & scope / 结算与口径",
    paragraphs: [
      spec.resolutionCriteria,
      `As of / 截至: ${spec.asOfDate} · Deadline / 截止: ${spec.resolutionDate}`,
      `Settlement source / 结算来源: ${spec.settlementSource}`,
      ...spec.assumptions,
      ...(spec.scoreRubric ? [`Score rubric / 评分规则: ${spec.scoreRubric}`] : [])
    ]
  });
  if (detail.library)
    sections.push({
      title: "Expanded resource library / 扩展资源库",
      paragraphs: [
        `Queries / 检索: ${detail.library.queryCount} · Read / 阅读: ${detail.library.readCount} · Used / 采用: ${detail.library.usedCount}`,
        ...detail.library.gaps
      ]
    });
  return sections;
}
