import type { Locale } from "../world-cup/i18n";

export const INVESTMENT_CASE_SLUGS = [
  "tencent-hunyuan-workbuddy",
  "google-hassabis",
  "meta-capex-6m",
  "openai-gpt6-sol",
  "abivax-acquisition-6m"
] as const;

export type InvestmentCaseSlug = (typeof INVESTMENT_CASE_SLUGS)[number];

export function isInvestmentCaseSlug(value: string): value is InvestmentCaseSlug {
  return INVESTMENT_CASE_SLUGS.includes(value as InvestmentCaseSlug);
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
