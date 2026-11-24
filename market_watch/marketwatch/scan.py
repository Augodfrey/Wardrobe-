"""Scan mode: for schedulers that can only run every so often (e.g. hourly).

Each run replays every completed 1-minute bar since the previous run through the
same signal rules as live mode, so no minute is skipped -- alerts just arrive at
the next run instead of the same minute. The last bar scanned per symbol and the
one-per-hour cooldown are saved in the state file, so runs never repeat an alert.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import pandas as pd

from .alerts import Alert, Cooldown, Notifier, log_alert
from .config import Config
from .live import LiveWatcher
from .signals import compute_indicators, evaluate_signals, in_alert_hours

log = logging.getLogger(__name__)


def run_scan(cfg: Config, lookback_minutes: int = 70) -> list[Alert]:
    now = datetime.now(timezone.utc)
    marks_file = cfg.state_file.with_name(cfg.state_file.stem + "_scan.json")
    try:
        marks = {k: pd.Timestamp(v) for k, v in json.loads(marks_file.read_text()).items()}
    except (OSError, ValueError):
        marks = {}

    watcher = LiveWatcher(cfg, Notifier(cfg))
    cooldown: Cooldown = watcher.cooldown
    alerts: list[Alert] = []
    for wl in cfg.watchlists:
        watcher._refresh_history(wl, now)
        for ticker, bars in watcher._bars(wl, now).items():
            if bars.empty:
                log.warning("[%s] %s: no data", wl.name, ticker)
                continue
            since = marks.get(ticker, bars.index[-1] - pd.Timedelta(minutes=lookback_minutes))
            new = bars[bars.index > since]
            if new.empty:
                continue
            ind = compute_indicators(bars, wl, cfg)
            ind = ind[ind.index > since]
            if ind.empty:
                marks[ticker] = bars.index[-1]
                continue
            # compute_indicators above built baselines for all dates; that's fine for
            # ~30 days of bars and keeps scan identical to backtest.
            sig = evaluate_signals(ind, wl)
            sig = sig[in_alert_hours(sig, wl) & (sig["bullish"] | sig["bearish"])]
            label = wl.labels.get(ticker, ticker)
            for ts, r in sig.iterrows():
                if not cooldown.allow(ticker, ts.to_pydatetime()):
                    continue
                bullish = bool(r["bullish"])
                alert = Alert(time=ts.to_pydatetime(), watchlist=wl.name, ticker=label,
                              direction="BULLISH" if bullish else "BEARISH",
                              price=float(r["close"]),
                              pct_move=float(r["pct_from_low"] if bullish else -r["pct_from_high"]),
                              vol_ratio=float(r["vol_ratio"]))
                log_alert(alert, cfg.log_file)
                watcher.notifier.send(alert)
                alerts.append(alert)
                print(f"ALERT {ts.tz_convert(wl.timezone):%H:%M %Z} | {alert.message}")
            marks[ticker] = bars.index[-1]
    marks_file.write_text(json.dumps({k: v.isoformat() for k, v in marks.items()}))
    print(f"scan done: {len(alerts)} alert(s)")
    return alerts
