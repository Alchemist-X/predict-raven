# Forecast answer types

HTTP `POST /v1/forecasts`, MCP `forecast_start`, and Raven `POST /api/forecasts` accept an optional `answerRequest`. The engine infers the type when omitted. Raven also provides an answer-format selector.

```json
{
  "question": "Which candidate company is most likely to lower capital expenditure over the next six months?",
  "answerRequest": {
    "answerType": "independent_ranking",
    "options": [
      { "id": "a", "label": "Company A" },
      { "id": "b", "label": "Company B" }
    ],
    "resolution": "Compare previously announced capital expenditure guidance for the same fiscal year and accounting basis."
  }
}
```

| answerType            | Meaning                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`                | Infer the type while preserving the user's question and candidate scope.                                                                       |
| `binary`              | Existing yes/no event probability and legacy response fields.                                                                                  |
| `categorical`         | Mutually exclusive option probabilities, selected option, and ties; probabilities sum to 1.                                                    |
| `numeric`             | Point estimate with a unit and model range; accepts `unit`, `minimum`, and `maximum`. The model range is not a calibrated confidence interval. |
| `independent_ranking` | Separately stated event probabilities and entity ranks. Events can co-occur; probabilities are not normalized to sum to 1.                     |

New result types use `answer`, with `answerType` and `answerLabel` for presentation. Their `probability` and `probabilityPct` are both `null`; a winning option's probability must not masquerade as the legacy binary result. `structured` includes resolution rules, research rounds, selected evidence, and original excerpts. Cached full subscription articles are excluded from API and Raven payloads.

Text and PDF share the same structured content. Raven uses dedicated report and research views with source links, original excerpts, and fact/opinion/estimate labels rather than legacy binary charts.

Explicit types, options, units, and resolution rules participate in the task ID. API and CLI import the same `makeEventId`: identical contracts resume, changed contracts do not reuse another dossier. Binary-only internal consumers keep `loadState`, which returns `null` for `schemaVersion: 2`. Forecast API and Raven use `loadAnyState`.

## Validation

- 195 engine and forecast-api regression tests passed, including legacy binary behavior, new answer shapes, request boundaries, and task IDs.
- API/Raven type checks and the Raven production build passed.
- Synthetic fixtures verified real HTTP JSON, text, PDF, and MCP status responses for all three new types, without paid model calls or trading.
- All three result/research views plus home and the legacy binary demo were checked at 1440px/390px in 16 screenshots: no page errors or horizontal overflow on the new views. Chinese switching and citation navigation worked.
- Local synthetic verification artifacts are in the worktree's `output/playwright/typed-answer/`; screenshots, PDFs, and local run state are not committed.

The [Chinese version](ANSWER-TYPES.md) is authoritative.
