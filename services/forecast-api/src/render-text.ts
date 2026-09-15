// Plain-text rendering of a completed (or in-progress) forecast: the
// "直接发送纯文字" deliverable. Decision-first: probability + verdict on top,
// reasoning next, evidence book last. No interval claims (see answer.ts).

import type { ForecastAnswer } from "./answer";
import { structuredSections } from "./render-structured";

const HR = "─".repeat(62);

function wrap(text: string, width = 78, indent = ""): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

function section(title: string, body: string): string[] {
  return body.trim() ? ["", title, HR, body.trimEnd()] : [];
}

export function renderText(a: ForecastAnswer): string {
  if (a.structured) {
    return [
      "RAVEN FORECASTING ENGINE — FORECAST",
      HR,
      a.normalizedQuestion ?? a.question,
      `Status / 状态: ${a.status}${!a.isFinal ? " · incomplete, provisional only / 未完成，仅为暂定记录" : ""}`,
      ...(a.researchBlocker ? [`Research blocker / 研究阻碍: ${a.researchBlocker}`] : []),
      ...structuredSections(a).flatMap((section) => ["", section.title, HR, section.paragraphs.join("\n\n")]),
      "",
      `id: ${a.id} · updated / 更新: ${a.updatedAtUtc ?? ""}`,
      ""
    ].join("\n");
  }
  const out: string[] = [];
  out.push("RAVEN FORECASTING ENGINE — FORECAST");
  out.push(HR);
  out.push(`Question:    ${a.normalizedQuestion ?? a.question}`);
  if (a.normalizedQuestion && a.normalizedQuestion !== a.question) {
    out.push(`Asked as:    ${a.question}`);
  }
  if (a.status === "running") {
    out.push(`Status:      IN PROGRESS — ${a.rounds} round(s) done, numbers below are provisional`);
  } else if (a.status !== "done") {
    out.push(`Status:      ${a.status.toUpperCase()}`);
  }
  if (!a.isFinal && a.status !== "running") out.push("INCOMPLETE — no completed forecast / 未完成，尚无完成预测");
  if (a.researchBlocker) out.push(`Research blocker / 研究阻碍: ${a.researchBlocker}`);
  if (a.workingEstimate && a.probability === null) out.push(`Working estimate only / 仅为暂定估计: ${a.workingEstimate.label}`);
  if (a.probability !== null) {
    out.push("");
    out.push(`PROBABILITY (YES): ${a.probabilityPct}   ·   Verdict: ${a.verdict}`);
    if (a.confidence) {
      const reason = a.analysis?.confidenceReason ? ` — ${a.analysis.confidenceReason}` : "";
      out.push(`Confidence: ${a.confidence}${reason}`);
    }
  }
  if (a.status === "unforecastable") {
    out.push("");
    out.push(
      wrap(
        "This prompt could not be given clear resolution criteria. Specify the outcomes or metric, deadline and settlement source, and ask again."
      )
    );
  }
  if (a.jobLogTail?.length) {
    out.push(...section("ENGINE LOG (tail)", a.jobLogTail.map((l) => "  " + l).join("\n")));
  }

  const an = a.analysis;
  if (an) {
    if (an.whySentence) out.push(...section("WHY THIS NUMBER", wrap(an.whySentence)));
    if (an.verdict) {
      const paragraphs = an.verdict.split(/\n{2,}/).map((p) => wrap(p.replace(/\n/g, " ")));
      out.push(...section("ANALYSIS", paragraphs.join("\n\n")));
    }
    const factors: string[] = [];
    if (an.keyFactorsYes.length) {
      factors.push("Toward YES:");
      for (const f of an.keyFactorsYes) factors.push(wrap(f, 74, "    ").replace(/^ {4}/, "  + "));
    }
    if (an.keyFactorsNo.length) {
      factors.push("Toward NO:");
      for (const f of an.keyFactorsNo) factors.push(wrap(f, 74, "    ").replace(/^ {4}/, "  - "));
    }
    if (factors.length) out.push(...section("KEY FACTORS", factors.join("\n")));
    if (an.mainUncertainties) out.push(...section("MAIN UNCERTAINTIES", wrap(an.mainUncertainties)));

    const trail: string[] = [];
    if (an.prior !== null) {
      trail.push(`  Start   prior ${Math.round(an.prior * 100)}%${an.priorRationale ? " — " + an.priorRationale : ""}`);
    }
    for (const r of an.rounds) {
      const arrow = `${Math.round(r.fromProb * 100)}% → ${Math.round(r.toProb * 100)}%`;
      const driver = r.dominantDriver ? ` — biggest mover: ${r.dominantDriver}` : "";
      trail.push(
        `  Round ${r.round}   ${arrow} (${r.netPp >= 0 ? "+" : ""}${r.netPp}pp, ${r.newSources} new source(s))${driver}`
      );
    }
    if (trail.length) out.push(...section("HOW THE NUMBER MOVED", trail.map((t) => wrap(t, 90, "")).join("\n")));
  }

  if (a.evidence.length) {
    const book: string[] = [];
    for (const e of a.evidence) {
      const nn = String(e.n).padStart(2, "0");
      const sign = e.deltaPp >= 0 ? "+" : "";
      const flags = `${e.stance.replace("supports_", "supports ")}, ${e.strength}, ${e.sourceType}, credibility ${e.credibility}, ${sign}${e.deltaPp}pp, round ${e.round}${e.verified ? ", verified" : ""}`;
      book.push(`[${nn}] ${e.title}`);
      book.push(`     ${e.url}`);
      book.push(wrap(e.claim, 72, "     "));
      book.push(`     (${flags})`);
      book.push("");
    }
    out.push(...section(`EVIDENCE — ${a.evidence.length} SOURCES`, book.join("\n")));
  }

  if (a.framing) {
    const method: string[] = [];
    method.push(wrap(`Resolution criteria: ${a.framing.resolutionCriteria}`));
    if (a.framing.resolutionDate) method.push(`Resolution date: ${a.framing.resolutionDate}`);
    if (a.framing.settlementSource) method.push(wrap(`Settlement source: ${a.framing.settlementSource}`));
    if (a.framing.assumptions) method.push(wrap(`Assumptions: ${a.framing.assumptions}`));
    method.push("");
    method.push(
      wrap(
        "Method: iterative research loop — the question is framed into a precise binary event, then researched over multiple rounds; every probability move is attributed to a cited source through a Bayesian update, with unverified citations damped and correlated sources discounted."
      )
    );
    out.push(...section("METHOD & SCOPE", method.join("\n")));
  }

  out.push("");
  out.push(HR);
  const meta: string[] = [];
  if (a.provider) meta.push(`provider: ${a.provider}`);
  meta.push(`rounds: ${a.rounds}`);
  if (a.updatedAtUtc) meta.push(`updated: ${a.updatedAtUtc}`);
  meta.push(`id: ${a.id}`);
  out.push(meta.join("  ·  "));
  out.push("Forecasts are research output, not financial or betting advice.");
  return out.join("\n") + "\n";
}
