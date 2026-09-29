import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REPORT_MANIFEST,
  type ManifestEntry,
  type ReportCopy,
  type ReportManifest
} from "../../apps/web/lib/investment-analysis/reports";
import { checkReportHtml, traditionalCopies, upsertEntry, validateEntry } from "./report-manifest";

const copy = (tag: string): ReportCopy => ({
  company: `${tag} company`,
  title: `${tag} title`,
  summary: `${tag} summary`,
  signalLabel: `${tag} label`,
  signal: "42%",
  metaTitle: `${tag} meta`,
  metaDescription: `${tag} description`,
  frameTitle: `${tag} frame`
});
const entry = (slug: string, tag = slug): ManifestEntry => ({ slug, question: `${tag}?`, en: copy(tag), "zh-CN": copy(`${tag}中文`) });
const manifest: ReportManifest = { asOf: "2026-09-29", reports: [entry("a-one"), entry("b-two")] };

describe("ia:add-report manifest edits", () => {
  it("appends a new report and moves the cut-off forward", () => {
    const next = upsertEntry(manifest, entry("c-three"), "2026-09-30");
    expect(next.reports.map((report) => report.slug)).toEqual(["a-one", "b-two", "c-three"]);
    expect(next.asOf).toBe("2026-09-30");
  });

  it("replaces a republished report in place and never moves the cut-off back", () => {
    const next = upsertEntry(manifest, entry("a-one", "revised"), "2026-09-01");
    expect(next.reports.map((report) => report.slug)).toEqual(["a-one", "b-two"]);
    expect(next.reports[0]?.en.title).toBe("revised title");
    expect(next.asOf).toBe("2026-09-29");
  });

  it("rejects malformed entries before anything is written", () => {
    expect(() => validateEntry({ ...entry("Bad Slug") })).toThrow(/kebab-case/);
    const missing = { ...entry("ok-slug"), en: { ...copy("x"), signal: "" } };
    expect(() => validateEntry(missing)).toThrow(/en.signal/);
    const extra = { ...entry("ok-slug"), "zh-CN": { ...copy("x"), subtitle: "?" } };
    expect(() => validateEntry(extra)).toThrow(/unknown fields/);
    const branded = { ...entry("ok-slug"), "zh-CN": { ...copy("x"), company: "红薯投资 · AMD" } };
    expect(() => validateEntry(branded)).toThrow(/brand/);
    expect(() => upsertEntry(manifest, entry("ok-slug"), "30/09/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("refuses an empty page or a branded header", () => {
    const body = "<p>正文</p>".repeat(400);
    expect(() => checkReportHtml("<html><body></body></html>")).toThrow(/empty/);
    expect(() => checkReportHtml(`<html><header>红薯投资 · 报告</header>${body}</html>`)).toThrow(/brand/);
    expect(() => checkReportHtml(`<html><header>Predict-Raven</header>${body}</html>`)).not.toThrow();
  });
});

describe("generated zh-TW report copy", () => {
  it("matches the zh-CN manifest (run pnpm wc:gen-tw or ia:add-report after editing it)", () => {
    const generated = JSON.parse(
      readFileSync(new URL("../../apps/web/lib/investment-analysis/reports-zh-TW.generated.json", import.meta.url), "utf8")
    );
    expect(generated).toEqual(traditionalCopies(REPORT_MANIFEST));
  });
});
