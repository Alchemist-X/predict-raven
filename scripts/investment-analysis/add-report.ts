/**
 * Publish or republish one report in the investment-analysis collection.
 *
 *   pnpm ia:add-report --entry path/to/entry.json --html path/to/report.html [--as-of YYYY-MM-DD]
 *
 * entry.json holds { slug, question, en: {...}, "zh-CN": {...} } with the eight
 * copy fields of ReportCopy (apps/web/lib/investment-analysis/reports.ts). The
 * command copies the HTML to public/investment-analysis/reports/<slug>.html,
 * appends the entry to reports.json (a republished slug keeps its position),
 * moves the collection cut-off forward and regenerates the zh-TW copy.
 * Merging to main publishes: .github/workflows/investment-reports-deploy.yml
 * deploys forecasting-agent.com and checks every report route in every locale.
 */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportManifest } from "../../apps/web/lib/investment-analysis/reports.js";
import { checkReportHtml, traditionalCopies, upsertEntry, validateEntry } from "./report-manifest.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = path.join(REPO_ROOT, "apps/web/lib/investment-analysis");
const PUBLIC = path.join(REPO_ROOT, "apps/web/public/investment-analysis/reports");
const MANIFEST = path.join(LIB, "reports.json");
const TRADITIONAL = path.join(LIB, "reports-zh-TW.generated.json");

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const entryPath = option(argv, "--entry");
  const htmlPath = option(argv, "--html");
  const asOf = option(argv, "--as-of") ?? new Date().toISOString().slice(0, 10);
  if (!entryPath || !htmlPath) {
    throw new Error("usage: pnpm ia:add-report --entry entry.json --html report.html [--as-of YYYY-MM-DD]");
  }

  const entry = validateEntry(JSON.parse(await readFile(path.resolve(entryPath), "utf8")));
  checkReportHtml(await readFile(path.resolve(htmlPath), "utf8"));

  const current = JSON.parse(await readFile(MANIFEST, "utf8")) as ReportManifest;
  const republish = current.reports.some((report) => report.slug === entry.slug);
  const next = upsertEntry(current, entry, asOf);

  await copyFile(path.resolve(htmlPath), path.join(PUBLIC, `${entry.slug}.html`));
  await writeFile(MANIFEST, JSON.stringify(next, null, 2) + "\n");
  await writeFile(TRADITIONAL, JSON.stringify(traditionalCopies(next), null, 2) + "\n");

  console.log(`${republish ? "updated" : "added"} ${entry.slug} (${next.reports.length} reports, cut-off ${next.asOf})`);
  console.log("next: pnpm test apps/web/lib/investment-analysis, commit, open a PR; merging to main deploys it.");
}

main().catch((error: unknown) => {
  console.error("ia:add-report failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
