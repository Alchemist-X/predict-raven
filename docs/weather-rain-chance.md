# NWS 降水概率自动快照（Kalshi 降雨市场 35 个结算站）

最后更新：2026-11-02。英文版见 [`docs/en/weather-rain-chance.md`](en/weather-rain-chance.md)。

## 这是什么

- 每小时从 NWS 公共 API（api.weather.gov，免费、无需凭证）抓取 Kalshi 日降雨 / 周末降雨市场所用 35 个结算站点的降水概率（PoP）预报：逐小时 PoP（约 7 天）和 12 小时时段 PoP（官方"降雨几率"），并把逐小时 PoP 按**站点本地日历日（0 点到 0 点）**聚合成每日 PoP。
- 站点清单来自各市场 `rules_primary` 里的 `CLIxxx` 代码，名称与坐标来自 NWS 站点注册表，见 [`scripts/weather/kalshi-rain-stations.json`](../scripts/weather/kalshi-rain-stations.json)。容易混淆的几对：纽约 = 中央公园 KNYC（不是 LGA/JFK）、芝加哥降雨 = 奥黑尔 KORD（高温市场用中途 KMDW）、休斯顿 = Hobby KHOU、达拉斯 = DFW、华盛顿 = Reagan KDCA、西棕榈滩 = 新站号 KDJT。
- 这是研究用数据源，不是交易依据：下单概率仍必须出自 forecasting 流程（见 `CLAUDE.md`）。市场结算以 NWS 日气候报告（CLI）里的实测日降水为准，PoP 是预报，两者是两回事。

## 自动任务怎么跑

- GitHub Actions：[`.github/workflows/nws-rain-chance.yml`](../.github/workflows/nws-rain-chance.yml)，每小时第 25 分钟（UTC）运行，也可在 Actions 页手动触发（"NWS rain chance snapshot" → Run workflow）。
- 数据写到独立分支 `data/nws-rain-chance`（首次运行自动创建），不进 `main`。只有某站的 NWS `updateTime` 变化时才写入并提交；没有变化就不提交。
- 任一站点抓取失败：成功站点照常提交，该次运行标红（脚本退出码 2），日志里有失败站点与原因。
- 脚本本身零依赖（纯 Node），CI 里不跑 `pnpm install`，每次约 1 分钟。

## 数据布局（分支 `data/nws-rain-chance`）

| 路径 | 内容 |
| --- | --- |
| `latest/hourly.csv` | 35 站最新一期逐小时 PoP：`station, kalshi_code, city, forecast_issued_utc, start_time, pop_percent, temp_f, short_forecast`。`forecast_issued_utc` 列同时就是"某站是否有新一期"的判断依据，没有单独的状态文件 |
| `latest/periods.csv` | 12 小时时段 PoP（Tonight / Tuesday / Tuesday Night …），同样带 `forecast_issued_utc` |
| `latest/daily.csv` | 逐小时 PoP 按站点本地日历日（0 点到 0 点，站点自己的时区）聚合：`local_date, hours_covered, max_pop_percent, mean_pop_percent`。`hours_covered` 不足 24 表示当天只覆盖部分小时（今天从抓取时刻起、或 7 天预报的末尾） |
| `latest/summary.md` | 人读表：每站预报发布时间 + 未来约 7 个本地日历日各自的最高逐小时 PoP；部分覆盖的日子标 `·Nh` |
| `latest/run.json` | 最近一次有写入的运行状态：成功 / 失败站点、各站 grid 与发布时间 |
| `snapshots/YYYY/MM/DD/HHMMSSZ-{hourly,periods,daily}.csv` | 当次运行有新一期预报的站点的行（抓取失败或没变化的站不在里面，它们在 `latest/` 里保留上一期）。把全部 snapshot 合并后按 `(station, forecast_issued_utc)` 去重，就是完整的预报历史 |

`start_time` 带站点本地时区偏移（如 `2026-11-03T00:00:00-06:00`），日历日就按这个本地时间划分。NWS 对 PoP 返回 null 时记为 0。注意 NWS 自己的 12 小时时段（This Afternoon / Tonight / Tuesday …）是按本地 6 点和 18 点切的，和结算用的日历日不对齐，所以每日汇总只用逐小时数据。

读取方式（不污染本地 `main`）：

```bash
git fetch origin data/nws-rain-chance
```

```bash
git show origin/data/nws-rain-chance:latest/summary.md
```

或者 `git worktree add ../predict-raven-weather-data data/nws-rain-chance` 单独挂一个目录。

## 本地手动运行

```bash
pnpm weather:rain-chance
```

默认全量写到 `runtime-artifacts/weather/nws-rain-chance/`（gitignored）。其他用法：

```bash
pnpm weather:rain-chance --stations KNYC,KORD
```

```bash
pnpm weather:rain-chance --check-stations
```

`--check-stations` 用 NWS 注册表逐站核对配置里的坐标（容差 0.02°）。可选环境变量 `NWS_USER_AGENT`（NWS 要求 UA 带可识别信息；默认带仓库地址，本地可改成带邮箱）。

## 已知限制

- 轮询每小时一次，但只在 NWS 更新预报时落盘；每站每天通常 3–8 期。实测一份 35 站全量逐小时 CSV 约 500 KB（gzip 后 33 KB），每次有变化的运行提交约 10–30 KB（压缩后），估计数据分支每年增长 100–200 MB。`git clone` 默认会把它拉下来，介意的话用 `--single-branch`，或者以后把任务改为推送到独立的数据仓库。
- GitHub 定时任务可能延迟数分钟到半小时；仓库 60 天无活动时 GitHub 会自动停用定时任务。
- 只抓 PoP，不抓定量降水（QPF）。如果要做"日降水 > 0 英寸"的结算建模，下一步可加 NWS gridpoint 原始数据里的 `quantitativePrecipitation`。
