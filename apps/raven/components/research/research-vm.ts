// View-model builders for Screen 02 · Research. Pure functions only — they
// turn the dossier/job payload (or the frozen demo snapshot) into the block
// list, reading line, queue rows and axis numbers the components render.

import type { JobInfo } from "../../lib/client/use-forecast";
import { render, sourcesLabel, type Locale } from "../../lib/i18n";
import { RS } from "../../lib/i18n/ui";
import type { AnalystNote, AnalystStance } from "../../lib/server/analyst";
import { arrowFor, cap, diamondsFor, dirFor, domainOf } from "../../lib/vm/format";
import type { DossierVM, EvidenceVM, IterationVM, NetDir } from "../../lib/vm/types";

// The API also ships the job's original question (used while framing), which
// the JobInfo client type does not declare — read it through this extension.
export type JobX = JobInfo & { question?: string };

export interface EvidenceRowVM extends EvidenceVM {
  idx: string; // 2-digit running index across the displayed feed
  arrow: string;
  dir: NetDir;
  deltaAbs: string;
  valDiamonds: string;
  valueLabel: string;
  credLabel: string;
}

export interface ReadingVM {
  domain: string | null; // bold "Reading <domain>" when known
  text: string; // tail after the domain, or the whole line when domain is null
}

export interface BlockVM {
  n: string;
  reasoningId: string; // mark id for the reasoning paragraph ("r1", "r2", …)
  status: string; // localized "complete · 38% → 30%" line
  span: string; // raw "{from} → {to}" (locale-independent, reused by the plan)
  move: string;
  moveDir: NetDir;
  note: string;
  evidence: EvidenceRowVM[];
  reading: ReadingVM | null;
  analystFolded: number; // analyst notes injected into this round's prompt
}

export function decorateEvidence(e: EvidenceVM, index0: number): EvidenceRowVM {
  return {
    ...e,
    idx: String(index0 + 1).padStart(2, "0"),
    arrow: arrowFor(e.d),
    dir: dirFor(e.d),
    deltaAbs: `${Math.abs(e.d)}%`,
    valDiamonds: diamondsFor(e.value),
    valueLabel: cap(e.value),
    credLabel: cap(e.cred)
  };
}

// --- frozen demo snapshot (mid-run moment from the design handoff) ---

export const DEMO_NOW = {
  bold: "disconfirmation search",
  rest: " — deliberately hunting evidence against the current lean."
};

export const DEMO_IT2_NOTE =
  "Disconfirmation pass: the strongest YES pillar — the “not content complete” flag — traces to January 2026 and looks superseded; a track-record insider sees no red flags. Now hunting for anything that cuts the other way.";

export const DEMO_READING: ReadingVM = {
  domain: "rockstarintel.com",
  text: ' — checking whether "content complete" reports supersede the January flag…'
};

// Sources already visited in the frozen demo round (renders the read-trail).
export const DEMO_TRAIL: ReadingVM[] = [
  { domain: "gamesindustry.biz", text: "" },
  { domain: "resetera.com", text: "" }
];

export function buildDemoBlocks(demo: DossierVM, locale: Locale): BlockVM[] {
  const it1 = demo.iterations[0];
  const it2 = demo.iterations[1];
  if (!it1 || !it2) return [];
  return [
    {
      n: "01",
      reasoningId: "r1",
      status: render(RS.statusCompleteSpan, locale, { from: "38%", to: "30%" }),
      span: "38% → 30%",
      move: "▼ 8%",
      moveDir: "down",
      note: it1.note,
      evidence: it1.evidence.map((e, i) => decorateEvidence(e, i)),
      reading: null,
      analystFolded: it1.analystFolded ?? 0
    },
    {
      n: "02",
      reasoningId: "r2",
      status: render(RS.statusRunningSpan, locale, { from: "30%", to: "18%" }),
      span: "30% → 18%",
      move: render(RS.moveSoFar, locale, { arrow: "▼", net: "12%" }),
      moveDir: "down",
      note: DEMO_IT2_NOTE,
      evidence: it2.evidence.slice(0, 2).map((e, i) => decorateEvidence(e, i + 5)),
      reading: DEMO_READING,
      analystFolded: it2.analystFolded ?? 0
    }
  ];
}

