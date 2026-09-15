"use client";

// The sticky right rail: hypothesis composer (textarea + 3-way stance control
// + queue button) and the queued-notes list with per-note status tags.

import { useT, type Entry } from "../../lib/i18n";
import { RP } from "../../lib/i18n/research-parts";
import type { AnalystStance } from "../../lib/server/analyst";
import type { QueuedVM } from "./research-vm";

const STANCES: Array<{ key: AnalystStance; label: Entry }> = [
  { key: "yes", label: RP.stanceYes },
  { key: "no", label: RP.stanceNo },
  { key: "question", label: RP.stanceQuestion }
];

export function AnalystDesk({
  markSummary,
  nextRound,
  complete,
  stopped = false,
  composerText,
  onComposerText,
  stance,
  onStance,
  onSubmit,
  queued,
  onRemove
}: {
  markSummary: string;
  nextRound: number;
  complete: boolean;
  stopped?: boolean;
  composerText: string;
  onComposerText: (value: string) => void;
  stance: AnalystStance;
  onStance: (stance: AnalystStance) => void;
  onSubmit: () => void;
  queued: readonly QueuedVM[];
  onRemove: (noteId: string) => void;
}) {
  const t = useT();
  return (
    <div className="rvp-rail">
      <div
        style={{
          background: "var(--bg2)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: "18px 18px 16px"
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <div
            style={{
              fontFamily: "var(--fm)",
              fontSize: 10,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: "var(--accent)"
            }}
          >
            {t(RP.deskTitle)}
          </div>
          <span style={{ fontFamily: "var(--fm)", fontSize: 9.5, color: "var(--faint)" }}>{markSummary}</span>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
          {stopped ? (
            t(RP.deskHelpStopped)
          ) : complete ? (
            <>
              {t(RP.deskHelpDonePre)}
              <b style={{ color: "var(--text)" }}>{t(RP.deskHelpDoneBold)}</b>
              {t(RP.deskHelpDonePost)}
            </>
          ) : (
            <>
              {t(RP.deskHelpRunPre)}
              <b style={{ color: "var(--text)" }}>{t(RP.deskHelpRunBold, { n: nextRound })}</b>
              {t(RP.deskHelpRunPost)}
            </>
          )}
        </p>
        <textarea
          value={composerText}
          onChange={(e) => onComposerText(e.target.value)}
          placeholder={t(RP.deskPlaceholder)}
          aria-label={t(RP.deskComposerAria)}
          style={{
            width: "100%",
            marginTop: 12,
            height: 76,
            resize: "vertical",
            background: "var(--bg)",
            border: "1px solid var(--line2)",
            borderRadius: 9,
            outline: "none",
            color: "var(--text)",
            fontFamily: "var(--fd)",
            fontSize: 13,
            lineHeight: 1.5,
            padding: "10px 12px"
          }}
        />
        <div role="radiogroup" aria-label={t(RP.deskStanceAria)} style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {STANCES.map((s) => {
            const on = stance === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={on}
                className="stanceb"
                onClick={() => onStance(s.key)}
                style={{
                  flex: 1,
                  border: `1px solid ${on ? "var(--accent)" : "var(--line2)"}`,
                  color: on ? "var(--accent)" : "var(--faint)",
                  borderRadius: 8,
                  fontFamily: "var(--fm)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: ".05em",
                  padding: "7px 4px"
                }}
              >
                {t(s.label)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="cta"
          onClick={onSubmit}
          style={{
            width: "100%",
            marginTop: 10,
            border: "none",
            cursor: "pointer",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontFamily: "var(--fm)",
            fontWeight: 600,
            fontSize: 10.5,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            padding: 12,
            borderRadius: 9
          }}
        >
          {complete || stopped ? t(RP.deskSubmitSave) : t(RP.deskSubmitQueue, { n: nextRound })}
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div
          style={{
            fontFamily: "var(--fm)",
            fontSize: 10,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: "var(--faint)",
            marginBottom: 9
          }}
        >
          {t(RP.deskQueuedHeading, { nn: String(queued.length).padStart(2, "0") })}
        </div>
        {queued.length > 0 ? (
          queued.map((n) => (
            <div
              key={n.id}
              style={{
                display: "flex",
                gap: 9,
                background: "var(--bg2)",
                border: "1px solid var(--line)",
                borderRadius: 11,
                padding: "11px 12px",
                marginBottom: 8
              }}
            >
              <span
                style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", marginTop: 5, background: n.dotColor }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--text)" }}>{n.text}</div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 5,
                    fontFamily: "var(--fm)",
                    fontSize: 8.5,
                    letterSpacing: ".06em",
                    color: "var(--faint)",
                    flexWrap: "wrap"
                  }}
                >
                  <span style={{ textTransform: "uppercase" }}>{n.stanceLabel}</span>
                  <span>·</span>
                  <span>{n.targetLabel}</span>
                  <span>·</span>
                  <span style={{ color: n.tagColor }}>{n.tagText}</span>
                </div>
              </div>
              {n.removable && (
                <button
                  type="button"
                  onClick={() => onRemove(n.id)}
                  title={t(RP.deskRemoveTitle)}
                  aria-label={t(RP.deskRemoveAria)}
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: "var(--faint)",
                    fontFamily: "var(--fm)",
                    fontSize: 12,
                    lineHeight: 1,
                    padding: "2px 4px",
                    height: "fit-content"
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))
        ) : (
          <div
            style={{
              border: "1px dashed var(--line2)",
              borderRadius: 11,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--faint)"
            }}
          >
            {t(stopped || complete ? RP.deskSavedEmpty : RP.deskQueuedEmpty)}
          </div>
        )}
      </div>
    </div>
  );
}
