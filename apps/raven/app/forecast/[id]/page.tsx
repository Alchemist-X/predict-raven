"use client";

// Screen 03 · Verdict — the final report: hero (question, giant P(YES),
// collapse axis, confidence meter), the-why rail with core signals and the
// strongest counter-signal, Raven's summary with anchor highlights, the
// evidence book and the folded resolution & framing section. Renders both the
// archived demo dossier and live runs through one DossierVM code path.

import Link from "next/link";
import { StructuredForecast } from "../../../components/research/structured-forecast";
import { useParams } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { RvShell } from "../../../components/chrome/rv-shell";
import { ArrowIcon, IconDefs } from "../../../components/icons";
import { useForecast } from "../../../lib/client/use-forecast";
import { confidenceLabel, sourcesLabel, useLocale, useT, verdictLabel } from "../../../lib/i18n";
import { rankEntry, STATUS_LABELS, V } from "../../../lib/i18n/verdict";
import { cap, credWord } from "../../../lib/vm/format";
import type { DossierVM } from "../../../lib/vm/types";
import { decorateDossier, percentOf, roundUpTen } from "./decorate";
import { DecisionSections } from "./decision-sections";
import { EvidenceBook } from "./evidence-book";
import { CredPill, DomChip, ValuePill } from "./pills";
import { renderIdxRefs, renderRich } from "./rich-text";
import "./report.css";

const KICKER_ACCENT: CSSProperties = {
  fontFamily: "var(--fm)",
  fontSize: 10,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "var(--accent)"
};

const RF_KICKER: CSSProperties = {
  fontFamily: "var(--fm)",
  fontSize: 9.5,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--faint)",
  marginBottom: 6
};

const RF_BODY: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--muted)" };

const CONF_FILL: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

function CenterNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "70px 24px",
        textAlign: "center"
      }}
    >
      {children}
    </div>
  );
}

function NotFound() {
  const t = useT();
  return (
    <CenterNote>
      <div
        style={{
          fontFamily: "var(--fm)",
          fontSize: 12,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--muted)"
        }}
      >
        {t(V.notFound)}
      </div>
      <Link href="/" style={{ fontFamily: "var(--fm)", fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>
        {t(V.backToAsk)}
      </Link>
    </CenterNote>
  );
}

export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, error } = useForecast(id);
  const t = useT();

  if (!data) {
    const notFound = error === "not found" || error === "invalid id";
    return (
      <RvShell active="verdict" forecastId={notFound ? undefined : id}>
        {notFound ? (
          <NotFound />
        ) : (
          <CenterNote>
            <div style={{ fontFamily: "var(--fm)", fontSize: 11, letterSpacing: ".08em", color: "var(--muted)" }}>
              {t(V.loadingDossier)}
            </div>
            {error ? (
              <div style={{ fontFamily: "var(--fm)", fontSize: 10, color: "var(--faint)" }}>
                {t(V.retrying, { err: error })}
              </div>
            ) : null}
          </CenterNote>
        )}
      </RvShell>
    );
  }

  const dossier = data.dossier;
  if (!dossier) {
    if (data.job) {
      return (
        <RvShell active="verdict" forecastId={id}>
          <CenterNote>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                fontFamily: "var(--fm)",
                fontSize: 11,
                letterSpacing: ".05em",
                color: "var(--muted)"
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  animation: "rv-blink 1.4s ease infinite"
                }}
              />
              <span>
                {t(V.stillRunning)}{" "}
                <Link href={`/forecast/${id}/research`} style={{ color: "var(--accent)" }}>
                  {t(V.watchLive)}
                </Link>
              </span>
            </div>
          </CenterNote>
        </RvShell>
      );
    }
    return (
      <RvShell active="verdict">
        <NotFound />
      </RvShell>
    );
  }

  if (dossier.structured)
    return <StructuredForecast dossier={{ ...dossier, structured: dossier.structured }} mode="verdict" />;
  return <Report id={id} dossier={dossier} />;
}