// --- live runs ---

export function buildLiveBlocks(
  iterations: IterationVM[],
  running: boolean,
  reading: ReadingVM | null,
  locale: Locale
): BlockVM[] {
  let k = 0;
  return iterations.map((it, i) => {
    const isRunning = running && i === iterations.length - 1;
    const netArrow = it.netDir === "down" ? "▼" : it.netDir === "up" ? "▲" : "—";
    const round = Number.parseInt(it.n, 10);
    const evidence = it.evidence.map((e) => decorateEvidence(e, k++));
    const spanVars = { from: it.from, to: it.to };
    return {
      n: it.n,
      reasoningId: `r${Number.isFinite(round) && round > 0 ? round : i + 1}`,
      status: isRunning ? render(RS.statusRunningSpan, locale, spanVars) : render(RS.statusCompleteSpan, locale, spanVars),
      span: `${it.from} → ${it.to}`,
      move: isRunning ? render(RS.moveSoFar, locale, { arrow: netArrow, net: it.net }) : `${netArrow} ${it.net}`,
      moveDir: it.netDir,
      note: it.note,
      evidence,
      reading: isRunning ? reading : null,
      analystFolded: it.analystFolded ?? 0
    };
  });
}

// Derive the "Reading <domain> — …" status from the engine's last log line;
// fall back to a per-provider generic when the line carries no URL.
export function readingFromJob(job: Pick<JobX, "log" | "provider"> | null, locale: Locale): ReadingVM {
  const lastLine = job?.log[job.log.length - 1] ?? "";
  const urlMatch = lastLine.match(/https?:\/\/[^\s"'<>)\]]+/);
  if (urlMatch) return { domain: domainOf(urlMatch[0]), text: render(RS.readingTailWeighing, locale) };
  return {
    domain: null,
    text: job?.provider === "deepseek" ? render(RS.readingTailEvidence, locale) : render(RS.readingTailSearching, locale)
  };
}

export function nextRoundFor(shownIterations: number, maxRounds: number): number {
  return maxRounds === 0 ? shownIterations + 1 : Math.min(shownIterations + 1, maxRounds);
}

// --- run plan (Manus-style checklist) ---

export type PlanStepState = "done" | "active" | "pending";

export interface PlanStepVM {
  key: string;
  label: string;
  sub: string | null;
  state: PlanStepState;
}

// Derive the checklist from the run state: one framing step, one step per
// research round (all announced up front while running, executed-only once
// terminal — the engine may converge early), and one verdict step.
export function buildPlanSteps(args: {
  framing: boolean;
  blocks: readonly BlockVM[];
  maxRounds: number;
  running: boolean;
  complete: boolean;
  prior: string | null;
  locale: Locale;
}): PlanStepVM[] {
  const { framing, blocks, maxRounds, running, complete, prior, locale } = args;
  const frameActive = framing || (running && blocks.length === 0);
  const steps: PlanStepVM[] = [
    {
      key: "frame",
      label: render(RS.frameLabel, locale),
      sub:
        !frameActive && prior
          ? render(RS.frameSubDone, locale, { prior })
          : render(RS.frameSubPending, locale),
      state: frameActive ? "active" : "done"
    }
  ];
  const roundCount = running || framing
    ? maxRounds === 0 ? Math.max(1, blocks.length) : Math.max(1, maxRounds)
    : blocks.length;
  for (let k = 1; k <= roundCount; k++) {
    const block = blocks[k - 1];
    if (!block) {
      steps.push({
        key: `round-${k}`,
        label: render(RS.roundLabel, locale, { k }),
        sub: render(k === 1 ? RS.roundSubFirst : RS.roundSubLater, locale),
        state: "pending"
      });
      continue;
    }
    const live = running && k === blocks.length;
    const n = block.evidence.length;
    steps.push({
      key: `round-${k}`,
      label: render(RS.roundLabel, locale, { k }),
      sub: live
        ? render(RS.roundSubLive, locale, { span: block.span })
        : render(RS.roundSubDone, locale, { sources: sourcesLabel(n, locale), span: block.span }),
      state: live ? "active" : "done"
    });
  }
  steps.push({
    key: "verdict",
    label: render(RS.verdictLabel, locale),
    sub: complete ? render(RS.verdictSubDone, locale) : render(RS.verdictSubPending, locale),
    state: complete ? "done" : "pending"
  });
  return steps;
}

// The dock's 1-based "step N of M" counter: finished steps plus the active one.
export function planStepNo(steps: readonly PlanStepVM[]): number {
  const done = steps.filter((s) => s.state === "done").length;
  return Math.min(steps.length, Math.max(1, done + (steps.some((s) => s.state === "active") ? 1 : 0)));
}

// Axis scale: at least 0–40%, widened in 10-point steps so both dots fit.
export function axisScaleFor(priorPct: number, nowPct: number): number {
  return Math.max(40, Math.ceil(Math.max(priorPct, nowPct) / 10) * 10);
}

// --- analyst queue rows ---

export interface QueuedVM {
  id: string;
  text: string;
  stanceLabel: string;
  dotColor: string;
  targetLabel: string;
  tagText: string;
  tagColor: string;
  removable: boolean;
}

// Dot colors are lean-relative (green = pushes toward the current lean,
// red = pushes against it), matching the evidence side encoding. On the
// NO-leaning demo, "Pushes NO" is green — same as the design.
function stanceMeta(stance: AnalystStance, leanYes: boolean, locale: Locale): { label: string; dot: string } {
  if (stance === "question") return { label: render(RS.stanceQuestion, locale), dot: "var(--val)" };
  const label = stance === "yes" ? render(RS.stancePushYes, locale) : render(RS.stancePushNo, locale);
  const towardLean = (stance === "yes") === leanYes;
  return { label, dot: towardLean ? "var(--pos)" : "var(--neg)" };
}

export function buildQueued(
  notes: readonly AnalystNote[],
  blocks: readonly BlockVM[],
  allIterations: readonly IterationVM[],
  nextRound: number,
  complete: boolean,
  leanYes: boolean,
  locale: Locale
): QueuedVM[] {
  const shown = blocks.flatMap((b) => b.evidence);
  const targetLabelFor = (targetId: string | null): string => {
    if (!targetId) return render(RS.targetGeneral, locale);
    const row = shown.find((e) => e.id === targetId);
    if (row) return render(RS.targetOnEvidence, locale, { idx: row.idx });
    const anywhere = allIterations.flatMap((it) => it.evidence).find((e) => e.id === targetId);
    return anywhere ? anywhere.dom : targetId;
  };
  return [...notes]
    .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : a.createdAtUtc > b.createdAtUtc ? -1 : 0))
    .map((n) => {
      const meta = stanceMeta(n.stance, leanYes, locale);
      const folded = n.consumedRound !== null && n.consumedRound !== undefined;
      return {
        id: n.id,
        text: n.text,
        stanceLabel: meta.label,
        dotColor: meta.dot,
        targetLabel: targetLabelFor(n.targetId),
        tagText: folded
          ? render(RS.tagFolded, locale, { n: String(n.consumedRound).padStart(2, "0") })
          : complete
            ? render(RS.tagSaved, locale)
            : render(RS.tagQueued, locale, { n: nextRound }),
        tagColor: folded || complete ? "var(--verified)" : "var(--accent)",
        removable: !folded
      };
    });
}
