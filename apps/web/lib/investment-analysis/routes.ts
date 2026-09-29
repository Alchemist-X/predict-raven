import type { Locale } from "../world-cup/i18n";
import { INVESTMENT_REPORTS } from "./reports";

// Derived from reports.json; see reports.ts.
export const INVESTMENT_CASE_SLUGS: ReadonlyArray<string> = INVESTMENT_REPORTS.map((report) => report.slug);

export type InvestmentCaseSlug = string;

const SLUGS = new Set(INVESTMENT_CASE_SLUGS);

export function isInvestmentCaseSlug(value: string): value is InvestmentCaseSlug {
  return SLUGS.has(value);
}

export function investmentHref(path: string, locale: Locale): string {
  const cleanPath = path.replace(/\/+$/, "") || "/investment-analysis";
  return locale === "zh-CN" ? cleanPath : `${cleanPath}/${locale}`;
}

export function stripInvestmentLocale(pathname: string): string {
  const withoutAppPrefix = pathname.replace(/^\/apps\/web(?=\/|$)/, "");
  const withoutTrailingLocale = withoutAppPrefix.replace(/\/(en|zh-CN|zh-TW)\/?$/, "");
  return withoutTrailingLocale.replace(/^\/(en|zh-CN|zh-TW)(?=\/)/, "") || "/investment-analysis";
}
