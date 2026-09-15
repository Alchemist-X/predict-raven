"use client";

import { useRef, useState, type FormEvent } from "react";
import type { InvestmentCaseSlug } from "../../lib/investment-analysis/routes";
import type { Locale } from "../../lib/world-cup/i18n";
import styles from "./investment-analysis.module.css";

export interface FeedbackMessages {
  iaFeedbackOpen: string;
  iaFeedbackTitle: string;
  iaFeedbackDescription: string;
  iaFeedbackLabel: string;
  iaFeedbackPlaceholder: string;
  iaFeedbackSubmit: string;
  iaFeedbackSubmitting: string;
  iaFeedbackSuccess: string;
  iaFeedbackError: string;
  iaFeedbackRateLimited: string;
  iaFeedbackClose: string;
  iaFeedbackWebsite: string;
}

export function ReportFeedback({
  reportSlug,
  locale,
  messages: m
}: {
  reportSlug: InvestmentCaseSlug;
  locale: Locale;
  messages: FeedbackMessages;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<{ id: string; text: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    const website = String(new FormData(event.currentTarget).get("website") ?? "");
    const body = text.trim();
    if (!pending.current || pending.current.text !== body) pending.current = { id: crypto.randomUUID(), text: body };
    setBusy(true);
    setStatus("");
    setError(false);
    try {
      const response = await fetch("/api/investment-analysis/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pending.current, reportSlug, locale, website }),
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) {
        setError(true);
        setStatus(response.status === 429 ? m.iaFeedbackRateLimited : m.iaFeedbackError);
        return;
      }
      const saved = await response.json();
      if (saved.id !== pending.current.id || saved.status !== "pending") throw new Error("Invalid feedback receipt");
      pending.current = null;
      setText("");
      setStatus(m.iaFeedbackSuccess);
    } catch {
      setError(true);
      setStatus(m.iaFeedbackError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.feedbackLauncher} onClick={() => dialog.current?.showModal()}>
        {m.iaFeedbackOpen}
      </button>
      <dialog
        ref={dialog}
        className={styles.feedbackDialog}
        aria-labelledby="report-feedback-title"
        aria-describedby="report-feedback-description"
      >
        <div className={styles.feedbackHeading}>
          <h2 id="report-feedback-title">{m.iaFeedbackTitle}</h2>
          <button
            type="button"
            className={styles.feedbackClose}
            onClick={() => dialog.current?.close()}
            aria-label={m.iaFeedbackClose}
          >
            ×
          </button>
        </div>
        <p id="report-feedback-description">{m.iaFeedbackDescription}</p>
        <form onSubmit={submit}>
          <label htmlFor="report-feedback-text">{m.iaFeedbackLabel}</label>
          <textarea
            id="report-feedback-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={m.iaFeedbackPlaceholder}
            maxLength={600}
            rows={6}
            required
            autoFocus
            disabled={busy}
            aria-describedby="report-feedback-count"
          />
          <span id="report-feedback-count" className={styles.feedbackCount}>
            {text.length} / 600
          </span>
          <div className={styles.feedbackHoneypot} aria-hidden="true">
            <label htmlFor="report-feedback-website">{m.iaFeedbackWebsite}</label>
            <input id="report-feedback-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <button className={styles.feedbackSubmit} type="submit" disabled={busy || !text.trim()}>
            {busy ? m.iaFeedbackSubmitting : m.iaFeedbackSubmit}
          </button>
          <p className={styles.feedbackStatus} role={error ? "alert" : "status"} aria-live="polite">
            {status}
          </p>
        </form>
      </dialog>
    </>
  );
}
