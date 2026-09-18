import styles from "../../../components/investment-analysis/investment-analysis.module.css";
import { investmentHref } from "../../../lib/investment-analysis/routes";
import { localeOf, t, type Locale, type StrKey } from "../../../lib/world-cup/i18n";

interface CaseStudy {
  readonly slug: string;
  readonly index: string;
  readonly companyKey: StrKey;
  readonly titleKey: StrKey;
  readonly summaryKey: StrKey;
  readonly signalLabelKey: StrKey;
  readonly signalKey: StrKey;
}

const CASES: ReadonlyArray<CaseStudy> = [
  {
    slug: "tencent-hunyuan-workbuddy",
    index: "01",
    companyKey: "iaTencentCompany",
    titleKey: "iaTencentTitle",
    summaryKey: "iaTencentSummary",
    signalLabelKey: "iaTencentSignalLabel",
    signalKey: "iaTencentSignal"
  },
  {
    slug: "google-hassabis",
    index: "02",
    companyKey: "iaGoogleCompany",
    titleKey: "iaGoogleTitle",
    summaryKey: "iaGoogleSummary",
    signalLabelKey: "iaGoogleSignalLabel",
    signalKey: "iaGoogleSignal"
  },
  {
    slug: "meta-capex-6m",
    index: "03",
    companyKey: "iaMetaCapexCompany",
    titleKey: "iaMetaCapexTitle",
    summaryKey: "iaMetaCapexSummary",
    signalLabelKey: "iaMetaCapexSignalLabel",
    signalKey: "iaMetaCapexSignal"
  },
  {
    slug: "openai-gpt6-sol",
    index: "04",
    companyKey: "iaOpenaiCompany",
    titleKey: "iaOpenaiTitle",
    summaryKey: "iaOpenaiSummary",
    signalLabelKey: "iaOpenaiSignalLabel",
    signalKey: "iaOpenaiSignal"
  },
  {
    slug: "abivax-acquisition-6m",
    index: "05",
    companyKey: "iaAbivaxCompany",
    titleKey: "iaAbivaxTitle",
    summaryKey: "iaAbivaxSummary",
    signalLabelKey: "iaAbivaxSignalLabel",
    signalKey: "iaAbivaxSignal"
  },
  {
    slug: "aws-operating-margin-5y",
    index: "06",
    companyKey: "iaAwsCompany",
    titleKey: "iaAwsTitle",
    summaryKey: "iaAwsSummary",
    signalLabelKey: "iaAwsSignalLabel",
    signalKey: "iaAwsSignal"
  }
];

export default async function InvestmentAnalysisPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale: Locale = localeOf(localeParam);

  return (
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="investment-analysis-title">
        <div>
          <p className={styles.eyebrow}>{t(locale, "iaEyebrow")}</p>
          <h1 id="investment-analysis-title">{t(locale, "iaTitle")}</h1>
        </div>
      </section>

      <section className={styles.metaStrip} aria-label={t(locale, "iaCollectionMetaLabel")}>
        <div className={styles.metaItem}>
          <span>{t(locale, "iaCaseCountLabel")}</span>
          <strong>{t(locale, "iaCaseCount")}</strong>
        </div>
        <div className={styles.metaItem}>
          <span>{t(locale, "iaAsOfLabel")}</span>
          <strong>2026-09-18</strong>
        </div>
      </section>

      <section className={styles.cases} aria-label={t(locale, "iaCasesLabel")}>
        {CASES.map((caseStudy) => (
          <article className={styles.case} key={caseStudy.slug}>
            <div className={styles.caseIndex} aria-hidden="true">
              {caseStudy.index}
            </div>
            <div className={styles.caseBody}>
              <p className={styles.caseCompany}>{t(locale, caseStudy.companyKey)}</p>
              <h2>{t(locale, caseStudy.titleKey)}</h2>
              <p className={styles.caseSummary}>{t(locale, caseStudy.summaryKey)}</p>
            </div>
            <div className={styles.caseSignal}>
              <span className={styles.signalLabel}>{t(locale, caseStudy.signalLabelKey)}</span>
              <strong className={styles.signalValue}>{t(locale, caseStudy.signalKey)}</strong>
              <a
                className={styles.caseLink}
                href={investmentHref(`/investment-analysis/${caseStudy.slug}`, locale)}
                aria-label={`${t(locale, "iaViewReport")}: ${t(locale, caseStudy.titleKey)}`}
              >
                <span>{t(locale, "iaViewReport")}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <p>{t(locale, "iaDisclaimer")}</p>
      </footer>
    </main>
  );
}
