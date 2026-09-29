import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../../components/investment-analysis/investment-analysis.module.css";
import { ReportFeedback, type FeedbackMessages } from "../../../../components/investment-analysis/report-feedback";
import { findInvestmentReport, INVESTMENT_REPORTS } from "../../../../lib/investment-analysis/reports";
import { investmentHref } from "../../../../lib/investment-analysis/routes";
import { localeOf, t, type Locale } from "../../../../lib/world-cup/i18n";

const ORIGIN = "https://forecasting-agent.com";

export function generateStaticParams() {
  return INVESTMENT_REPORTS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: localeParam, slug } = await params;
  const report = findInvestmentReport(slug);
  if (!report) return {};

  const locale: Locale = localeOf(localeParam);
  const copy = report.copy[locale];
  const canonical = `${ORIGIN}${investmentHref(`/investment-analysis/${slug}`, locale)}`;

  return {
    title: copy.metaTitle,
    description: copy.metaDescription,
    alternates: { canonical },
    openGraph: {
      title: copy.metaTitle,
      description: copy.metaDescription,
      siteName: "Predict Raven",
      url: canonical,
      type: "article",
      images: [
        {
          url: `${ORIGIN}/brand/raven-icon.png`,
          width: 256,
          height: 256,
          alt: "Predict Raven"
        }
      ]
    },
    twitter: {
      card: "summary",
      title: copy.metaTitle,
      description: copy.metaDescription,
      images: [`${ORIGIN}/brand/raven-icon.png`]
    }
  };
}

export default async function InvestmentReportPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: localeParam, slug } = await params;
  const report = findInvestmentReport(slug);
  if (!report) notFound();

  const locale: Locale = localeOf(localeParam);

  const messages: FeedbackMessages = {
    iaFeedbackOpen: t(locale, "iaFeedbackOpen"),
    iaFeedbackTitle: t(locale, "iaFeedbackTitle"),
    iaFeedbackDescription: t(locale, "iaFeedbackDescription"),
    iaFeedbackLabel: t(locale, "iaFeedbackLabel"),
    iaFeedbackPlaceholder: t(locale, "iaFeedbackPlaceholder"),
    iaFeedbackSubmit: t(locale, "iaFeedbackSubmit"),
    iaFeedbackSubmitting: t(locale, "iaFeedbackSubmitting"),
    iaFeedbackSuccess: t(locale, "iaFeedbackSuccess"),
    iaFeedbackError: t(locale, "iaFeedbackError"),
    iaFeedbackRateLimited: t(locale, "iaFeedbackRateLimited"),
    iaFeedbackClose: t(locale, "iaFeedbackClose"),
    iaFeedbackWebsite: t(locale, "iaFeedbackWebsite")
  };

  return (
    <main className={styles.reportMain}>
      <iframe className={styles.reportFrame} src={report.src} title={report.copy[locale].frameTitle} />
      <ReportFeedback reportSlug={slug} locale={locale} messages={messages} />
    </main>
  );
}
