"use client";

// Screen 02 · Research — the live-run view where an analyst annotates evidence
// (circle to keep, strike to doubt, attach notes) and queues hypotheses for
// the next iteration. One component tree, two data sources: the frozen GTA 6
// demo snapshot ("gta6-demo") and live engine runs via useForecast polling.

import { useParams } from "next/navigation";
import { StructuredForecast } from "../../../../components/research/structured-forecast";
import { useEffect, useMemo, useRef, useState } from "react";
import { RvShell } from "../../../../components/chrome/rv-shell";
import { IconDefs } from "../../../../components/icons";
import { AnalystDesk } from "../../../../components/research/analyst-desk";
import { FocusCenter } from "../../../../components/research/focus-center";
import { IterationBlock } from "../../../../components/research/iteration-block";
import { PlanList, RavenMessage } from "../../../../components/research/plan";
import { ProgressDock, type DockTone } from "../../../../components/research/progress-dock";
import {
  buildDemoBlocks,
  buildLiveBlocks,
  buildPlanSteps,
  buildQueued,
  DEMO_NOW,
  DEMO_TRAIL,
  nextRoundFor,
  readingFromJob,
  type BlockVM,
  type JobX,
  type ReadingVM
} from "../../../../components/research/research-vm";
import { FramingBlock, LoadingBlock, NoticeCard } from "../../../../components/research/state-cards";
import { StatusStrip, type NowLine, type QuantVM } from "../../../../components/research/status-strip";
import { useAnnotations } from "../../../../components/research/use-annotations";
import { useStaggeredReveal } from "../../../../components/research/use-reveal";
import { VerdictDigest } from "../../../../components/research/verdict-digest";
import { useForecast } from "../../../../lib/client/use-forecast";
import { useLocale, useT } from "../../../../lib/i18n";
import { RS } from "../../../../lib/i18n/ui";
import { STATUS_LABELS } from "../../../../lib/i18n/verdict";
import { isIncompleteStatus } from "../../../../lib/vm/forecast-status";
import { GTA6_DEMO, GTA6_DEMO_ID } from "../../../../lib/demo/gta6";
import type { AnalystStance } from "../../../../lib/server/analyst";
import { formatElapsed } from "../../../../lib/vm/format";
import "./research.css";

// The design's frozen demo moment starts its clock at 21m 04s and counts up.
const DEMO_ELAPSED_BASE_SEC = 1264;

