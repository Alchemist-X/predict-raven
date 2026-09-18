import type { Metadata } from "next";
import { notFound } from "next/navigation";
import styles from "../../../../components/investment-analysis/investment-analysis.module.css";
import { ReportFeedback, type FeedbackMessages } from "../../../../components/investment-analysis/report-feedback";
import {
  INVESTMENT_CASE_SLUGS,
  investmentHref,
  isInvestmentCaseSlug,
  type InvestmentCaseSlug
} from "../../../../lib/investment-analysis/routes";
import { localeOf, t, type Locale, type StrKey } from "../../../../lib/world-cup/i18n";

const ORIGIN = "https://forecasting-agent.com";

const REPORTS: Record<
  InvestmentCaseSlug,
  { titleKey: StrKey; descriptionKey: StrKey; iframeTitleKey: StrKey; src: string }
> = {
  "tencent-hunyuan-workbuddy": {
    titleKey: "iaTencentMetaTitle",
    descriptionKey: "iaTencentMetaDescription",
    iframeTitleKey: "iaTencentFrameTitle",
    src: "/investment-analysis/reports/tencent-hunyuan-workbuddy.html"
  },
  "google-hassabis": {
    titleKey: "iaGoogleMetaTitle",
    descriptionKey: "iaGoogleMetaDescription",
    iframeTitleKey: "iaGoogleFrameTitle",
    src: "/investment-analysis/reports/google-hassabis.html"
  },
  "meta-capex-6m": {
    titleKey: "iaMetaCapexMetaTitle",
    descriptionKey: "iaMetaCapexMetaDescription",
    iframeTitleKey: "iaMetaCapexFrameTitle",
    src: "/investment-analysis/reports/meta-capex-6m.html"
  },
  "openai-gpt6-sol": {
    titleKey: "iaOpenaiMetaTitle",
    descriptionKey: "iaOpenaiMetaDescription",
    iframeTitleKey: "iaOpenaiFrameTitle",
    src: "/investment-analysis/reports/openai-gpt6-sol.html"
  },
  "abivax-acquisition-6m": {
    titleKey: "iaAbivaxMetaTitle",
    descriptionKey: "iaAbivaxMetaDescription",
    iframeTitleKey: "iaAbivaxFrameTitle",
    src: "/investment-analysis/reports/abivax-acquisition-6m.html"
  },
  "aws-operating-margin-5y": {
    titleKey: "iaAwsMetaTitle",
    descriptionKey: "iaAwsMetaDescription",
    iframeTitleKey: "iaAwsFrameTitle",
    src: "/investment-analysis/reports/aws-operating-margin-5y.html"
  }
};

export function generateStaticParams() {
  return INVESTMENT_CASE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale: localeParam, slug } = await params;
  if (!isInvestmentCaseSlug(slug)) return {};

  const locale: Locale = localeOf(localeParam);
  const report = REPORTS[slug];
  const canonical = `${ORIGIN}${investmentHref(`/investment-analysis/${slug}`, locale)}`;

  return {
    title: t(locale, report.titleKey),
    description: t(locale, report.descriptionKey),
    alternates: { canonical },
    openGraph: {
      title: t(locale, report.titleKey),
      description: t(locale, report.descriptionKey),
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
      title: t(locale, report.titleKey),
      description: t(locale, report.descriptionKey),
      images: [`${ORIGIN}/brand/raven-icon.png`]
    }
  };
}

export default async function InvestmentReportPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: localeParam, slug } = await params;
  if (!isInvestmentCaseSlug(slug)) notFound();

  const locale: Locale = localeOf(localeParam);
  const report = REPORTS[slug];

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
      <iframe className={styles.reportFrame} src={report.src} title={t(locale, report.iframeTitleKey)} />
      <ReportFeedback reportSlug={slug} locale={locale} messages={messages} />
    </main>
  );
}
