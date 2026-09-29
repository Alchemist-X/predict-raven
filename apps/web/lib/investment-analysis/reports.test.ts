import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVESTMENT_REPORTS, REPORT_COPY_FIELDS, REPORT_MANIFEST } from "./reports";

const PUBLIC = new URL("../../public/investment-analysis/reports/", import.meta.url);
const GENERATED = JSON.parse(readFileSync(fileURLToPath(new URL("./reports-zh-TW.generated.json", import.meta.url)), "utf8"));

describe("investment report manifest", () => {
  it("has unique kebab-case slugs numbered in order", () => {
    const slugs = INVESTMENT_REPORTS.map((report) => report.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [position, report] of INVESTMENT_REPORTS.entries()) {
      expect(report.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(report.index).toBe(String(position + 1).padStart(2, "0"));
    }
  });

  it.each(INVESTMENT_REPORTS.map((report) => report.slug))("ships the HTML for %s", (slug) => {
    expect(existsSync(fileURLToPath(new URL(`${slug}.html`, PUBLIC)))).toBe(true);
  });

  it("fills every copy field in every locale", () => {
    for (const report of INVESTMENT_REPORTS) {
      expect(report.question.trim()).not.toBe("");
      for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
        for (const field of REPORT_COPY_FIELDS) {
          expect(report.copy[locale][field].trim(), `${report.slug} ${locale}.${field}`).not.toBe("");
        }
      }
    }
  });

  it("has generated zh-TW copy for exactly the manifest's reports", () => {
    // Exact conversion is checked in scripts/investment-analysis/report-manifest.test.ts.
    expect(Object.keys(GENERATED).sort()).toEqual(INVESTMENT_REPORTS.map((report) => report.slug).sort());
  });

  it("dates the collection cut-off", () => {
    expect(REPORT_MANIFEST.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
