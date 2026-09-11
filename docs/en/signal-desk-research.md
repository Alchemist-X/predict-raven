# Signal Desk research runtime integration

[中文](../signal-desk-research.md)

Research mode searches public sources and the personal subscription index through one local gateway. The Claude and DeepSeek loops in `forecast-engine`, and the Hongshu repository's OpenRouter `orgpt.py --tools`, use this gateway.

## Run

From the Hongshu repository:

```bash
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 check
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 forecast \
  --question "Will Meta lower its capital expenditure guidance within six months?" --max-rounds 3
python3 scripts/research.py --start-date 2026-03-11 --end-date 2026-09-11 orgpt \
  --prompt-file path/to/research-prompt.md --out path/to/report.md
```

Dates constrain the subscription catalogue, not the forecast horizon, and may be ingestion dates rather than publication dates. Framing must define the question's resolution criteria; historical research must verify original publication dates.

Configure `forecast_repo` in `~/.config/raven/research/runtime.json`, or set `RAVEN_FORECAST_REPO` to an integrated checkout. This integration was ported onto current main, preserving research planning and claim cross-checking. The service implementation stays in the personal private workspace; this public repository contains only the generic process adapter. Credentials and subscription content are not distributed with it.

Direct engine invocation:

```bash
FORECAST_SIGNAL_DESK=1 FORECAST_SIGNAL_DESK_COMMAND="$HOME/.local/bin/raven-signal-desk" \
  pnpm forecast:event -- "Research question" --max-rounds 3
```

The feature is off globally and enabled by the dedicated launcher. `FORECAST_PROVIDER=deepseek` selects the OpenAI-compatible loop; otherwise Claude uses its existing CLI model/auth configuration. The Codex provider does not yet support this gateway and explicitly rejects Signal Desk mode instead of silently omitting subscription search. No trading, orders, scheduling, shared deployment or public website integration was added.

## Tools and routing

| Tool | Behavior |
| --- | --- |
| `web_search` | Always searches public sources and Signal Desk; default six candidates per source, separate source statuses |
| `fetch_page` | Reads public pages; exact subscription Markdown URLs use authenticated reading |
| `signal_desk_search` | Keyword, date, publisher, title/body and pagination filters |
| `signal_desk_read` | Reads Markdown by article ID, distinguishing summaries and full articles |
| `signal_desk_pdf` | Downloads or reuses a cached report, returning numbered pages of extracted text |

Claude research mode loads these tools via `--mcp-config` and disables built-in tools so general searches go through the gateway. OpenRouter and DeepSeek consume the same schemas and `research-call` dispatch. Explicit tool-disabled summary calls remain disabled.

Public search uses Exa/Tavily environment credentials when available, otherwise DuckDuckGo. Errors such as HTTP 403 or timeout remain visible per source, while successful results from the other source are retained. `research_keywords=["Meta","capex"]` requires both literal keywords. Chinese Meta questions have basic entity/topic extraction; supply concise keywords for complex queries.

## Evidence boundaries

- Results preserve stable URLs, provider, content type, coverage and read ranges. `search_candidate` is discovery; `summary_verified` identifies retrieved summary text; `body_verified` identifies retrieved article or PDF text. These labels neither certify claims nor imply the whole document was read.
- The engine uses successful tool `source_urls` for trace membership. Failed private reads do not pass through a URL-liveness fallback. Links embedded in retrieved text do not become verified sources automatically.
- Catalogue coverage differs from indexed-body coverage. Many Foreign Research entries are title-only. Zero matches do not establish absence, and public search dates are not a hard filter.
- The former local five-download budget has been removed for this research. Upstream permission/rate-limit errors remain visible. PDF extraction can omit figures/tables or truncate page text; inspect the original when numerical accuracy matters. Searches do not bulk-download reports.
- The existing local service owns the key; it is not a model argument or repository file. Retrieved subscription material is sent to the configured model for authorized personal research. Reports should summarize and cite rather than reproduce complete articles.

## Audit and validation

The launcher creates private `~/.local/share/raven/signal-desk/research-runs/<runId>/` artifacts for requests, output, exit status and tool traces. Parsed model outputs, reported model/usage where available and retrieval traces are saved in the adjacent `.models.jsonl` file. Tool traces omit complete bodies, keys and temporary signed links; the existing service owns the content cache.

Validation covers schema/error behavior, trace integrity, complete JSON pagination and legacy public-search compatibility. A real Claude MCP run completed combined search and summary reading: both sources succeeded and the model correctly reported 500 characters read with more content remaining. Detailed acceptance evidence remains in the private local run directory. OpenRouter and DeepSeek loops were tested with simulated model responses rather than additional paid model calls. Service validation includes real search/read and cached PDF page extraction.

Research cost coverage is marked `partial` when external search costs are not included in the model bill.

When rerunning an existing question, pass its original `--resolution`. The engine preserves those supplied criteria after both framing and audit; caveats may identify ambiguities but cannot rewrite the pinned rules.

When model output fails validation, the engine records the specific error and provides it with the previous output for one correction attempt. Rejected output never changes the probability. Retries retain actual retrieved sources and deduplicated queries, and aggregate known model cost and usage. Unsupported statements cannot pass merely by relabeling a source.
