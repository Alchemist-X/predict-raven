// The investment-analysis collection has one registry: reports.json. Every page
// that lists, routes or collects feedback on a report derives from it, so
// publishing a report is one manifest entry plus the HTML file under
// public/investment-analysis/reports/<slug>.html. `pnpm ia:add-report` writes
// both and regenerates the zh-TW copy; reports.test.ts holds the invariants.

import type { Locale } from "../world-cup/i18n";
import manifest from "./reports.json";
import zhTW from "./reports-zh-TW.generated.json";

export interface ReportCopy {
  readonly company: string;
  readonly title: string;
  readonly summary: string;
  readonly signalLabel: string;
  readonly signal: string;
  readonly metaTitle: string;
  readonly metaDescription: string;
  readonly frameTitle: string;
}

export const REPORT_COPY_FIELDS: ReadonlyArray<keyof ReportCopy> = [
  "company",
  "title",
  "summary",
  "signalLabel",
  "signal",
  "metaTitle",
  "metaDescription",
  "frameTitle"
];

export interface ManifestEntry {
  readonly slug: string;
  /** The client's question in Simplified Chinese, stored with each feedback note. */
  readonly question: string;
  readonly en: ReportCopy;
  readonly "zh-CN": ReportCopy;
}

export interface ReportManifest {
  /** Research cut-off of the newest report, shown on the collection page. */
  readonly asOf: string;
  readonly reports: ReadonlyArray<ManifestEntry>;
}

export interface InvestmentReport {
  readonly slug: string;
  readonly index: string;
  readonly question: string;
  readonly src: string;
  readonly copy: Readonly<Record<Locale, ReportCopy>>;
}

export const REPORT_MANIFEST: ReportManifest = manifest;

const TRADITIONAL = zhTW as Readonly<Record<string, ReportCopy>>;

export const INVESTMENT_REPORTS: ReadonlyArray<InvestmentReport> = REPORT_MANIFEST.reports.map((entry, position) => ({
  slug: entry.slug,
  index: String(position + 1).padStart(2, "0"),
  question: entry.question,
  src: reportHtmlPath(entry.slug),
  copy: { en: entry.en, "zh-CN": entry["zh-CN"], "zh-TW": TRADITIONAL[entry.slug] ?? entry["zh-CN"] }
}));

export const REPORTS_AS_OF = REPORT_MANIFEST.asOf;

export function reportHtmlPath(slug: string): string {
  return `/investment-analysis/reports/${slug}.html`;
}

const BY_SLUG = new Map(INVESTMENT_REPORTS.map((report) => [report.slug, report]));

export function findInvestmentReport(slug: string): InvestmentReport | undefined {
  return BY_SLUG.get(slug);
}
