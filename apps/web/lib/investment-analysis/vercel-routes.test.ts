import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVESTMENT_CASE_SLUGS } from "./routes";

// The public URLs are produced by the route table in the repo-root vercel.json,
// not by next.config. That table used to name each report slug in a regex, so a
// newly published report returned 404 in production until someone remembered to
// edit it too - which is exactly what happened to abivax-acquisition-6m. These
// tests hold the two files together.
const ROUTES = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../vercel.json", import.meta.url)), "utf8")
).routes as ReadonlyArray<{ src: string; dest: string; continue?: boolean }>;

function resolve(pathname: string): string | null {
  for (const route of ROUTES) {
    const match = new RegExp(route.src).exec(pathname);
    if (!match) continue;
    return route.dest.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? "");
  }
  return null;
}

describe("vercel.json investment-analysis routing", () => {
  it.each([...INVESTMENT_CASE_SLUGS])("routes /investment-analysis/%s to the zh-CN page", (slug) => {
    expect(resolve(`/investment-analysis/${slug}`)).toBe(`/zh-CN/investment-analysis/${slug}`);
  });

  it.each([...INVESTMENT_CASE_SLUGS])("routes every locale suffix for %s", (slug) => {
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      expect(resolve(`/investment-analysis/${slug}/${locale}`)).toBe(`/${locale}/investment-analysis/${slug}`);
    }
  });

  it("keeps the collection page and its locale suffixes intact", () => {
    expect(resolve("/investment-analysis")).toBe("/zh-CN/investment-analysis");
    for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
      expect(resolve(`/investment-analysis/${locale}`)).toBe(`/${locale}/investment-analysis`);
    }
  });

  it("does not treat the static report directory as a slug", () => {
    // These are real files under public/; rewriting them to a page would 404 them.
    for (const slug of INVESTMENT_CASE_SLUGS) {
      expect(resolve(`/investment-analysis/reports/${slug}.html`)).toBe(
        `/apps/web/investment-analysis/reports/${slug}.html`
      );
    }
    expect(resolve("/investment-analysis/reports")).toBe("/apps/web/investment-analysis/reports");
  });

  it("no longer names individual slugs, so a new report needs no route edit", () => {
    const investment = ROUTES.filter((route) => route.src.includes("investment-analysis"));
    expect(investment.length).toBeGreaterThan(0);
    for (const slug of INVESTMENT_CASE_SLUGS) {
      expect(investment.some((route) => route.src.includes(slug))).toBe(false);
    }
  });
});
