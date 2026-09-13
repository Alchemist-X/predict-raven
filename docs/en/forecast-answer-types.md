# Preserve the requested answer space

[中文](../forecast-answer-types.md)

The entry point first identifies the answer requested, then freezes the horizon, options, unit and resolution criteria. It does not rewrite a four-choice, score or company-comparison question into an arbitrary binary event.

| Question | `answerType` | Result |
| --- | --- | --- |
| Will one company reduce its budget? | `binary` | Existing probability, evidence and report |
| Which exhaustive, mutually exclusive option occurs? | `categorical` | Every option's probability, winner or tie; sum 1 |
| Next-quarter growth or a rubric score | `numeric` | Point estimate, unit and model range; scores require bounds and rubric |
| Which M7 company is most likely to lower capex? | `independent_ranking` | Each entity's marginal probability and full ranking; no normalization |

Independent ranking means separate event estimates, not statistical independence between companies. Most likely does not mean first to occur. Several companies or none may qualify. Missing guidance or missing information is a gap, not zero probability.

## Invocation

Natural-language classification is the default. Pin the structure with CLI `--answer-request` JSON or API/MCP `answerRequest`. Both accept `answerType`, `options` (`id`/`label`), `unit`, `minimum`, `maximum` and `resolution`.

```bash
pnpm forecast:event -- "Who wins this four-choice contest?" --answer-request '{"answerType":"categorical","options":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"},{"id":"d","label":"D"}]}'
pnpm forecast:event -- "What score will next quarter achieve?" --answer-request '{"answerType":"numeric","unit":"points","minimum":0,"maximum":100,"resolution":"Use the published assessment and its existing 100-point rubric."}'
pnpm forecast:event -- "Which M7 company is most likely to lower capex within six months?" --max-rounds 2
```

Pinned options, scale and resolution survive framing and audit. Run IDs include these constraints to prevent resuming a different target. Legacy binary IDs without new constraints remain unchanged.

## Engine and presentation

`question-spec.ts` classifies and validates, `answer-math.ts` owns updates, and `structured-engine.ts` researches, records sources, deduplicates and persists. The model supplies atomic quoted claims and proposed effects; the engine owns the answer. Final explanatory prose cannot overwrite the computed value.

Categorical updates normalize likelihood weights. Ranking updates each marginal logit. Numerical forecasts use normal precision updates. Repeated evidence groups receive reduced weight, and URLs absent from successful retrieval traces have no numerical effect. Priors, effect sizes and numerical signals remain subjective. The numerical 10th–90th percentile range is conditional on model assumptions and clipped to scale bounds, not empirically calibrated uncertainty.

New states use `schemaVersion: 2` and `answer`, without `currentProb`. Legacy `loadState` remains binary-only; generic API/UI readers discriminate by type. JSON, text, PDF, detail and research views show the matching distribution, value or ranking. Resume replays evidence and checks every round; resuming an already-completed round limit spends no model or retrieval calls.

## Expanded resource library

User-facing research calls Geoscope / Signal Desk the **expanded resource library**; technical `signal_desk_*` identifiers remain compatible. The personal launcher requires `FORECAST_REQUIRE_EXPANDED_LIBRARY=1` with `FORECAST_SIGNAL_DESK=1`. The public repository distributes neither subscriptions nor article bodies; other installations must supply a personal gateway.

Both binary and typed research pre-search and read real snippets. Comparisons cover every entity. Each pre-read article must contribute a matching ID, URL and exact short quotation, or receive a concrete exclusion reason. Failed retrieval remains an explicit coverage gap. A search result is not a read, a summary is not a PDF, and author opinion is not company guidance. Attribute the original author, publication date and epistemic status.

Required-but-disabled gateways fail explicitly. Upstream failures preserve attempts and gaps. Private snippets and failed model responses remain in private run storage, and generic interfaces omit full article bodies. See the [integration guide](signal-desk-research.md).

## Verification

Verify binary regressions, categorical sums, non-normalized rankings, numerical units/negative values/bounds, ties, repair trace retention, deduplication, round replay, mandatory library use/exclusion and real API/MCP/UI/PDF behavior. Separately check source dates, company attribution and settlement definitions for a live forecast. Software tests validate behavior, not future prediction accuracy.
