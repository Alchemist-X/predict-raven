"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { answerLabel } from "@autopoly/forecast-engine/answer-types";
import { RvShell } from "../chrome/rv-shell";
import { useT } from "../../lib/i18n";
import { STRUCTURED as S } from "../../lib/i18n/structured";
import type { DossierVM, StructuredDossierVM } from "../../lib/vm/types";
import "./structured-forecast.css";

function CitationText({ text, count }: { text: string; count: number }): ReactNode {
  return text.split(/(\[\d+\])/).map((part, index) => {
    const number = /^\[(\d+)\]$/.exec(part)?.[1];
    return number && Number(number) > 0 && Number(number) <= count ? (
      <a key={index} href={`#structured-evidence-${Number(number)}`}>
        {part}
      </a>
    ) : (
      part
    );
  });
}

export function StructuredForecast({
  dossier,
  mode
}: {
  dossier: DossierVM & { structured: StructuredDossierVM };
  mode: "research" | "verdict";
}) {
  const t = useT();
  const detail = dossier.structured;
  const answer = detail.answer;
  const spec = detail.questionSpec;
  const rows: Array<{ id: string; label: string; probability: number; rank?: number }> =
    answer.kind === "numeric" ? [] : answer.kind === "categorical" ? answer.probabilities : answer.ranking;
  const tieNames =
    answer.kind === "numeric" ? [] : answer.tiedIds.map((id) => rows.find((row) => row.id === id)?.label ?? id);
  const text = (value: string) => <CitationText text={value} count={detail.evidence.length} />;
  return (
    <RvShell active={mode} forecastId={dossier.id}>
      <main className="rv-structured">
        <header>
          <p className="rv-structured-eyebrow">
            {t(S[answer.kind])} ·{" "}
            {t(S[dossier.status === "running" ? "running" : dossier.status === "failed" ? "failed" : "complete"])}
          </p>
          <h1>{spec.question}</h1>
          <p className="rv-structured-answer">{answerLabel(answer)}</p>
          <p>
            {t(S.sources, { n: dossier.meta.sources })} · {t(S.deadline)}: {spec.resolutionDate}
          </p>
          <nav aria-label={t(S.verdict)}>
            <Link href={`/forecast/${dossier.id}`}>{t(S.verdict)}</Link>
            <Link href={`/forecast/${dossier.id}/research`}>{t(S.research)}</Link>
          </nav>
        </header>
        {answer.kind === "numeric" ? (
          <section>
            <h2>{t(S.range)}</h2>
            <p className="rv-structured-number">
              {answer.modelRange[0]} – {answer.modelRange[1]} {answer.unit}
            </p>
            <p>{answer.rangeDescription}</p>
          </section>
        ) : (
          <section>
            <p>{t(answer.kind === "independent_ranking" ? S.independent : S.exclusive)}</p>
            {tieNames.length > 1 ? (
              <p>
                <strong>{t(S.tied)}:</strong> {tieNames.join(", ")}
              </p>
            ) : null}
            <div className="rv-structured-table">
              <table>
                <thead>
                  <tr>
                    {answer.kind === "independent_ranking" ? <th scope="col">{t(S.rank)}</th> : null}
                    <th scope="col">{t(S.option)}</th>
                    <th scope="col">{t(S.probability)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {answer.kind === "independent_ranking" ? <td>{row.rank}</td> : null}
                      <th scope="row">{row.label}</th>
                      <td className="rv-structured-number">{(row.probability * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {detail.summary ? (
          <>
            <section>
              <h2>{t(S.analysis)}</h2>
              {detail.summary.verdict.split(/\n\n+/).map((paragraph, index) => (
                <p key={index}>{text(paragraph)}</p>
              ))}
            </section>
            {(
              [
                [S.findings, detail.summary.keyFindings],
                [S.counter, detail.summary.counterarguments],
                [S.uncertainty, detail.summary.uncertainties]
              ] as const
            ).map(([title, items]) =>
              items.length ? (
                <section key={title.en}>
                  <h2>{t(title)}</h2>
                  <ul>
                    {items.map((item, index) => (
                      <li key={index}>{text(item)}</li>
                    ))}
                  </ul>
                </section>
              ) : null
            )}
          </>
        ) : (
          <p role="status">{t(S.awaiting)}</p>
        )}
        <section>
          <h2>{t(S.rounds)}</h2>
          {detail.rounds.map((round) => (
            <details key={round.round} open={mode === "research"}>
              <summary>
                {t(S.round, { n: round.round })} · {answerLabel(round.after)}
              </summary>
              <p>
                {answerLabel(round.before)} → {answerLabel(round.after)}
              </p>
              <p>{text(round.reasoning)}</p>
            </details>
          ))}
        </section>
        <section>
          <h2>{t(S.evidence)}</h2>
          {detail.evidence.map((entry, index) => (
            <article id={`structured-evidence-${index + 1}`} className="rv-structured-evidence" key={entry.id}>
              <p className="rv-structured-eyebrow">
                [{String(index + 1).padStart(2, "0")}] {t(S[entry.epistemicStatus])} ·{" "}
                {entry.publishedAt ?? t(S.unknownDate)}
              </p>
              <h3>
                {/^https?:\/\//i.test(entry.sourceUrl) ? (
                  <a href={entry.sourceUrl} target="_blank" rel="noreferrer">
                    {entry.sourceTitle}
                  </a>
                ) : (
                  entry.sourceTitle
                )}
              </h3>
              <p>
                <strong>{entry.claim}</strong>
              </p>
              {entry.quote ? <blockquote>{entry.quote}</blockquote> : null}
              <p>{entry.rationale}</p>
              <p className="rv-structured-eyebrow">
                {entry.targetIds.map((id) => spec.options.find((option) => option.id === id)?.label ?? id).join(" · ")}{" "}
                · {t(entry.verifiedInSearchTrace ? S.verified : S.unverified)}
              </p>
            </article>
          ))}
        </section>
        <section>
          <h2>{t(S.scope)}</h2>
          <p>{spec.resolutionCriteria}</p>
          <p>
            {t(S.asOf)}: {spec.asOfDate} · {t(S.deadline)}: {spec.resolutionDate}
          </p>
          <p>
            {t(S.settlement)}: {spec.settlementSource}
          </p>
          {spec.assumptions.map((item, index) => (
            <p key={index}>{item}</p>
          ))}
          {spec.scoreRubric ? (
            <p>
              {t(S.rubric)}: {spec.scoreRubric}
            </p>
          ) : null}
        </section>
        {detail.library ? (
          <section>
            <h2>{t(S.library)}</h2>
            <p>
              {t(S.libraryCounts, {
                searched: detail.library.searched,
                read: detail.library.read,
                used: detail.library.used
              })}
            </p>
            {detail.library.gaps.map((gap, index) => (
              <p key={index}>{gap}</p>
            ))}
          </section>
        ) : null}
      </main>
    </RvShell>
  );
}
