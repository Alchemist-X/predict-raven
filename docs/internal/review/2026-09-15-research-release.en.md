# Research release verification

[中文](2026-09-15-research-release.md)

## Scope and behavior

This release includes the 12 existing `codex/forecast-answer-types` commits ahead of `origin/main` and its 59 current source/document changes. Other old worktrees are excluded. Binary probabilities, mutually exclusive choices, numeric forecasts and independent event rankings retain their meanings. Research defaults to unlimited rounds and searches again for material evidence gaps. Incomplete API and Raven results expose provisional estimates and explicit status without a final conclusion.

The expanded library separates discovery, actual text reading and extracted PDF pages. Models select material inline figures for the question, receive native MCP image content and archive visual observations. Text-only routes explicitly report unavailable visual review; downloading images and OCR do not establish verified body reading. Private subscription bodies, caches and credentials are excluded from the public release.

## Validation

- Engine and Forecast API: 381 passing tests across 30 files.
- Raven pure logic: 5 passing tests.
- Engine, Forecast API and Raven: all three typechecks passed.
- `pnpm --filter @autopoly/raven build`: production build passed.
- At 1440×1000 and 390×844, 20 page cases covered the home page, three new answer formats, incomplete ranking, incomplete binary report, three incomplete research states and existing research demo. Chinese switching and report-to-research navigation also passed.
- Browser records contained no console errors, page errors, error overlays or horizontal page overflow. Screenshot review confirmed answer units, independent-probability wording, provisional labels, evidence sections and mobile layout.
- Credential-pattern scanning found no matches in the public tree. Comparing changed files against 1,736 local subscription caches found no exact contiguous 700-character body copies. This checks exact copies and does not claim to detect paraphrases.

Visual checks used synthetic fixtures and the existing demo. No research tasks, paid model requests or trades were executed. Raw local evidence is stored at `/tmp/raven-merge-research-release-20260915/`, including test/build logs, screenshots, page error records and source hashes.

## Release boundary

Merging main triggers repository CI. Deployment configuration is unchanged. The existing `deploy/raven` procedure governs hosted Raven and Forecast API updates; code verification does not establish live deployment verification.
