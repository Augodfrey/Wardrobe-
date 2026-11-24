"""Backtest mode: replay history bar by bar through the live signal logic and
measure follow-through over the next N trading days."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from . import data
from .alerts import Cooldown
from .config import Config, Watchlist
from .signals import compute_indicators, evaluate_signals, in_alert_hours

log = logging.getLogger(__name__)


def backtest_symbol(bars: pd.DataFrame, wl: Watchlist, cfg: Config, ticker: str,
                    test_start: pd.Timestamp, forward_days: list[int]) -> list[dict]:
    ind = compute_indicators(bars, wl, cfg)
    if ind.empty:
        return []
    sig = evaluate_signals(ind, wl)
    sig = sig[in_alert_hours(sig, wl) & (sig["tdate"] >= test_start)]
    candidates = sig[sig["bullish"] | sig["bearish"]]

    session_close = ind.groupby("tdate")["close"].last()
    tdates = list(session_close.index)
    pos = {d: i for i, d in enumerate(tdates)}

    cooldown = Cooldown(cfg.cooldown_minutes)  # in-memory only for backtests
    rows = []
    for ts, r in candidates.iterrows():
        if not cooldown.allow(ticker, ts.to_pydatetime()):
            continue
        bullish = bool(r["bullish"])
        sign = 1 if bullish else -1
        row = {
            "time": ts.isoformat(), "watchlist": wl.name, "ticker": wl.labels.get(ticker, ticker),
            "direction": "BULLISH" if bullish else "BEARISH", "price": round(r["close"], 4),
            "pct_move": round(r["pct_from_low"] if bullish else -r["pct_from_high"], 3),
            "vol_ratio": round(r["vol_ratio"], 2), "vwap": round(r["vwap"], 4),
        }
        i = pos[r["tdate"]]
        for k in forward_days:
            if i + k < len(tdates):
                ret = (session_close.iloc[i + k] - r["close"]) / r["close"] * 100 * sign
                row[f"fwd{k}d_pct"] = round(ret, 3)
            else:
                row[f"fwd{k}d_pct"] = np.nan  # not enough future data yet
        rows.append(row)
    return rows


def summarize(df: pd.DataFrame, forward_days: list[int]) -> str:
    lines = []
    for direction in ("BULLISH", "BEARISH"):
        sub = df[df["direction"] == direction] if not df.empty else df
        lines.append(f"  {direction.title()} alerts: {len(sub)}")
        for k in forward_days:
            col = f"fwd{k}d_pct"
            vals = sub[col].dropna() if col in sub else pd.Series(dtype=float)
            if vals.empty:
                lines.append(f"    +{k} day{'s' if k > 1 else ' '}: no completed outcomes")
                continue
            hit = (vals > 0).mean() * 100
            way = "up" if direction == "BULLISH" else "down"
            lines.append(f"    +{k} day{'s' if k > 1 else ' '}: kept moving {way:<4} "
                         f"{hit:5.1f}% of the time  (n={len(vals)}, avg {vals.mean():+.2f}%, "
                         f"median {vals.median():+.2f}%)")
    return "\n".join(lines)


def run_backtest(cfg: Config, days: int | None = None, interval: str | None = None,
                 data_dir: str | None = None, output: str | None = None) -> pd.DataFrame:
    bt = cfg.backtest
    days = int(days or bt.get("days", 90))
    interval = interval or bt.get("interval", "5m")
    forward_days = [int(k) for k in bt.get("forward_days", [1, 2, 3])]
    output = output or bt.get("output_csv", "backtest_alerts.csv")

    step = data.interval_minutes(interval)
    if step > cfg.volume_window_minutes:
        log.warning("%s bars are coarser than the %d-minute volume window; each bar's volume "
                    "is compared to the same-slot average instead.", interval, cfg.volume_window_minutes)

    # Extra history so the first test day already has a full volume baseline.
    fetch_days = days + cfg.baseline_days + 7
    all_rows, coverage = [], []
    for wl in cfg.watchlists:
        if data_dir:
            bars_by_sym = data.load_csv_dir(data_dir, wl.symbols)
        else:
            bars_by_sym = data.fetch_history(wl.symbols, interval, fetch_days)
        for ticker, bars in bars_by_sym.items():
            if bars.empty:
                log.warning("[%s] %s: no data, skipped", wl.name, ticker)
                continue
            end = bars.index[-1].tz_convert(wl.timezone).normalize().tz_localize(None)
            test_start = end - pd.Timedelta(days=days)
            first_eligible = bars.index[0].tz_convert(wl.timezone).normalize().tz_localize(None) \
                + pd.Timedelta(days=cfg.baseline_days)
            coverage.append((wl.labels.get(ticker, ticker), max(test_start, first_eligible), end))
            all_rows += backtest_symbol(bars, wl, cfg, ticker, test_start, forward_days)

    df = pd.DataFrame(all_rows)
    if not df.empty:
        df = df.sort_values("time")
        df.to_csv(output, index=False)

    print("\n=== Backtest (signals only; no trades simulated or placed) ===")
    print(f"Bars: {interval}   Requested window: last {days} calendar days   "
          f"Cooldown: {cfg.cooldown_minutes} min per symbol")
    if coverage:
        s = min(c[1] for c in coverage).date()
        e = max(c[2] for c in coverage).date()
        print(f"Effective test window (after {cfg.baseline_days}-day baseline warm-up): {s} to {e}")
        if (pd.Timestamp(e) - pd.Timestamp(s)).days < days - 3:
            print(f"  Note: data covers less than {days} days. Yahoo keeps only ~60 days of 5m bars;"
                  " use --interval 1h or --data-dir for a full replay.")
    for wl in cfg.watchlists:
        sub = df[df["watchlist"] == wl.name] if not df.empty else df
        print(f"\n[{wl.name}]  volume >= {wl.thresholds.volume_ratio}x, move >= {wl.thresholds.move_pct}%")
        print(summarize(sub, forward_days))
        if not sub.empty:
            counts = sub.groupby(["ticker", "direction"]).size().unstack(fill_value=0)
            print("  Per symbol:\n" + "\n".join("    " + l for l in counts.to_string().splitlines()))
    if not df.empty:
        print("\nAll combined:")
        print(summarize(df, forward_days))
        print(f"\nAlert details written to {Path(output).resolve()}")
    else:
        print("\nNo alerts fired in the test window.")
    return df
