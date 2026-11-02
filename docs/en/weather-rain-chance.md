# NWS rain-chance auto snapshot (35 Kalshi rain-market settlement stations)

Last updated: 2026-11-02. Chinese original: [`docs/weather-rain-chance.md`](../weather-rain-chance.md) (Chinese is authoritative).

## What it is

- Every hour, pull the precipitation-probability (PoP) forecast from the public NWS API (api.weather.gov, free, no credentials) for the 35 settlement stations used by the Kalshi daily / weekend rain markets: hourly PoP (about 7 days ahead) and 12-hour period PoP (the headline "chance of rain"), plus the hourly PoP aggregated per **station-local calendar day (midnight to midnight)**.
- The station list comes from the `CLIxxx` code in each market's `rules_primary`; names and coordinates come from the NWS station registry, see [`scripts/weather/kalshi-rain-stations.json`](../../scripts/weather/kalshi-rain-stations.json). Easy-to-confuse pairs: New York = Central Park KNYC (not LGA/JFK), Chicago rain = O'Hare KORD (the high-temperature market uses Midway KMDW), Houston = Hobby KHOU, Dallas = DFW, Washington = Reagan KDCA, West Palm Beach = the new station id KDJT.
- This is a research data feed, not a trading basis: order probabilities must still come from the forecasting pipeline (see `CLAUDE.md`). Markets settle on the measured daily precipitation in the NWS Daily Climate Report (CLI); PoP is a forecast, a different thing.

## How the automated job runs

- GitHub Actions: [`.github/workflows/nws-rain-chance.yml`](../../.github/workflows/nws-rain-chance.yml), hourly at minute 25 (UTC), also runnable by hand from the Actions tab ("NWS rain chance snapshot" → Run workflow).
- Data goes to the dedicated branch `data/nws-rain-chance` (created automatically on the first run), never to `main`. A station is written and committed only when its NWS `updateTime` moved; with no change there is no commit.
- If any station fails, the successful ones are still committed and the run is marked failed (script exit code 2); the log lists the failed stations and reasons.
- The script has zero dependencies (plain Node), so CI skips `pnpm install`; a run takes about a minute.

## Data layout (branch `data/nws-rain-chance`)

| Path | Content |
| --- | --- |
| `latest/hourly.csv` | Newest hourly PoP for all 35 stations: `station, kalshi_code, city, forecast_issued_utc, start_time, pop_percent, temp_f, short_forecast`. The `forecast_issued_utc` column doubles as the "is there a new issuance" state; there is no separate state file |
| `latest/periods.csv` | 12-hour period PoP (Tonight / Tuesday / Tuesday Night …), also with `forecast_issued_utc` |
| `latest/daily.csv` | Hourly PoP aggregated per station-local calendar day (midnight to midnight in the station's own time zone): `local_date, hours_covered, max_pop_percent, mean_pop_percent`. `hours_covered` below 24 means a partial day (today from the fetch hour on, or the tail of the 7-day forecast) |
| `latest/summary.md` | Human table: per station the forecast issue time plus the highest hourly PoP for each of the next ~7 local calendar days; partial days are marked `·Nh` |
| `latest/run.json` | Status of the last run that wrote: ok / failed stations, each station's grid and issue times |
| `snapshots/YYYY/MM/DD/HHMMSSZ-{hourly,periods,daily}.csv` | Rows for the stations that had a new issuance in that run (failed or unchanged stations are absent here and keep their previous issuance in `latest/`). Concatenate every snapshot and dedupe on `(station, forecast_issued_utc)` to get the full forecast history |

`start_time` carries the station's local UTC offset (for example `2026-11-03T00:00:00-06:00`), and calendar days are cut on that local time. A null PoP from NWS is recorded as 0. Note that NWS's own 12-hour periods (This Afternoon / Tonight / Tuesday …) split at 6 AM and 6 PM local, which does not line up with the settlement calendar day, so the daily aggregate uses the hourly data only.

Reading it without touching your local `main`:

```bash
git fetch origin data/nws-rain-chance
```

```bash
git show origin/data/nws-rain-chance:latest/summary.md
```

Or mount it as its own directory: `git worktree add ../predict-raven-weather-data data/nws-rain-chance`.

## Running it locally

```bash
pnpm weather:rain-chance
```

By default it writes a full snapshot to `runtime-artifacts/weather/nws-rain-chance/` (gitignored). Other forms:

```bash
pnpm weather:rain-chance --stations KNYC,KORD
```

```bash
pnpm weather:rain-chance --check-stations
```

`--check-stations` cross-checks the configured coordinates against the NWS registry (0.02° tolerance). Optional env `NWS_USER_AGENT` (NWS wants an identifying UA; the default carries the repo URL, locally you can add an email).

## Known limits

- Polled hourly but written only when NWS updates the forecast; typically 3–8 issuances per station per day. Measured: one full 35-station hourly CSV is about 500 KB (33 KB gzipped) and a run with changes commits roughly 10–30 KB compressed, so the data branch should grow by about 100–200 MB per year. `git clone` fetches it by default; use `--single-branch` if that matters, or later point the job at a dedicated data repository.
- GitHub scheduled runs can be delayed by minutes to half an hour; GitHub disables schedules in repos with no activity for 60 days.
- PoP only, no quantitative precipitation (QPF). For modelling the "daily precipitation > 0 inch" settlement, the next step would be adding `quantitativePrecipitation` from the raw NWS gridpoint data.
