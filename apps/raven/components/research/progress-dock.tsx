"use client";

// Manus-style docked progress bar: a floating pill fixed to the bottom of the
// research screen showing the current step + "N / M" counter, expandable to
// the full plan checklist. Turns into the completion CTA when the run ends.

import Link from "next/link";
import { useState } from "react";
import { useT } from "../../lib/i18n";
import { RS } from "../../lib/i18n/ui";
import { PlanList } from "./plan";
import { planStepNo, type PlanStepVM } from "./research-vm";

export type DockTone = "live" | "complete" | "error";

function DockDot({ tone }: { tone: DockTone }) {
  if (tone === "complete") {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={{ color: "var(--verified)", flex: "none" }}>
        <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
        <path d="M5.2 8.3l1.9 1.9 3.8-4.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: tone === "error" ? "var(--neg)" : "var(--accent)",
        animation: tone === "live" ? "rv-pulse 1.8s ease-out infinite" : undefined,
        flex: "none"
      }}
    />
  );
}

export function ProgressDock({
  tone,
  label,
  steps,
  ctaHref,
  elapsed,
  unbounded = false
}: {
  tone: DockTone;
  unbounded?: boolean;
  label: string;
  steps: readonly PlanStepVM[];
  ctaHref: string | null; // dossier link, shown when the run is complete
  elapsed?: string | null; // live run clock, e.g. "05m 12s"
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const stepNo = planStepNo(steps);

  return (
    <div className="rvp-dock" role="status" aria-live="polite">
      {expanded && (
        <div className="rvp-dock-panel">
          <PlanList steps={steps} compact />
        </div>
      )}
      <div className="rvp-dock-bar">
        <DockDot tone={tone} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--fm)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".03em",
            color: tone === "error" ? "var(--neg)" : tone === "complete" ? "var(--verified)" : "var(--text)"
          }}
        >
          {label}
        </span>
        {elapsed && tone === "live" && (
          <span style={{ fontFamily: "var(--fm)", fontSize: 10, color: "var(--faint)", flex: "none" }}>{elapsed}</span>
        )}
        <span style={{ fontFamily: "var(--fm)", fontSize: 10, color: "var(--faint)", flex: "none" }}>
          {unbounded && tone === "live" ? t(RS.dockStep, { n: stepNo }) : `${stepNo} / ${steps.length}`}
        </span>
        {tone === "complete" && ctaHref && (
          <Link
            href={ctaHref}
            className="cta"
            style={{
              flex: "none",
              background: "var(--accent)",
              color: "var(--accent-ink)",
              textDecoration: "none",
              fontFamily: "var(--fm)",
              fontWeight: 600,
              fontSize: 9.5,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              borderRadius: 8,
              padding: "7px 12px"
            }}
          >
            {t(RS.dockCta)}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? t(RS.dockHidePlan) : t(RS.dockShowPlan)}
          style={{
            flex: "none",
            cursor: "pointer",
            background: "none",
            border: "1px solid var(--line2)",
            borderRadius: 7,
            color: "var(--muted)",
            width: 26,
            height: 26,
            display: "grid",
            placeItems: "center",
            padding: 0
          }}
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
            style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform .15s" }}
          >
            <path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
