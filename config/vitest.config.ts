import path from "node:path";
import { defineConfig } from "vitest/config";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: REPO_ROOT,
  resolve: {
    alias: {
      // Subpath alias must precede the bare package alias (Vite prefix-matches).
      "@autopoly/contracts/env": path.resolve(REPO_ROOT, "packages/contracts/src/env.ts"),
      "@autopoly/contracts": path.resolve(REPO_ROOT, "packages/contracts/src/index.ts"),
      "@autopoly/db": path.resolve(REPO_ROOT, "packages/db/src/index.ts"),
      "@autopoly/norns": path.resolve(REPO_ROOT, "packages/norns/src/index.ts"),
      "@autopoly/terminal-ui": path.resolve(REPO_ROOT, "packages/terminal-ui/src/index.ts"),
      "@autopoly/sports-model": path.resolve(REPO_ROOT, "packages/sports-model/src/index.ts"),
      "@autopoly/delta-pm-contracts": path.resolve(REPO_ROOT, "packages/delta-pm-contracts/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: [
      "scripts/**/*.test.ts",
      "packages/**/*.test.ts",
      "services/**/*.test.ts",
      // Pure-logic web tests only (.ts, never .tsx) so React components are not
      // pulled into the node test environment.
      "apps/web/**/*.test.ts",
      "apps/raven/lib/**/*.test.ts",
      "apps/raven-delta/lib/**/*.test.ts"
    ]
  }
});