function Report({ id, dossier }: { id: string; dossier: DossierVM }) {
  const t = useT();
  const { locale } = useLocale();
  const meta = dossier.meta;
  const { iterations, byIdx, core, counter } = decorateDossier(dossier);

  // Collapse axis geometry — axis max scales past the 0–40% design default
  // when the prior (or current) probability needs the headroom.
  const cur = percentOf(dossier.currentProb, meta.prob) ?? 0;
  const prior = percentOf(dossier.priorProb, meta.prior) ?? cur;
  const axisMax = Math.max(40, roundUpTen(prior), roundUpTen(cur));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(axisMax * f));
  const curLeft = (cur / axisMax) * 100;
  const priorLeft = (prior / axisMax) * 100;
  const bandLeft = Math.min(curLeft, priorLeft);
  const bandRight = 100 - Math.max(curLeft, priorLeft);
  const bandGradient =
    cur <= prior
      ? "linear-gradient(90deg,color-mix(in srgb,var(--accent) 38%,transparent),transparent)"
      : "linear-gradient(270deg,color-mix(in srgb,var(--accent) 38%,transparent),transparent)";
  const confFill = CONF_FILL[meta.confidence];
  const confColor = `var(--cred-${credWord(meta.confidence)})`;

  return (
    <RvShell
      active="verdict"
      forecastId={id}
      headerRight={
        <span
          className="rv-hdr-meta"
          style={{ fontFamily: "var(--fm)", fontSize: 10, letterSpacing: ".05em", color: "var(--muted)" }}
        >
          {t(STATUS_LABELS[dossier.status]).toUpperCase()} · {meta.duration} ·{" "}
          {sourcesLabel(meta.sources, locale).toUpperCase()}
        </span>
      }
    >
      <IconDefs />
      <div className="rv-report">
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {dossier.status === "running" ? (
            <div
              className="rp-banner"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "11px 14px",
                border: "1px solid color-mix(in srgb,var(--accent) 45%,transparent)",
                borderRadius: 11,
                background: "color-mix(in srgb,var(--accent) 7%,transparent)",
                fontFamily: "var(--fm)",
                fontSize: 11,
                letterSpacing: ".03em",
                color: "var(--muted)"
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  flex: "none",
                  borderRadius: "50%",
                  background: "var(--accent)",
                  animation: "rv-blink 1.4s ease infinite"
                }}
              />
              <span>
                {t(V.stillRunning)}{" "}
                <Link href={`/forecast/${id}/research`} className="lnk" style={{ color: "var(--accent)" }}>
                  {t(V.watchLive)}
                </Link>
              </span>
            </div>
          ) : null}
          {dossier.status !== "complete" && dossier.status !== "running" ? (
            <div
              className="rp-banner"
              style={{
                padding: "11px 14px",
                border: "1px solid color-mix(in srgb,var(--neg) 40%,transparent)",
                borderRadius: 11,
                background: "color-mix(in srgb,var(--neg) 8%,transparent)",
                fontFamily: "var(--fm)",
                fontSize: 11,
                letterSpacing: ".03em",
                color: "var(--neg)"
              }}
            >
              {t(STATUS_LABELS[dossier.status])}. {dossier.researchBlocker ?? t(V.incompleteBody)}
            </div>
          ) : null}

          {/* hero */}
          <div className="rp-hero">
            <div className="rp-hero-left">
              <h1
                style={{
                  margin: 0,
                  fontWeight: 500,
                  fontSize: 31,
                  lineHeight: 1.16,
                  letterSpacing: "-.01em",
                  maxWidth: "17ch"
                }}
              >
                {meta.question}
              </h1>
              {dossier.status !== "complete" ? <p role="status" style={{ color: "var(--muted)" }}>{t(V.workingEstimate)}</p> : null}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginTop: 22 }}>
                <div
                  className="rp-prob"
                  style={{
                    fontFamily: "var(--fd)",
                    fontWeight: 600,
                    lineHeight: 0.82,
                    color: "var(--accent)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-.02em"
                  }}
                >
                  {meta.prob}
                </div>
                <div style={{ paddingBottom: 9 }}>
                  <div
                    style={{
                      fontFamily: "var(--fd)",
                      fontStyle: "italic",
                      fontWeight: 500,
                      fontSize: 27,
                      lineHeight: 1
                    }}
                  >
                    {verdictLabel(meta.verdict, locale)}
                  </div>
                  {meta.quip ? (
                    <div
                      style={{ fontSize: 14, lineHeight: 1.4, color: "var(--muted)", marginTop: 7, maxWidth: "22ch" }}
                    >
                      {meta.quip}
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ marginTop: 28 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: "var(--fm)",
                    fontSize: 9.5,
                    letterSpacing: ".04em",
                    color: "var(--faint)",
                    marginBottom: 6
                  }}
                >
                  {ticks.map((t, i) => (
                    <span key={i}>{t}%</span>
                  ))}
                </div>
                <div
                  style={{
                    position: "relative",
                    height: 12,
                    borderRadius: 6,
                    background: "color-mix(in srgb,var(--text) 7%,transparent)"
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${bandLeft}%`,
                      right: `${bandRight}%`,
                      borderRadius: 6,
                      background: bandGradient
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${priorLeft}%`,
                      width: 11,
                      height: 11,
                      transform: "translate(-50%,-50%)",
                      borderRadius: "50%",
                      border: "2px solid var(--faint)",
                      background: "var(--bg)"
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${curLeft}%`,
                      width: 15,
                      height: 15,
                      transform: "translate(-50%,-50%)",
                      borderRadius: "50%",
                      background: "var(--accent)",
                      border: "2px solid var(--bg)",
                      animation: "rv-pulse 1.8s ease-out infinite"
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontFamily: "var(--fm)",
                    fontSize: 10.5,
                    color: "var(--muted)"
                  }}
                >
                  {/* The engine's interval is an uncalibrated heuristic — deliberately
                      not shown (user decision 2026-07-02) until the scoring loop can
                      back a real coverage claim. */}
                  <span />
                  <span style={{ color: "var(--faint)" }}>
                    {t(V.priorNotePre)}
                    <span style={{ color: "var(--muted)" }}>{meta.prior}</span>
                    {t(V.priorNotePost)}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  marginTop: 24,
                  paddingTop: 18,
                  borderTop: "1px solid var(--line)"
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--fm)",
                    fontSize: 10,
                    letterSpacing: ".15em",
                    textTransform: "uppercase",
                    color: "var(--faint)"
                  }}
                >
                  {t(V.confidence)}
                </div>
                <div
                  style={{ display: "flex", gap: 3 }}
                  title={t(V.confTooltip, {
                    conf: locale === "zh" ? confidenceLabel(meta.confidence, locale) : cap(meta.confidence)
                  })}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{
                        width: 22,
                        height: 6,
                        borderRadius: 2,
                        background: i < confFill ? confColor : "color-mix(in srgb,var(--text) 10%,transparent)"
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontFamily: "var(--fm)", fontSize: 11, fontWeight: 600, color: confColor }}>
                  {confidenceLabel(meta.confidence, locale).toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--faint)",
                    lineHeight: 1.35,
                    borderLeft: "1px solid var(--line2)",
                    paddingLeft: 10,
                    flex: 1
                  }}
                >
                  {meta.confWhy}
                </span>
              </div>
            </div>

            {/* hero right */}
            <div className="rp-hero-right">
              <div style={{ ...KICKER_ACCENT, marginBottom: 9 }}>{t(V.theWhy)}</div>
              <p style={{ margin: "0 0 20px", fontFamily: "var(--fd)", fontSize: 16, lineHeight: 1.46 }}>{meta.why}</p>

              <div
                style={{
                  fontFamily: "var(--fm)",
                  fontSize: 10,
                  letterSpacing: ".18em",
                  textTransform: "uppercase",
                  color: "var(--faint)",
                  marginBottom: 11
                }}
              >
                {t(V.coreSignals)}
              </div>
              {core.map((c) => (
                <a
                  key={c.id}
                  href={c.href}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                    display: "block",
                    border: "1px solid var(--line)",
                    borderRadius: 11,
                    padding: "11px 12px",
                    background: "var(--surface)",
                    marginBottom: 9
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        fontFamily: "var(--fm)",
                        fontSize: 8.5,
                        fontWeight: 600,
                        letterSpacing: ".09em",
                        textTransform: "uppercase",
                        color: "var(--accent-ink)",
                        background: "var(--accent)",
                        padding: "3px 6px",
                        borderRadius: 4
                      }}
                    >
                      {t(rankEntry(c.rank))}
                    </span>
                    <span
                      className={`mv-${c.dir}`}
                      style={{ marginLeft: "auto", fontFamily: "var(--fm)", fontSize: 11, fontWeight: 600 }}
                    >
                      {c.from} → {c.to}
                    </span>
                  </div>
                  <div style={{ fontFamily: "var(--fd)", fontWeight: 600, fontSize: 15.5, lineHeight: 1.26 }}>
                    {c.title}
                  </div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.44, color: "var(--muted)", marginTop: 5 }}>
                    {c.takeaway}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
                    <DomChip e={c} />
                    <CredPill e={c} variant="core" />
                    <ValuePill e={c} variant="core" />
                  </div>
                </a>
              ))}

              {counter && dossier.topCounter ? (
                <div style={{ marginTop: "auto", paddingTop: 14 }}>
                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px solid color-mix(in srgb,var(--neg) 26%,transparent)",
                      borderRadius: 11,
                      background: "color-mix(in srgb,var(--neg) 7%,transparent)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontFamily: "var(--fm)",
                          fontSize: 9.5,
                          letterSpacing: ".13em",
                          textTransform: "uppercase",
                          color: "var(--neg)"
                        }}
                      >
                        {t(V.strongestCounter)}
                      </span>
                      <span
                        className={`mv-${counter.dir}`}
                        style={{ marginLeft: "auto", fontFamily: "var(--fm)", fontSize: 11.5, fontWeight: 600 }}
                      >
                        {counter.arrow} {counter.deltaAbs}
                      </span>
                    </div>
                    <a
                      className="lnk"
                      href={counter.href}
                      style={{
                        display: "block",
                        color: "inherit",
                        fontFamily: "var(--fd)",
                        fontWeight: 600,
                        fontSize: 14.5,
                        lineHeight: 1.3,
                        marginTop: 7
                      }}
                    >
                      {counter.title}
                    </a>
                    <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)", marginTop: 5 }}>
                      {renderIdxRefs(dossier.topCounter.resolution)}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* summary */}
          <div className="rp-summary" style={{ borderTop: "1px solid var(--line)" }}>
            <div style={{ ...KICKER_ACCENT, marginBottom: 12 }}>{t(V.ravensSummary)}</div>
            {dossier.summaryParagraphs.map((p, i) => {
              const dropCap = i === 0 && /^[A-Za-z]/.test(p);
              const body = dropCap ? p.slice(1) : p;
              return (
                <p
                  key={i}
                  style={{ margin: i === 0 ? 0 : "14px 0 0", fontFamily: "var(--fd)", fontSize: 17, lineHeight: 1.66 }}
                >
                  {dropCap ? (
                    <span
                      style={{
                        float: "left",
                        fontFamily: "var(--fd)",
                        fontWeight: 600,
                        fontSize: 58,
                        lineHeight: 0.78,
                        padding: "5px 12px 0 0",
                        color: "var(--accent)"
                      }}
                    >
                      {p.charAt(0)}
                    </span>
                  ) : null}
                  {renderRich(body, byIdx)}
                </p>
              );
            })}
            <div
              style={{
                display: "flex",
                gap: 11,
                marginTop: 18,
                padding: "13px 15px",
                borderRadius: 11,
                background: "var(--surface)",
                border: "1px solid var(--line)"
              }}
            >
              <span
                style={{
                  fontFamily: "var(--fm)",
                  fontSize: 9.5,
                  letterSpacing: ".13em",
                  textTransform: "uppercase",
                  color: "var(--neg)",
                  whiteSpace: "nowrap",
                  paddingTop: 2
                }}
              >
                {t(V.openRisk)}
              </span>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>{meta.openUnc}</p>
            </div>
          </div>

          <DecisionSections dossier={dossier} />

          {/* the book */}
          <EvidenceBook iterations={iterations} meta={meta} />

          {/* resolution & framing */}
          <details className="rf" style={{ borderTop: "1px solid var(--line)" }}>
            <summary
              className="rf-sum"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontFamily: "var(--fm)",
                fontSize: 10.5,
                letterSpacing: ".14em",
                textTransform: "uppercase",
                color: "var(--muted)"
              }}
            >
              <ArrowIcon className="rf-chev srcic" style={{ transition: "transform .18s", width: 12, height: 12 }} />
              {t(V.resolutionFraming)}
              <span
                style={{
                  marginLeft: "auto",
                  textTransform: "none",
                  letterSpacing: 0,
                  color: "var(--faint)",
                  fontSize: 11
                }}
              >
                {t(V.resolutionHint)}
              </span>
            </summary>
            <div className="rf-body">
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ ...RF_KICKER, color: "var(--accent)" }}>{t(V.normalizedQuestion)}</div>
                <p style={{ margin: 0, fontFamily: "var(--fd)", fontSize: 15, lineHeight: 1.5 }}>{meta.normQ}</p>
              </div>
              <div>
                <div style={RF_KICKER}>
                  {t(V.resolutionCriteria)}
                  {meta.resDate ? ` · ${meta.resDate}` : ""}
                </div>
                <p style={RF_BODY}>{meta.criteria}</p>
              </div>
              <div>
                <div style={RF_KICKER}>
                  {t(V.prior)} · {meta.prior}
                </div>
                <p style={RF_BODY}>{meta.priorWhy}</p>
              </div>
              <div>
                <div style={RF_KICKER}>{t(V.assumptions)}</div>
                <p style={RF_BODY}>{meta.assumptions}</p>
              </div>
              <div>
                <div style={RF_KICKER}>{t(V.settlementSource)}</div>
                <p style={RF_BODY}>{meta.settlement}</p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </RvShell>
  );
}
