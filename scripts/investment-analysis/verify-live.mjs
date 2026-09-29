#!/usr/bin/env node
// Checks the live investment-analysis collection against reports.json: the
// collection page in every locale lists every report, and each report page and
// its HTML answer 200. Plain Node (no install) so CI can run it straight after
// the deploy; locally: `pnpm ia:verify-live [--base https://preview-url]`.
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const baseIndex = argv.indexOf("--base");
const BASE = (baseIndex === -1 ? "https://forecasting-agent.com" : argv[baseIndex + 1]).replace(/\/+$/, "");
const ATTEMPTS = 6;
const WAIT_MS = 10_000;

const manifest = JSON.parse(
  readFileSync(new URL("../../apps/web/lib/investment-analysis/reports.json", import.meta.url), "utf8")
);
const slugs = manifest.reports.map((report) => report.slug);

// zh-CN is the suffix-less default; en and zh-TW append a locale segment.
const localized = (path) => [path, `${path}/en`, `${path}/zh-TW`];
const checks = [
  ...localized("/investment-analysis").map((path) => ({ path, mustInclude: slugs.map((slug) => `/investment-analysis/${slug}`) })),
  ...slugs.flatMap((slug) => [
    ...localized(`/investment-analysis/${slug}`).map((path) => ({ path, mustInclude: [`/investment-analysis/reports/${slug}.html`] })),
    { path: `/investment-analysis/reports/${slug}.html`, mustInclude: ["<html"] }
  ])
];

async function probe({ path, mustInclude }) {
  const response = await fetch(`${BASE}${path}`, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  const body = await response.text();
  const missing = mustInclude.filter((needle) => !body.includes(needle));
  return response.status === 200 && missing.length === 0 ? null : `${response.status} ${path}${missing.length ? ` missing ${missing.join(", ")}` : ""}`;
}

let failures = [];
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  failures = (await Promise.all(checks.map(probe))).filter(Boolean);
  if (failures.length === 0) break;
  console.log(`attempt ${attempt}/${ATTEMPTS}: ${failures.length} of ${checks.length} checks failing, e.g. ${failures[0]}`);
  if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`OK ${checks.length} live checks on ${BASE} (${slugs.length} reports × 3 locales + HTML + collection)`);
