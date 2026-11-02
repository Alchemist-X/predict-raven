#!/usr/bin/env node
/**
 * NWS rain-chance snapshot for the Kalshi daily / weekend rain settlement stations.
 *
 * Read-only: public api.weather.gov, no credentials, no orders. This is a research
 * data feed; per project rules it is NOT a trading basis on its own (order
 * probabilities must come from the forecasting pipeline).
 *
 * Per station in kalshi-rain-stations.json:
 *   GET /points/{lat},{lon}   -> grid id + forecast URLs
 *   GET .../forecast/hourly   -> hourly probabilityOfPrecipitation (PoP), ~156 h ahead
 *   GET .../forecast          -> 12-hour period PoP (the headline "chance of rain")
 *
 * Output layout (under --out; default runtime-artifacts/weather/nws-rain-chance, gitignored):
 *   latest/hourly.csv, latest/periods.csv   all stations, newest issuance each. The
 *                                           forecast_issued_utc column is also the change-detection
 *                                           state for --only-changed (no separate state file).
 *   latest/daily.csv                        hourly PoP aggregated per station-local calendar day
 *                                           (midnight to midnight in the station's time zone)
 *   latest/summary.md, latest/run.json      human table (daily max PoP) + machine status of the last
 *                                           run that wrote
 *   snapshots/YYYY/MM/DD/HHMMSSZ-{hourly,periods,daily}.csv, -run.json
 *                                           rows written by this run; with --only-changed only the
 *                                           stations whose NWS updateTime moved since latest/
 *
 * Usage:
 *   node scripts/weather/fetch-nws-rain-chance.mjs [--out DIR] [--only-changed]
 *        [--stations KNYC,KORD] [--concurrency 4] [--check-stations]
 *
 * Exit codes: 0 every station ok; 2 some stations failed (outputs for the rest are still
 * written, details in run-error/); 1 fatal (nothing usable written).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const STATIONS_FILE = path.join(HERE, "kalshi-rain-stations.json");
const API = "https://api.weather.gov";
// NWS asks for an identifying User-Agent (ideally with a contact). Override via NWS_USER_AGENT.
const USER_AGENT =
  process.env.NWS_USER_AGENT ?? "predict-raven-nws-rain-chance/1.0 (+https://github.com/Alchemist-X/predict-raven)";
const REQUEST_TIMEOUT_MS = 30_000;
const ATTEMPTS = 4;
const HEARTBEAT_MS = 10_000;

const C = {
  info: (m) => console.log(`\x1b[36mINFO\x1b[0m  ${m}`),
  ok: (m) => console.log(`\x1b[32mOK\x1b[0m    ${m}`),
  warn: (m) => console.log(`\x1b[33mWARN\x1b[0m  ${m}`),
  err: (m) => console.log(`\x1b[31mERR\x1b[0m   ${m}`)
};

function parseArgs(argv) {
  const a = {
    out: path.join(REPO_ROOT, "runtime-artifacts/weather/nws-rain-chance"),
    onlyChanged: false,
    stations: null,
    concurrency: 4,
    check: false
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--") continue;
    else if (k === "--out") a.out = path.resolve(argv[++i]);
    else if (k === "--only-changed") a.onlyChanged = true;
    else if (k === "--stations") {
      a.stations = new Set(
        argv[++i]
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      );
    } else if (k === "--concurrency") a.concurrency = Math.max(1, Number(argv[++i]) || 4);
    else if (k === "--check-stations") a.check = true;
    else if (k === "--help" || k === "-h") {
      console.log("see the header comment of scripts/weather/fetch-nws-rain-chance.mjs");
      process.exit(0);
    } else throw new Error(`unknown argument: ${k}`);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET JSON with retries on network errors / 5xx / 429 (api.weather.gov is flaky); other 4xx is final.
async function getJson(url) {
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i > 0) await sleep(1500 * 2 ** (i - 1));
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    if (res.ok) return res.json();
    lastErr = new Error(`HTTP ${res.status} ${url}`);
    if (res.status < 500 && res.status !== 429) break;
  }
  throw lastErr;
}

async function runPool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        results[idx] = await fn(items[idx], idx);
      }
    })
  );
  return results;
}

// NWS omits PoP (null) when it is not forecast; that means "no measurable chance", recorded as 0.
const popOf = (p) => p.probabilityOfPrecipitation?.value ?? 0;

async function fetchStation(st) {
  const pt = (await getJson(`${API}/points/${st.lat.toFixed(4)},${st.lon.toFixed(4)}`)).properties;
  const [hourly, periods] = await Promise.all([getJson(pt.forecastHourly), getJson(pt.forecast)]);
  const hourlyIssued = hourly.properties.updateTime;
  const periodsIssued = periods.properties.updateTime;
  return {
    grid: `${pt.gridId}/${pt.gridX},${pt.gridY}`,
    hourly_update_time: hourlyIssued,
    periods_update_time: periodsIssued,
    // Row shapes match HOURLY_HEADER / PERIODS_HEADER below.
    hourlyRows: hourly.properties.periods.map((p) => [
      st.station,
      st.kalshi_code,
      st.city,
      hourlyIssued,
      p.startTime,
      popOf(p),
      p.temperature,
      p.shortForecast
    ]),
    periodRows: periods.properties.periods.map((p) => [
      st.station,
      st.kalshi_code,
      st.city,
      periodsIssued,
      p.name,
      p.startTime,
      p.endTime,
      p.isDaytime,
      popOf(p),
      p.temperature,
      p.shortForecast
    ])
  };
}

// --- CSV -------------------------------------------------------------------
const HOURLY_HEADER = [
  "station",
  "kalshi_code",
  "city",
  "forecast_issued_utc",
  "start_time",
  "pop_percent",
  "temp_f",
  "short_forecast"
];
const PERIODS_HEADER = [
  "station",
  "kalshi_code",
  "city",
  "forecast_issued_utc",
  "period",
  "start_time",
  "end_time",
  "is_daytime",
  "pop_percent",
  "temp_f",
  "short_forecast"
];
const DAILY_HEADER = [
  "station",
  "kalshi_code",
  "city",
  "forecast_issued_utc",
  "local_date",
  "hours_covered",
  "max_pop_percent",
  "mean_pop_percent"
];
// Column indexes shared by the hourly rows (also used when reading latest/hourly.csv back).
const COL = { station: 0, kalshi: 1, city: 2, issued: 3, start: 4, hourlyPop: 5 };

const csvEsc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvEsc).join(",")).join("\n") + "\n";

// Minimal RFC-4180 reader for the files this script writes itself.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// latest/<name>.csv -> Map<station, rows[]> (header dropped); empty map when the file is absent.
async function readLatest(latestDir, name) {
  const p = path.join(latestDir, name);
  const m = new Map();
  if (!existsSync(p)) return m;
  for (const r of parseCsv(await readFile(p, "utf8")).slice(1)) {
    if (!m.has(r[COL.station])) m.set(r[COL.station], []);
    m.get(r[COL.station]).push(r);
  }
  return m;
}

// --- daily aggregation -----------------------------------------------------
// Group hourly rows by the station's LOCAL calendar day (midnight to midnight). start_time carries
// the station's UTC offset ("2026-11-03T00:00:00-06:00"), so the local date is its first 10 chars;
// no time-zone math, and DST switches simply show up as 23h / 25h days.
function dailyFromHourly(hourlyRows) {
  const byDate = new Map();
  for (const r of hourlyRows) {
    const date = String(r[COL.start]).slice(0, 10);
    const pop = Number(r[COL.hourlyPop]);
    const d = byDate.get(date) ?? { date, hours: 0, max: 0, sum: 0 };
    d.hours++;
    d.max = Math.max(d.max, pop);
    d.sum += pop;
    byDate.set(date, d);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, hours: d.hours, max: d.max, mean: Math.round(d.sum / d.hours) }));
}

const dailyRows = (hourlyRows) => {
  if (!hourlyRows.length) return [];
  const h = hourlyRows[0];
  return dailyFromHourly(hourlyRows).map((d) => [
    h[COL.station],
    h[COL.kalshi],
    h[COL.city],
    h[COL.issued],
    d.date,
    d.hours,
    d.max,
    d.mean
  ]);
};

const weekday = (date) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${date}T12:00:00Z`).getUTCDay()];

function summaryMd(entries, fetchedAt) {
  const withDaily = entries.filter((e) => e.hourly.length).map((e) => ({ ...e, daily: dailyFromHourly(e.hourly) }));
  const dates = [...new Set(withDaily.flatMap((e) => e.daily.map((d) => d.date)))].sort();
  const lines = [
    `# NWS rain chance — daily, by station-local calendar day`,
    ``,
    `Fetched ${fetchedAt}. Each cell is the highest hourly NWS probability of precipitation (%) inside that local calendar day (midnight to midnight in the station's own time zone). \`·11h\` marks a partial day: today from the fetch hour on, or the tail of the 7-day forecast. Full hourly and 12-hour-period values are in hourly.csv / periods.csv, the daily aggregates (max and mean, hours covered) in daily.csv. Source: api.weather.gov (public, read-only). Research data only, not a trading basis.`,
    ``,
    `| Kalshi city | Station | Issued (UTC) | ${dates.map((d) => `${weekday(d)} ${d.slice(5)}`).join(" | ")} |`,
    `| --- | --- | --- | ${dates.map(() => "---:").join(" | ")} |`
  ];
  for (const e of withDaily) {
    const byDate = new Map(e.daily.map((d) => [d.date, d]));
    const cells = dates.map((date) => {
      const d = byDate.get(date);
      if (!d) return "";
      return d.hours >= 24 ? `${d.max}%` : `${d.max}%·${d.hours}h`;
    });
    lines.push(`| ${e.hourly[0][COL.city]} | ${e.station} | ${e.hourly[0][COL.issued]} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

// --- --check-stations: cross-check config coords against the NWS registry ----
async function checkStations(stations, concurrency) {
  C.info(`checking ${stations.length} stations against ${API}/stations/<id> …`);
  let bad = 0;
  await runPool(stations, concurrency, async (st) => {
    try {
      const reg = await getJson(`${API}/stations/${st.station}`);
      const [lon, lat] = reg.geometry.coordinates;
      const d = Math.max(Math.abs(lat - st.lat), Math.abs(lon - st.lon));
      const line = `${st.station.padEnd(5)} ${st.kalshi_code.padEnd(5)} registry="${reg.properties.name}" Δ=${d.toFixed(4)}°`;
      if (d > 0.02) {
        bad++;
        C.err(`${line}  config=(${st.lat},${st.lon}) registry=(${lat},${lon})`);
      } else C.ok(line);
    } catch (e) {
      bad++;
      C.err(`${st.station}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  if (bad) {
    C.err(`${bad} station(s) mismatched or unreachable`);
    return 1;
  }
  C.ok(`all ${stations.length} stations match the NWS registry (within 0.02°)`);
  return 0;
}

// --- main ------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(await readFile(STATIONS_FILE, "utf8"));
  let stations = cfg.stations;
  if (args.stations) {
    stations = stations.filter((s) => args.stations.has(s.station));
    const missing = [...args.stations].filter((id) => !stations.some((s) => s.station === id));
    if (missing.length) throw new Error(`unknown station id(s) in --stations: ${missing.join(",")}`);
  }

  C.info(`execution mode: inspect (public read-only NWS API; no orders) | decision source: script`);
  C.info(`stations file: ${STATIONS_FILE} (${stations.length} stations${args.stations ? ", filtered" : ""})`);
  C.info(`user-agent: ${USER_AGENT}`);
  if (args.check) return checkStations(stations, args.concurrency);
  C.info(
    `out dir: ${args.out} | mode: ${args.onlyChanged ? "only-changed (write a station only when its NWS updateTime moved)" : "full"}`
  );

  const t0 = Date.now();
  const fetchedAt = new Date(t0).toISOString().replace(/\.\d{3}Z$/, "Z");
  const latestDir = path.join(args.out, "latest");
  await mkdir(latestDir, { recursive: true });
  const prevHourly = await readLatest(latestDir, "hourly.csv");
  const prevPeriods = await readLatest(latestDir, "periods.csv");
  const prevIssued = (m, id) => m.get(id)?.[0]?.[COL.issued] ?? null;

  let done = 0;
  const hb = setInterval(
    () =>
      C.info(
        `heartbeat: ${done}/${stations.length} stations, ${Math.round((Date.now() - t0) / 1000)}s elapsed (per-request timeout ${REQUEST_TIMEOUT_MS / 1000}s × ${ATTEMPTS} attempts)`
      ),
    HEARTBEAT_MS
  );
  hb.unref();

  const results = await runPool(stations, args.concurrency, async (st) => {
    try {
      const cur = await fetchStation(st);
      const changed =
        prevIssued(prevHourly, st.station) !== cur.hourly_update_time ||
        prevIssued(prevPeriods, st.station) !== cur.periods_update_time;
      done++;
      C.ok(
        `${st.station.padEnd(5)} ${st.kalshi_code.padEnd(5)} grid ${cur.grid.padEnd(12)} issued ${cur.hourly_update_time} ${cur.hourlyRows.length}h${changed ? "" : "  (unchanged)"}`
      );
      return { station: st.station, kalshi_code: st.kalshi_code, status: "ok", changed, cur };
    } catch (e) {
      done++;
      const msg = e instanceof Error ? e.message : String(e);
      C.warn(`${st.station.padEnd(5)} ${st.kalshi_code.padEnd(5)} FAILED: ${msg}`);
      return {
        station: st.station,
        kalshi_code: st.kalshi_code,
        status: "failed",
        changed: false,
        cur: null,
        error: msg
      };
    }
  });
  clearInterval(hb);

  const okRes = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status === "failed");
  const toWrite = okRes.filter((r) => !args.onlyChanged || r.changed);
  C.info(
    `fetched ${okRes.length}/${stations.length} ok, ${failed.length} failed, ${okRes.filter((r) => r.changed).length} with a new NWS issuance, in ${Math.round((Date.now() - t0) / 1000)}s`
  );

  const written = [];
  if (toWrite.length === 0) {
    C.info(
      args.onlyChanged ? "no station has a new forecast issuance; nothing written" : "nothing fetched; nothing written"
    );
  } else {
    // 1) snapshot of what this run wrote
    const d = new Date(t0);
    const pad = (n) => String(n).padStart(2, "0");
    const snapDir = path.join(
      args.out,
      "snapshots",
      String(d.getUTCFullYear()),
      pad(d.getUTCMonth() + 1),
      pad(d.getUTCDate())
    );
    const stamp = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    await mkdir(snapDir, { recursive: true });
    const snapHourly = path.join(snapDir, `${stamp}-hourly.csv`);
    const snapPeriods = path.join(snapDir, `${stamp}-periods.csv`);
    const snapDaily = path.join(snapDir, `${stamp}-daily.csv`);
    const snapRun = path.join(snapDir, `${stamp}-run.json`);
    await writeFile(
      snapHourly,
      toCsv(
        HOURLY_HEADER,
        toWrite.flatMap((r) => r.cur.hourlyRows)
      )
    );
    await writeFile(
      snapPeriods,
      toCsv(
        PERIODS_HEADER,
        toWrite.flatMap((r) => r.cur.periodRows)
      )
    );
    await writeFile(
      snapDaily,
      toCsv(
        DAILY_HEADER,
        toWrite.flatMap((r) => dailyRows(r.cur.hourlyRows))
      )
    );
    // 2) latest/* = new rows for the stations written now, previous rows for everything else
    //    (unchanged, filtered out, or failed), in config order.
    const fresh = new Map(toWrite.map((r) => [r.station, r.cur]));
    const entries = cfg.stations.map((st) => ({
      station: st.station,
      hourly: fresh.get(st.station)?.hourlyRows ?? prevHourly.get(st.station) ?? [],
      periods: fresh.get(st.station)?.periodRows ?? prevPeriods.get(st.station) ?? []
    }));
    await writeFile(
      path.join(latestDir, "hourly.csv"),
      toCsv(
        HOURLY_HEADER,
        entries.flatMap((e) => e.hourly)
      )
    );
    await writeFile(
      path.join(latestDir, "periods.csv"),
      toCsv(
        PERIODS_HEADER,
        entries.flatMap((e) => e.periods)
      )
    );
    await writeFile(
      path.join(latestDir, "daily.csv"),
      toCsv(
        DAILY_HEADER,
        entries.flatMap((e) => dailyRows(e.hourly))
      )
    );
    await writeFile(path.join(latestDir, "summary.md"), summaryMd(entries, fetchedAt));
    const run = {
      fetched_at: fetchedAt,
      mode: args.onlyChanged ? "only-changed" : "full",
      stations_total: stations.length,
      ok: okRes.length,
      failed: failed.length,
      written: toWrite.length,
      results: results.map((r) => ({
        station: r.station,
        kalshi_code: r.kalshi_code,
        status: r.status,
        changed: r.changed,
        grid: r.cur?.grid ?? null,
        hourly_update_time: r.cur?.hourly_update_time ?? null,
        periods_update_time: r.cur?.periods_update_time ?? null,
        hours: r.cur?.hourlyRows.length ?? null,
        error: r.error ?? null
      }))
    };
    await writeFile(snapRun, JSON.stringify(run, null, 2) + "\n");
    await writeFile(path.join(latestDir, "run.json"), JSON.stringify(run, null, 2) + "\n");
    written.push(
      snapHourly,
      snapPeriods,
      snapDaily,
      snapRun,
      path.join(latestDir, "hourly.csv"),
      path.join(latestDir, "periods.csv"),
      path.join(latestDir, "daily.csv"),
      path.join(latestDir, "summary.md"),
      path.join(latestDir, "run.json")
    );
  }

  if (failed.length) {
    const errDir = path.join(REPO_ROOT, "run-error", `${fetchedAt.replace(/:/g, "-")}-nws-rain-chance`);
    await mkdir(errDir, { recursive: true });
    const retry = `node scripts/weather/fetch-nws-rain-chance.mjs --out ${args.out}${args.onlyChanged ? " --only-changed" : ""} --stations ${failed.map((r) => r.station).join(",")}`;
    const md = [
      `# nws-rain-chance partial failure (${fetchedAt})`,
      ``,
      `- stage: fetch (points / forecast/hourly / forecast)`,
      `- failed ${failed.length}/${stations.length} stations; the other ${okRes.length} were written normally`,
      `- cause summary: see per-station errors below (api.weather.gov is intermittently 5xx; ${ATTEMPTS} attempts with backoff already applied)`,
      `- next step: \`${retry}\``,
      ``,
      ...failed.map((r) => `- ${r.station} (${r.kalshi_code}): ${r.error}`),
      ``
    ].join("\n");
    await writeFile(path.join(errDir, "error.md"), md);
    C.err(`${failed.length} station(s) failed: ${failed.map((r) => r.station).join(", ")} → ${errDir}/error.md`);
  }

  C.info(`archive: ${args.out}`);
  for (const p of written) C.info(`  ${p}`);
  if (okRes.length === 0) {
    C.err("no station succeeded");
    return 1;
  }
  if (failed.length) return 2;
  C.ok(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    C.err(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(1);
  }
);
