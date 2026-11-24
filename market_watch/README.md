# Market Watch

A minute-by-minute watcher for two watchlists, US stocks and index futures (MNQ, MES, …).
It pushes bullish and bearish volume-breakout signals to your phone and can replay
history to show how those signals did afterwards.

> **This tool only sends signals. It has no broker connection and never places trades.**

## Setup

```bash
cd market_watch
pip install -r requirements.txt
# edit config.yaml: watchlists, thresholds, and your ntfy topic
python -m marketwatch test-alert      # check that a push reaches your phone
python -m marketwatch live            # run during market hours (Ctrl+C to stop)
python -m marketwatch backtest        # replay the last 3 months
python -m pytest tests                # synthetic-data tests
```

## What it checks

Every minute, during each watchlist's `alert_hours`, it looks at each symbol's latest
completed 1-minute bar:

| Measure | How it's computed |
|---|---|
| Volume ratio | Volume over the last 5 minutes ÷ the average 5-minute volume at the same clock time over the past 30 days |
| Day high / low | Running high and low of the current session |
| VWAP | Session-cumulative (typical price × volume) ÷ volume |
| Previous day high / low | Prior session's range |
| Last hour high / low | The prior 60 minutes, not counting the current bar |

**Bearish** fires only when all three are true: volume ≥ 2.5× normal; price ≥ 1.5% below
the day's high *and* below VWAP; price below the previous day's low *or* the last hour's low.

**Bullish** is the mirror image: volume ≥ 2.5× normal; price ≥ 1.5% above the day's low
*and* above VWAP; price above the previous day's high *or* the last hour's high.

Futures use 0.5% instead of 1.5%. Each watchlist has its own `thresholds` block in
`config.yaml`, so you can tune them separately.

Think of the volume ratio as checking the crowd at a train station against what's normal
*for that time of day*. 5,000 people at 8:30 a.m. is a normal rush hour. 5,000 at 2 p.m.
means something is happening. That's why the comparison uses the same clock time and not
the daily average: volume is always heavy at the open and close.

### Alerts

- At most **one alert per symbol per hour** (`cooldown_minutes`). The cooldown is saved in
  `.alert_state.json`, so restarting the watcher doesn't send repeats.
- An alert looks like this: `NVDA bearish signal: price 181.50, -1.82% from the day's high, volume 3.4x normal`
- Every alert is appended to `alerts.log` with the time it was sent and the time of the bar it fired on.
- Delivery options:
  - **ntfy** (free, no account): install the ntfy app and subscribe to your topic. Set
    `alerts.ntfy.topic`, or the `NTFY_TOPIC` env var. Anyone who knows the topic name can read
    it, so make it random. `NTFY_TOKEN` is used if you protect the topic.
  - **Pushover**: set `notifier: pushover`, then export `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN`.
  - **none**: console and log file only.

### Sessions

- **Stocks:** 09:30–16:00 ET regular hours. Pre- and post-market are ignored.
- **Futures:** the CME Globex day runs from 18:00 ET the evening before to 17:00 ET. Day
  high/low, VWAP and "previous day" follow that day, so a Sunday-evening bar counts toward
  Monday. By default, alerts are only checked during US cash hours. Change
  `futures.alert_hours` to watch overnight.
- Futures symbols can be bare roots (`MNQ`). Yahoo's continuous front-month ticker (`MNQ=F`)
  is used automatically.

## Backtest

```bash
python -m marketwatch backtest                      # 5m bars from Yahoo
python -m marketwatch backtest --interval 1h        # full 3 months from Yahoo, coarser
python -m marketwatch backtest --data-dir ./bars    # your own 1m CSVs: SYMBOL.csv
```

The backtest sends every historical bar through the same signal code the live watcher uses,
with the same one-per-hour cooldown. It never looks at bars after the one being evaluated.
It reports:

- the number of bullish and bearish alerts per watchlist, per symbol, and overall
- for 1, 2 and 3 trading days later: how often the session close was beyond the alert price
  in the signalled direction, plus the average and median move

Every alert is written to `backtest_alerts.csv`. An alert too recent to have a complete
outcome yet is left out of that horizon's percentage.

**Limits of the free data.** Yahoo keeps only about 30 days of 1-minute bars, 60 days of
5-minute bars and 2 years of hourly bars. So:

- The default 5m backtest covers about the last month. The first 30 days of the 60 available
  are used to build the volume baseline. The report prints the window it actually tested.
- `--interval 1h` covers the full 3 months. Each hourly bar's volume is compared with the
  average for that hour, which is a coarser version of the live rule.
- For an exact 3-month replay at 1-minute resolution, export 1-minute bars from another
  source as CSVs (`timestamp,open,high,low,close,volume`; timestamps without a timezone are
  read as UTC) and use `--data-dir`.

## Caveats

- Yahoo's data is free and unofficial. It can be late, have gaps, or change format. Yahoo's
  CME futures quotes are typically **delayed about 10 minutes**. Bars older than 20 minutes
  are skipped, not alerted on.
- In live mode, the 30-day baseline is limited by Yahoo's 1-minute history to about 20
  sessions. A symbol needs at least `min_baseline_days` (default 5) prior sessions before it
  can alert.
- `MNQ=F` / `MES=F` are continuous contracts. Volume can shift around quarterly rolls.
- Signals are not advice. A backtest hit rate near 50% means the signal has no edge on that
  data.
