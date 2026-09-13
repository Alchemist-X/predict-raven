// Output-language control for the forecaster's user-facing prose.
//
// Opt-in via FORECAST_LANGUAGE=zh (set per-run by the Raven app; defaults to
// English so the trading pipeline and every existing caller are unaffected).
// The directive only touches free-text fields — JSON keys, enum values, URLs,
// dates and numbers stay ASCII so validators and the Bayesian harness see the
// exact same machine contract in every language.

export type ForecastLanguage = "en" | "zh";

export function forecastLanguage(): ForecastLanguage {
  return process.env.FORECAST_LANGUAGE === "zh" ? "zh" : "en";
}

export function languageDirective(lang: ForecastLanguage = forecastLanguage()): string {
  const style = `
WRITING STANDARD:
- Prefer full, plain-language names over abbreviations and specialist shorthand.
- If an abbreviation is genuinely useful, spell out the full term at its first appearance, immediately followed by the abbreviation in parentheses. Only then may later text use the abbreviation alone.
- Do not expose internal engineering shorthand such as LLR, QA, API, GA, or SLA without first defining it for the reader.
- Write complete sentences. Explain what a fact changes and why it matters to the resolution criteria.
`;
  if (lang !== "zh") return style;
  return `${style}
LANGUAGE: Write analytical prose in Simplified Chinese (简体中文) — claims, rationales, summaries, criteria, assumptions, caveats, verdict prose, notes, quips. Exact source quotations must remain in their original language, without translation or paraphrase. Keep JSON keys, enum values, URLs, dates and numbers exactly as specified above, in English/ASCII. Prefer ordinary Chinese wording. When an English abbreviation is necessary, write its full Chinese or English meaning before the abbreviation at first use.
`;
}