function useNowTick(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) {
      setNow(null);
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function demoElapsed(now: number | null, t0: number | null): string {
  const extra = now !== null && t0 !== null ? Math.max(0, Math.floor((now - t0) / 1000)) : 0;
  const s = DEMO_ELAPSED_BASE_SEC + extra;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function ResearchPage() {
  const params = useParams<{ id: string }>();
  const rawId = params?.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";
  const isDemo = id === GTA6_DEMO_ID;

  const { locale } = useLocale();
  const t = useT();
  const { data, error, refresh } = useForecast(id);
  const ann = useAnnotations(id, data?.analyst, refresh);

  // Composer state (shared draft for the evidence note input, per the design).
  const [composerText, setComposerText] = useState("");
  const [stance, setStance] = useState<AnalystStance>("no");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const dossier = isDemo ? GTA6_DEMO : (data?.dossier ?? null);
  const job = (data?.job ?? null) as JobX | null;
  const running = isDemo ? true : dossier ? dossier.status === "running" : job?.status === "running";
  const framing = !isDemo && running && dossier === null;

  const now = useNowTick(running);
  const [demoT0, setDemoT0] = useState<number | null>(null);
  useEffect(() => {
    if (isDemo) setDemoT0(Date.now());
  }, [isDemo]);

  const blocks: BlockVM[] = useMemo(() => {
    if (isDemo) return buildDemoBlocks(GTA6_DEMO, locale);
    if (!dossier) return [];
    // Framing persisted but round 1 still running: show a round-1 placeholder
    // block so the feed reads "researching" instead of sitting empty.
    if (dossier.iterations.length === 0 && running) {
      const p = dossier.meta.prior;
      return [
        {
          n: "01",
          reasoningId: "r1",
          status: t(RS.statusRunningSpan, { from: p, to: p }),
          span: `${p} → ${p}`,
          move: t(RS.moveSoFar, { arrow: "—", net: "0%" }),
          moveDir: "flat",
          note: t(RS.placeholderNote, { p }),
          evidence: [],
          reading: readingFromJob(job, locale),
          analystFolded: 0
        }
      ];
    }
    return buildLiveBlocks(dossier.iterations, running, readingFromJob(job, locale), locale);
  }, [isDemo, dossier, running, job, locale, t]);

  const maxRounds = isDemo ? 3 : (dossier?.maxRounds ?? job?.maxRounds ?? 0);
  const nextRound = nextRoundFor(blocks.length, maxRounds);
  const complete = !isDemo && !running && dossier?.status === "complete";
  const incomplete = !isDemo && !running && (isIncompleteStatus(dossier?.status) || isIncompleteStatus(job?.status));
  const aborted = !isDemo && !running && (job?.status === "error" || dossier?.status === "failed");

  // --- Manus-style plan checklist + progressive reveal ---
  const prior = dossier?.meta.prior ?? null;
  const planSteps = useMemo(
    () => buildPlanSteps({ framing, blocks, maxRounds, running, complete, prior, locale }),
    [framing, blocks, maxRounds, running, complete, prior, locale]
  );
  const revealIds = useMemo(() => blocks.flatMap((b) => [`it${b.n}`, ...b.evidence.map((e) => e.id)]), [blocks]);
  const { visible, animated } = useStaggeredReveal(revealIds, !isDemo && running);

  // Fold completed rounds to one-line receipts while a newer round is live
  // (Manus-style: attention stays on the active step). Manual toggles win;
  // terminal runs default to everything expanded for review/annotation.
  const [foldOverride, setFoldOverride] = useState<Record<string, boolean>>({});
  const foldedFor = (blockN: string, index: number): boolean =>
    foldOverride[blockN] ?? (running && index < blocks.length - 1);
  const toggleFold = (blockN: string, index: number) =>
    setFoldOverride((cur) => ({ ...cur, [blockN]: !foldedFor(blockN, index) }));

  // Trail of sources the engine visited this round — accumulated client-side
  // from the polled job log (the log only exposes the latest line).
  const [trail, setTrail] = useState<ReadingVM[]>([]);
  const trailRound = useRef(0);
  useEffect(() => {
    if (isDemo || !running) return;
    if (trailRound.current !== blocks.length) {
      trailRound.current = blocks.length;
      setTrail([]);
      return;
    }
    const r = readingFromJob(job, locale);
    if (!r.domain) return;
    setTrail((cur) => {
      const last = cur[cur.length - 1];
      if (last?.domain === r.domain) return cur;
      return [...cur.slice(-3), r];
    });
  }, [isDemo, running, job, blocks.length, locale]);
  const liveReads = isDemo ? DEMO_TRAIL : trail;

  // Gentle auto-follow: when new items stream in and the reader is already
  // near the bottom, keep the newest content in view (never fight a reader
  // who has scrolled up to annotate).
  const revealedCount = visible.size;
  const prevRevealed = useRef(0);
  useEffect(() => {
    if (isDemo || !running) return;
    if (revealedCount <= prevRevealed.current) {
      prevRevealed.current = revealedCount;
      return;
    }
    prevRevealed.current = revealedCount;
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 320;
    if (nearBottom) window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }, [revealedCount, isDemo, running]);

  const startedIso = job?.startedAtUtc ?? dossier?.startedAtUtc ?? null;
  const startedAt = isDemo
    ? "replay"
    : startedIso
      ? new Date(startedIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;
  const providerLabel = isDemo ? "demo" : (job?.provider ?? dossier?.provider ?? null);

  const activeStep = planSteps.find((s) => s.state === "active");
  let dockTone: DockTone = "live";
  let dockLabel = activeStep ? `${activeStep.label}${activeStep.sub ? ` — ${activeStep.sub}` : ""}` : t(RS.dockWorking);
  if (complete && dossier) {
    dockTone = "complete";
    dockLabel = t(RS.dockComplete, { p: dossier.meta.prob });
  } else if (incomplete) {
    dockTone = "error";
    dockLabel = t(RS.dockIncomplete);
  } else if (aborted) {
    dockTone = "error";
    dockLabel = t(RS.dockAborted);
  }
  const dockElapsed = isDemo
    ? demoElapsed(now, demoT0)
    : running && startedIso
      ? formatElapsed(startedIso, now ?? Date.parse(startedIso))
      : null;

  // --- header status (pulsing dot + mono text) ---
  const sourcesShown = blocks.reduce((acc, b) => acc + b.evidence.length, 0);
  let headerText: string | null = null;
  let headerLive = false;
  if (isDemo) {
    headerText = t(RS.headerLive, { cur: 2, max: 3, elapsed: demoElapsed(now, demoT0), n: "08" });
    headerLive = true;
  } else if (running && startedIso) {
    const cur = maxRounds === 0 ? Math.max(blocks.length, 1) : Math.min(Math.max(blocks.length, 1), maxRounds);
    const elapsed = formatElapsed(startedIso, now ?? Date.parse(startedIso));
    headerText = t(maxRounds === 0 ? RS.headerLiveUnbounded : RS.headerLive, {
      cur,
      max: maxRounds,
      elapsed,
      n: String(sourcesShown).padStart(2, "0")
    });
    headerLive = true;
  } else if (dossier && dossier.status === "complete") {
    headerText = t(RS.headerComplete, { dur: dossier.meta.duration, n: dossier.meta.sources.padStart(2, "0") });
  } else if (incomplete) {
    headerText = dossier ? t(STATUS_LABELS[dossier.status]).toUpperCase() : t(RS.incompleteTitle);
  } else if (aborted) {
    headerText = t(RS.headerAborted);
  } else if (job?.status === "unforecastable") {
    headerText = t(RS.headerUnforecastable);
  }
  const headerRight = headerText ? (
    <span
      className="rv-hdr-meta"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontFamily: "var(--fm)",
        fontSize: 10,
        letterSpacing: ".05em",
        color: "var(--muted)"
      }}
    >
      {headerLive && (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent)",
            animation: "rv-pulse 1.8s ease-out infinite",
            flex: "none"
          }}
        />
      )}
      {headerText}
    </span>
  ) : undefined;

  // --- status strip content ---
  const question = isDemo
    ? GTA6_DEMO.meta.question
    : (dossier?.meta.question ?? job?.question ?? t(RS.framingQuestion));
  const nowLine: NowLine | null = isDemo
    ? DEMO_NOW
    : running && dossier
      ? {
          bold: t(RS.nowRoundBold, {
            n: maxRounds === 0 ? Math.max(blocks.length, 1) : Math.min(Math.max(blocks.length, 1), maxRounds)
          }),
          rest: t(RS.nowRoundRest)
        }
      : null;
  let quant: QuantVM | null = null;
  if (isDemo) {
    quant = { nowPct: 18, priorPct: 38, label: t(RS.quantProvisional) };
  } else if (dossier && dossier.currentProb !== null && dossier.priorProb !== null) {
    quant = {
      nowPct: Math.round(dossier.currentProb * 100),
      priorPct: Math.round(dossier.priorProb * 100),
      label: complete ? t(RS.quantFinal) : t(RS.quantProvisional)
    };
  }

  // --- analyst desk data ---
  const markSummary = t(RS.markSummary, { k: ann.keptCount, d: ann.doubtedCount, n: ann.notes.length });
  const leanYes = (dossier?.currentProb ?? dossier?.priorProb ?? 0) >= 0.5;
  const queued = useMemo(
    () =>
      buildQueued(
        ann.notes,
        blocks,
        dossier?.iterations ?? [],
        nextRound,
        complete || incomplete || aborted,
        leanYes,
        locale
      ),
    [ann.notes, blocks, dossier, nextRound, complete, incomplete, aborted, leanYes, locale]
  );

  const onToggleNote = (evidenceId: string) => {
    setNoteFor((cur) => (cur === evidenceId ? null : evidenceId));
    setNoteDraft("");
  };
  const onNoteSubmit = (evidenceId: string) => {
    if (ann.addNote({ text: noteDraft, stance, targetId: evidenceId })) {
      setNoteDraft("");
      setNoteFor(null);
    }
  };
  const onDeskSubmit = () => {
    if (ann.addNote({ text: composerText, stance, targetId: null })) setComposerText("");
  };

  const { toast, clearToast } = ann;
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(clearToast, 4200);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  // --- terminal / empty states (live mode only) ---
  let notice: React.ReactNode = null;
  if (!isDemo && !data) {
    notice = error ? (
      /not found/i.test(error) ? (
        <NoticeCard tone="info" title={t(RS.notFoundTitle)}>
          {t(RS.notFoundBody)}
        </NoticeCard>
      ) : (
        <NoticeCard tone="error" title={t(RS.loadFailTitle)}>
          {t(RS.loadFailBody, { err: error })}
        </NoticeCard>
      )
    ) : (
      <LoadingBlock />
    );
  } else if (!isDemo && data && !dossier) {
    if (job?.status === "unforecastable") {
      notice = (
        <NoticeCard tone="info" title={t(RS.vagueTitle)} log={job.log.slice(-6)}>
          {job.question ? t(RS.vagueBodyQuoted, { q: job.question }) : t(RS.vagueBodyPlain)} {t(RS.vagueBodyTail)}
        </NoticeCard>
      );
    } else if (incomplete) {
      notice = (
        <NoticeCard tone="error" title={t(RS.incompleteTitle)} log={job?.log.slice(-8)}>
          {t(RS.incompleteBody)}
        </NoticeCard>
      );
    } else if (job?.status === "error") {
      notice = (
        <NoticeCard tone="error" title={t(RS.abortedTitle)} log={job.log.slice(-8)}>
          {t(RS.abortedBodyTerminal)}
        </NoticeCard>
      );
    } else if (!job) {
      notice = (
        <NoticeCard tone="info" title={t(RS.notFoundTitle)}>
          {t(RS.notFoundBody)}
        </NoticeCard>
      );
    }
  }

  if (dossier?.structured)
    return <StructuredForecast dossier={{ ...dossier, structured: dossier.structured }} mode="research" />;

  if (notice) {
    return (
      <RvShell active="research" forecastId={id} showFooter={false} headerRight={headerRight}>
        <div className="rv-research">{notice}</div>
      </RvShell>
    );
  }

  return (
    <RvShell active="research" forecastId={id} showFooter={false} headerRight={headerRight}>
      <IconDefs />
      <div className="rv-research has-dock">
        {incomplete && (
          <NoticeCard tone="error" title={dossier ? t(STATUS_LABELS[dossier.status]) : t(RS.incompleteTitle)} inline>
            {dossier?.researchBlocker ?? t(RS.incompleteBody)}
          </NoticeCard>
        )}
        <StatusStrip question={question} now={nowLine} quant={quant} />
        <div className="rvp-grid">
          <div>
            <RavenMessage provider={providerLabel} time={startedAt}>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)" }}>
                {t(
                  incomplete || aborted ? RS.planIntroStopped : maxRounds === 0 ? RS.planIntroUnbounded : RS.planIntroA,
                  { n: maxRounds }
                )}
                <b style={{ color: "var(--text)" }}>{t(RS.planIntroBold)}</b>
                {t(RS.planIntroB)}
              </p>
              <div style={{ marginTop: 15 }}>
                <PlanList steps={planSteps} />
              </div>
            </RavenMessage>
            {dossier?.researchPlan ? (
              <FocusCenter
                plan={dossier.researchPlan}
                evidence={dossier.iterations.flatMap((iteration) => iteration.evidence)}
              />
            ) : null}
            {aborted && (
              <NoticeCard
                tone="error"
                title={t(RS.abortedTitle)}
                inline
                log={job?.status === "error" ? job.log.slice(-6) : undefined}
              >
                {t(RS.abortedBodyInline)}
              </NoticeCard>
            )}
            {framing ? (
              <FramingBlock />
            ) : (
              blocks.map((block, i) =>
                visible.has(`it${block.n}`) ? (
                  <IterationBlock
                    key={block.n}
                    block={{ ...block, evidence: block.evidence.filter((ev) => visible.has(ev.id)) }}
                    animatedIds={animated}
                    collapsed={foldedFor(block.n, i)}
                    onToggleCollapse={() => toggleFold(block.n, i)}
                    recentReads={liveReads}
                    marks={ann.marks}
                    onMark={ann.toggleMark}
                    notes={ann.notes}
                    noteFor={noteFor}
                    onToggleNote={onToggleNote}
                    noteDraft={noteDraft}
                    onNoteDraft={setNoteDraft}
                    onNoteSubmit={onNoteSubmit}
                  />
                ) : null
              )
            )}
            {complete && dossier && <VerdictDigest id={id} dossier={dossier} />}
          </div>
          <AnalystDesk
            markSummary={markSummary}
            nextRound={nextRound}
            complete={complete}
            stopped={incomplete || aborted}
            composerText={composerText}
            onComposerText={setComposerText}
            stance={stance}
            onStance={setStance}
            onSubmit={onDeskSubmit}
            queued={queued}
            onRemove={ann.removeNote}
          />
        </div>
      </div>
      <ProgressDock
        unbounded={maxRounds === 0}
        tone={dockTone}
        label={dockLabel}
        steps={planSteps}
        ctaHref={complete ? `/forecast/${id}` : null}
        elapsed={dockElapsed}
      />
      {toast && (
        <div className="rv-research-toast" role="alert">
          {toast}
        </div>
      )}
    </RvShell>
  );
}
