import styles from "../../../components/investment-analysis/investment-analysis.module.css";
import { INVESTMENT_REPORTS, REPORTS_AS_OF } from "../../../lib/investment-analysis/reports";
import { investmentHref } from "../../../lib/investment-analysis/routes";
import { localeOf, t, type Locale } from "../../../lib/world-cup/i18n";

export default async function InvestmentAnalysisPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: localeParam } = await params;
  const locale: Locale = localeOf(localeParam);
  const cases = INVESTMENT_REPORTS.map((report) => ({ slug: report.slug, index: report.index, copy: report.copy[locale] }));

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
          <strong>{t(locale, "iaCaseCount").replace("{count}", String(cases.length))}</strong>
        </div>
        <div className={styles.metaItem}>
          <span>{t(locale, "iaAsOfLabel")}</span>
          <strong>{REPORTS_AS_OF}</strong>
        </div>
      </section>

      <section className={styles.cases} aria-label={t(locale, "iaCasesLabel")}>
        {cases.map(({ slug, index, copy }) => (
          <article className={styles.case} key={slug}>
            <div className={styles.caseIndex} aria-hidden="true">
              {index}
            </div>
            <div className={styles.caseBody}>
              <p className={styles.caseCompany}>{copy.company}</p>
              <h2>{copy.title}</h2>
              <p className={styles.caseSummary}>{copy.summary}</p>
            </div>
            <div className={styles.caseSignal}>
              <span className={styles.signalLabel}>{copy.signalLabel}</span>
              <strong className={styles.signalValue}>{copy.signal}</strong>
              <a
                className={styles.caseLink}
                href={investmentHref(`/investment-analysis/${slug}`, locale)}
                aria-label={`${t(locale, "iaViewReport")}: ${copy.title}`}
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
