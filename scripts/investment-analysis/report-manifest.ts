// Pure helpers behind `pnpm ia:add-report` (see add-report.ts). The manifest
// format and the page wiring live in apps/web/lib/investment-analysis/reports.ts.
import * as OpenCC from "opencc-js";
import {
  REPORT_COPY_FIELDS,
  type ManifestEntry,
  type ReportCopy,
  type ReportManifest
} from "../../apps/web/lib/investment-analysis/reports.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Client brand labels must not reach the public site (red-potato CLAUDE.md, 2026-09-06).
const BRAND_LABELS = ["红薯投资", "红书投资"];

export function validateEntry(value: unknown): ManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("entry must be a JSON object");
  const entry = value as Record<string, unknown>;
  if (typeof entry.slug !== "string" || !SLUG.test(entry.slug)) {
    throw new Error(`slug must be kebab-case ascii, got ${JSON.stringify(entry.slug)}`);
  }
  if (typeof entry.question !== "string" || !entry.question.trim()) throw new Error("question is required");
  const copies = {} as Record<"en" | "zh-CN", ReportCopy>;
  for (const locale of ["en", "zh-CN"] as const) {
    const copy = entry[locale];
    if (!copy || typeof copy !== "object") throw new Error(`${locale} copy is required`);
    const fields = copy as Record<string, unknown>;
    const unknown = Object.keys(fields).filter((key) => !REPORT_COPY_FIELDS.includes(key as keyof ReportCopy));
    if (unknown.length) throw new Error(`${locale} has unknown fields: ${unknown.join(", ")}`);
    for (const field of REPORT_COPY_FIELDS) {
      const text = fields[field];
      if (typeof text !== "string" || !text.trim()) throw new Error(`${locale}.${field} is required`);
      const brand = BRAND_LABELS.find((label) => text.includes(label));
      if (brand) throw new Error(`${locale}.${field} carries the client brand label ${brand}`);
    }
    copies[locale] = copy as ReportCopy;
  }
  return { slug: entry.slug, question: entry.question.trim(), en: copies.en, "zh-CN": copies["zh-CN"] };
}

/** Adds a new report at the end, or replaces a republished one in place. */
export function upsertEntry(manifest: ReportManifest, entry: ManifestEntry, asOf: string): ReportManifest {
  if (!DATE.test(asOf)) throw new Error(`as-of must be YYYY-MM-DD, got ${asOf}`);
  const position = manifest.reports.findIndex((report) => report.slug === entry.slug);
  const reports =
    position === -1
      ? [...manifest.reports, entry]
      : manifest.reports.map((report, index) => (index === position ? entry : report));
  return { asOf: asOf > manifest.asOf ? asOf : manifest.asOf, reports };
}

export function checkReportHtml(html: string): void {
  if (!/<html[\s>]/i.test(html) || html.length < 2_000) throw new Error("report HTML looks empty or truncated");
  // The rendered report's own chrome (kicker, header, footer) must not show the brand.
  const chrome = html.match(/<(?:header|footer)[\s\S]*?<\/(?:header|footer)>|class="(?:report-kicker|brand)"[^<]*/gi) ?? [];
  const brand = BRAND_LABELS.find((label) => chrome.some((part) => part.includes(label)));
  if (brand) throw new Error(`report header/footer carries the client brand label ${brand}`);
}

const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

/** zh-TW copy for every report, converted from zh-CN (Simplified → Taiwan standard). */
export function traditionalCopies(manifest: ReportManifest): Record<string, ReportCopy> {
  return Object.fromEntries(
    manifest.reports.map((report) => [
      report.slug,
      Object.fromEntries(REPORT_COPY_FIELDS.map((field) => [field, toTraditional(report["zh-CN"][field])])) as unknown as ReportCopy
    ])
  );
}
