/**
 * Generate the Traditional-Chinese (zh-TW) resource set from the Simplified
 * (zh-CN) source, using opencc-js (Simplified → Taiwan-standard Traditional,
 * phrase-aware). Pre-generated so the web app ships ready-made traditional
 * strings — no runtime conversion, no client-bundle bloat.
 *
 * Emits:
 *   lib/world-cup/messages/zh-TW.generated.json            — UI strings
 *   lib/world-cup/generated/teams-zh-TW.generated.json     — { enName: twName }
 *   lib/world-cup/generated/content-zh-TW.generated.json   — per-forecast content
 *
 * Re-run after editing zh-CN.json or importing new forecasts:
 *   pnpm wc:gen-tw
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { ALL_TEAMS } from "../../apps/web/lib/world-cup/team-meta.js";
import { traditionalCopies } from "../investment-analysis/report-manifest.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(REPO_ROOT, "apps/web/lib/world-cup");
const MESSAGES = path.join(WEB, "messages");
const GEN = path.join(WEB, "generated");

const C = {
  info: (m: string) => console.log(`\x1b[36mINFO\x1b[0m  ${m}`),
  ok: (m: string) => console.log(`\x1b[32mOK\x1b[0m    ${m}`)
};

// Simplified (mainland) → Traditional (Taiwan standard, with phrase conversion).
const s2t = OpenCC.Converter({ from: "cn", to: "tw" });
const conv = (s: string): string => (s ? s2t(s) : s);

interface Forecast {
  readonly id: string;
  readonly question_cn: string;
  readonly one_liner_cn: string;
  readonly key_reasons: ReadonlyArray<{ cn: string }>;
}

async function main(): Promise<void> {
  // 1) UI messages
  const zhCN = JSON.parse(await readFile(path.join(MESSAGES, "zh-CN.json"), "utf8")) as Record<string, string>;
  const zhTW = Object.fromEntries(Object.entries(zhCN).map(([k, v]) => [k, conv(v)]));
  await mkdir(MESSAGES, { recursive: true });
  await writeFile(path.join(MESSAGES, "zh-TW.generated.json"), JSON.stringify(zhTW, null, 2) + "\n");
  C.ok(`messages: ${Object.keys(zhTW).length} keys → zh-TW.generated.json`);

  // 2) Team names (keyed by canonical English name, matching teamLabel lookup)
  const teams = Object.fromEntries(ALL_TEAMS.map(([, meta]) => [meta.en, conv(meta.cn)]));
  await mkdir(GEN, { recursive: true });
  await writeFile(path.join(GEN, "teams-zh-TW.generated.json"), JSON.stringify(teams, null, 2) + "\n");
  C.ok(`teams: ${Object.keys(teams).length} names → teams-zh-TW.generated.json`);

  // 3) Forecast card content (question / one-liner / reasons)
  const predictions = JSON.parse(await readFile(path.join(GEN, "predictions.generated.json"), "utf8")) as {
    entries: Forecast[];
  };
  const content: Record<string, { question: string; one_liner: string; reasons: string[] }> = {};
  for (const f of predictions.entries) {
    content[f.id] = {
      question: conv(f.question_cn),
      one_liner: conv(f.one_liner_cn),
      reasons: f.key_reasons.map((r) => conv(r.cn))
    };
  }
  await writeFile(path.join(GEN, "content-zh-TW.generated.json"), JSON.stringify({ content }, null, 1));
  C.ok(`content: ${Object.keys(content).length} forecasts → content-zh-TW.generated.json`);

  // 4) Investment-analysis report cards (same conversion; also run by ia:add-report)
  const reportsDir = path.join(REPO_ROOT, "apps/web/lib/investment-analysis");
  const manifest = JSON.parse(await readFile(path.join(reportsDir, "reports.json"), "utf8"));
  const reports = traditionalCopies(manifest);
  await writeFile(path.join(reportsDir, "reports-zh-TW.generated.json"), JSON.stringify(reports, null, 2) + "\n");
  C.ok(`reports: ${Object.keys(reports).length} investment reports → reports-zh-TW.generated.json`);
  C.info("Traditional resource set regenerated.");
}

main().catch((err) => {
  console.error("\x1b[31mERR\x1b[0m   gen-traditional failed:", err instanceof Error ? err.message : err);
  console.error("      (needs opencc-js — run: pnpm add -w -D opencc-js)");
  process.exitCode = 1;
});
