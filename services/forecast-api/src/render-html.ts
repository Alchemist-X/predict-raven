// Print-oriented HTML for the PDF deliverable. Rendered to PDF via headless
// Chromium (see pdf.ts) — same pipeline as scripts/pulse-decision-report.ts.
// Visual language follows the Raven app: warm ink/amber palette, serif
// headlines, decision-first hierarchy. Self-contained (no external assets).

import type { ForecastAnswer } from "./answer";
import { structuredSections } from "./render-structured";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: Georgia, "Songti SC", "Noto Serif CJK SC", serif; color: #15120c; margin: 0; font-size: 11.5px; line-height: 1.55; }
.mono { font-family: "SF Mono", Menlo, Consolas, monospace; }
header { border-bottom: 3px solid #15120c; padding-bottom: 10px; margin-bottom: 18px; }
.brand { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #8a7a63; }
h1 { font-size: 21px; line-height: 1.3; margin: 6px 0 0; }
.asked { color: #8a7a63; font-size: 10.5px; margin-top: 4px; }
.hero { display: flex; align-items: baseline; gap: 18px; margin: 16px 0 4px; }
.prob { font-size: 54px; font-weight: 700; letter-spacing: -0.02em; }
.verdict { font-size: 16px; font-weight: 700; color: #ee7130; text-transform: uppercase; letter-spacing: 0.06em; }
.conf { color: #8a7a63; font-size: 10.5px; margin-bottom: 12px; }
.why { background: #faf5ec; border-left: 4px solid #ee7130; padding: 10px 14px; font-size: 13px; margin: 14px 0; }
h2 { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: #8a7a63; border-bottom: 1px solid #e3d9c8; padding-bottom: 4px; margin: 22px 0 10px; }
ul { margin: 6px 0; padding-left: 18px; }
li { margin: 3px 0; }
li.yes::marker { color: #2e7d32; }
li.no::marker { color: #c62828; }
table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
th { text-align: left; color: #8a7a63; font-weight: 600; border-bottom: 1px solid #e3d9c8; padding: 4px 6px; }
td { border-bottom: 1px solid #f0e9db; padding: 5px 6px; vertical-align: top; }
.ev { margin: 0 0 10px; padding: 8px 10px; border: 1px solid #e3d9c8; border-radius: 6px; page-break-inside: avoid; }
.ev .no { font-weight: 700; color: #ee7130; margin-right: 6px; }
.ev .t { font-weight: 700; }
.ev .u { color: #8a7a63; font-size: 9.5px; word-break: break-all; }
.ev .c { margin: 4px 0 2px; }
.ev .m { color: #8a7a63; font-size: 9.5px; }
.pill { display: inline-block; border: 1px solid #e3d9c8; border-radius: 999px; padding: 0 7px; font-size: 9px; margin-right: 4px; color: #5c5142; }
.pos { color: #2e7d32; } .neg { color: #c62828; }
.status { display: inline-block; background: #ee7130; color: #fff; border-radius: 4px; padding: 2px 8px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
footer { margin-top: 26px; border-top: 1px solid #e3d9c8; padding-top: 8px; color: #8a7a63; font-size: 9px; }
p { margin: 8px 0; }
`;

function evidenceCard(e: ForecastAnswer["evidence"][number]): string {
  const sign = e.deltaPp >= 0 ? "+" : "";
  const dirClass = e.deltaPp >= 0 ? "pos" : "neg";
  const pills = [
    e.stance.replace("supports_", "supports "),
    e.strength,
    e.sourceType,
    `credibility ${e.credibility}`,
    `round ${e.round}`,
    e.verified ? "verified" : "unverified",
    e.kind === "reflection" ? "revision" : null
  ]
    .filter((p): p is string => p !== null)
    .map((p) => `<span class="pill">${escapeHtml(p)}</span>`)
    .join("");
  return `<div class="ev"><span class="no mono">[${String(e.n).padStart(2, "0")}]</span><span class="t">${escapeHtml(e.title)}</span>
  <span class="mono ${dirClass}" style="float:right">${sign}${e.deltaPp}pp</span>
  <div class="u mono">${escapeHtml(e.url)}</div>
  <div class="c">${escapeHtml(e.claim)}</div>
  <div class="m">${pills}</div></div>`;
}

export function renderHtml(a: ForecastAnswer): string {
  if (a.answer && a.structured) {
    const sections = structuredSections(a)
      .map(
        (section) =>
          `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map((paragraph) => `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(paragraph)}</p>`).join("")}</section>`
      )
      .join("");
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(a.question)}</title><style>${CSS}</style></head><body><header><div class="brand">Raven Forecasting Engine</div><h1>${escapeHtml(a.normalizedQuestion ?? a.question)}</h1></header><p>Status / 状态: ${escapeHtml(a.status)}${a.status === "running" ? " · provisional / 暂定" : ""}</p>${sections}<footer>id: ${escapeHtml(a.id)} · updated / 更新: ${escapeHtml(a.updatedAtUtc ?? "")}</footer></body></html>`;
  }
  const an = a.analysis;
  const generated = new Date().toISOString();
  const paragraphs = (an?.verdict ?? "")
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.replace(/\n/g, " "))}</p>`)
    .join("");

  const factorList = (items: string[], cls: string): string =>
    items.map((f) => `<li class="${cls}">${escapeHtml(f)}</li>`).join("");

  const trailRows = [
    an?.prior !== null && an?.prior !== undefined
      ? `<tr><td class="mono">start</td><td class="mono">${Math.round(an.prior * 100)}%</td><td>prior — ${escapeHtml(an.priorRationale ?? "")}</td></tr>`
      : "",
    ...(an?.rounds ?? []).map(
      (r) =>
        `<tr><td class="mono">round ${r.round}</td><td class="mono">${Math.round(r.fromProb * 100)}% → ${Math.round(r.toProb * 100)}%</td><td>${r.netPp >= 0 ? "+" : ""}${r.netPp}pp · ${r.newSources} new source(s)${r.dominantDriver ? ` · biggest mover: ${escapeHtml(r.dominantDriver)}` : ""}</td></tr>`
    )
  ].join("");

  const statusBadge =
    a.status === "done"
      ? ""
      : `<span class="status">${escapeHtml(a.status === "running" ? `in progress — ${a.rounds} round(s) so far` : a.status)}</span>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<header>
  <div class="brand">Raven Forecasting Engine · Forecast Dossier</div>
  <h1>${escapeHtml(a.normalizedQuestion ?? a.question)}</h1>
  ${a.normalizedQuestion && a.normalizedQuestion !== a.question ? `<div class="asked">Asked as: ${escapeHtml(a.question)}</div>` : ""}
</header>
${statusBadge}
${
  a.probability !== null
    ? `<div class="hero"><div class="prob mono">${escapeHtml(a.probabilityPct ?? "")}</div><div><div class="verdict">${escapeHtml(a.verdict ?? "")}</div><div style="font-size:10px;color:#8a7a63">probability the answer is YES</div></div></div>
<div class="conf">${a.confidence ? `Confidence: ${escapeHtml(a.confidence)}${an?.confidenceReason ? " — " + escapeHtml(an.confidenceReason) : ""}` : ""}</div>`
    : `<p>The engine has not produced an answer for this prompt${a.status === "unforecastable" ? " — specify the outcomes or metric, deadline and settlement source, and ask again." : "."}</p>`
}
${an?.whySentence ? `<div class="why">${escapeHtml(an.whySentence)}</div>` : ""}
${paragraphs ? `<h2>Analysis</h2>${paragraphs}` : ""}
${
  an && (an.keyFactorsYes.length || an.keyFactorsNo.length)
    ? `<h2>Key factors</h2><ul>${factorList(an.keyFactorsYes, "yes")}${factorList(an.keyFactorsNo, "no")}</ul>`
    : ""
}
${an?.mainUncertainties ? `<h2>Main uncertainties</h2><p>${escapeHtml(an.mainUncertainties)}</p>` : ""}
${trailRows ? `<h2>How the number moved</h2><table><tr><th>Step</th><th>P(YES)</th><th>What moved it</th></tr>${trailRows}</table>` : ""}
${a.evidence.length ? `<h2>Evidence — ${a.evidence.length} sources</h2>${a.evidence.map(evidenceCard).join("")}` : ""}
${
  a.framing
    ? `<h2>Method &amp; scope</h2><p><b>Resolution criteria:</b> ${escapeHtml(a.framing.resolutionCriteria)}${a.framing.resolutionDate ? ` <b>· By:</b> ${escapeHtml(a.framing.resolutionDate)}` : ""}${a.framing.settlementSource ? ` <b>· Settles per:</b> ${escapeHtml(a.framing.settlementSource)}` : ""}</p>
${a.framing.assumptions ? `<p><b>Assumptions:</b> ${escapeHtml(a.framing.assumptions)}</p>` : ""}
<p>Method: iterative research loop — the question is framed into a precise binary event, then researched over multiple rounds; every probability move is attributed to a cited source through a Bayesian update, with unverified citations damped and correlated sources discounted.</p>`
    : ""
}
<footer>${[
    a.provider ? `provider: ${escapeHtml(a.provider)}` : null,
    `rounds: ${a.rounds}`,
    a.updatedAtUtc ? `updated: ${escapeHtml(a.updatedAtUtc)}` : null,
    `id: ${escapeHtml(a.id)}`,
    `generated: ${generated}`
  ]
    .filter(Boolean)
    .join(" · ")}<br>Forecasts are research output, not financial or betting advice.</footer>
</body></html>`;
}
