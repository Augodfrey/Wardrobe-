"""Synthetic-data tests for the signal logic, cooldown, live check and backtest."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from marketwatch.alerts import Alert, Cooldown
from marketwatch.backtest import backtest_symbol
from marketwatch.config import load_config
from marketwatch.live import LiveWatcher
from marketwatch.signals import assign_trading_dates, compute_indicators, evaluate_signals

CONFIG = Path(__file__).resolve().parents[1] / "config.yaml"
NY = "America/New_York"


@pytest.fixture
def cfg(tmp_path):
    c = load_config(CONFIG)
    c.log_file = tmp_path / "alerts.log"
    c.state_file = tmp_path / "state.json"
    c.notifier = "none"
    return c


def wl_by(cfg, name):
    return next(w for w in cfg.watchlists if w.name == name)


def flat_day(day: pd.Timestamp, start="09:30", end="16:00", price=100.0, vol=1000.0, freq="1min"):
    idx = pd.date_range(f"{day.date()} {start}", f"{day.date()} {end}", freq=freq,
                        inclusive="left", tz=NY)
    return pd.DataFrame({"open": price, "high": price + 0.1, "low": price - 0.1,
                         "close": price, "volume": vol}, index=idx)


def history(n_days=35, end_day="2026-11-20", **kw):
    days = pd.bdate_range(end=end_day, periods=n_days)
    return pd.concat([flat_day(d, **kw) for d in days]), days


def shock(df, day, at="11:00", minutes=5, pct=-2.5, vol=6000.0):
    """Move price linearly by `pct` over `minutes` bars starting at `at`, on heavy volume,
    then hold the new level for the rest of the day."""
    df = df.copy()
    start = pd.Timestamp(f"{day.date()} {at}", tz=NY)
    base = 100.0
    for i in range(minutes):
        ts = start + pd.Timedelta(minutes=i)
        p = base * (1 + pct / 100 * (i + 1) / minutes)
        df.loc[ts, ["open", "high", "low", "close", "volume"]] = [p, p + 0.05, p - 0.05, p, vol]
    after = (df.index > start + pd.Timedelta(minutes=minutes - 1)) & (df.index.normalize() == start.normalize())
    final = base * (1 + pct / 100)
    df.loc[after, ["open", "close"]] = final
    df.loc[after, "high"] = final + 0.1
    df.loc[after, "low"] = final - 0.1
    return df


def signals_on(df, wl, cfg, day):
    ind = compute_indicators(df.tz_convert("UTC"), wl, cfg, eval_dates=[day.tz_localize(None).normalize()])
    sig = evaluate_signals(ind, wl)
    return sig[sig["tdate"] == day.normalize()]


def test_bearish_fires_on_volume_breakdown(cfg):
    wl = wl_by(cfg, "stocks")
    df, days = history()
    last = days[-1]
    sig = signals_on(shock(df, last, pct=-2.5), wl, cfg, last)
    hits = sig[sig["bearish"]]
    assert not hits.empty
    first = hits.iloc[0]
    assert first.vol_ratio >= 2.5
    assert first.close < first.vwap and first.close < first.prev_low
    assert first.pct_from_high >= 1.5
    assert not sig["bullish"].any()
    assert hits.index[0].strftime("%H:%M") >= "11:00"


def test_bullish_fires_on_volume_breakout(cfg):
    wl = wl_by(cfg, "stocks")
    df, days = history()
    last = days[-1]
    sig = signals_on(shock(df, last, pct=+2.5), wl, cfg, last)
    assert sig["bullish"].any() and not sig["bearish"].any()


def test_no_signal_without_volume(cfg):
    wl = wl_by(cfg, "stocks")
    df, days = history()
    last = days[-1]
    sig = signals_on(shock(df, last, pct=-2.5, vol=1500.0), wl, cfg, last)  # only 1.5x
    assert not sig["bearish"].any()


def test_no_signal_when_move_too_small_for_stocks_but_enough_for_futures(cfg):
    stocks, futures = wl_by(cfg, "stocks"), wl_by(cfg, "futures")
    df, days = history()
    last = days[-1]
    moved = shock(df, last, pct=-0.9)
    assert not signals_on(moved, stocks, cfg, last)["bearish"].any()  # needs 1.5%

    # Same move on a futures-style 23h session clears the 0.5% futures threshold.
    fut_days = pd.bdate_range(end=last, periods=35)
    fut = pd.concat([flat_day(d - pd.Timedelta(days=1 if d.weekday() else 3), "18:00", "23:59")
                     for d in fut_days] + [flat_day(d, "00:00", "17:00") for d in fut_days]).sort_index()
    fut = shock(fut, last, pct=-0.9)
    assert signals_on(fut, futures, cfg, last)["bearish"].any()


def test_futures_evening_bars_belong_to_next_trading_day(cfg):
    wl = wl_by(cfg, "futures")
    idx = pd.DatetimeIndex(["2026-11-22 18:00", "2026-11-23 09:30", "2026-11-23 17:30",
                            "2026-11-23 18:05"]).tz_localize(NY)  # Sun eve, Mon, break, Mon eve
    df = pd.DataFrame({"open": 1, "high": 1, "low": 1, "close": 1, "volume": 1}, index=idx)
    tagged = assign_trading_dates(df, wl)
    assert list(tagged["tdate"].dt.strftime("%Y-%m-%d")) == ["2026-11-23", "2026-11-23", "2026-11-24"]


def test_cooldown_one_per_hour(tmp_path):
    cd = Cooldown(60, tmp_path / "s.json")
    t0 = datetime(2026, 11, 20, 15, tzinfo=timezone.utc)
    assert cd.allow("AAPL", t0)
    assert not cd.allow("AAPL", t0 + timedelta(minutes=59))
    assert cd.allow("MSFT", t0 + timedelta(minutes=1))
    assert Cooldown(60, tmp_path / "s.json").allow("AAPL", t0 + timedelta(minutes=30)) is False
    assert cd.allow("AAPL", t0 + timedelta(minutes=60))


def test_alert_message_contents():
    a = Alert(datetime.now(timezone.utc), "stocks", "NVDA", "BEARISH", 181.5, -1.82, 3.4)
    assert a.message == ("NVDA bearish signal: price 181.50, -1.82% from the day's high, "
                         "volume 3.4x normal")


def test_live_check_alerts_once_and_logs(cfg):
    wl = wl_by(cfg, "stocks")
    df, days = history()
    last = days[-1]
    df = shock(df, last, pct=-2.5).tz_convert("UTC")
    watcher = LiveWatcher(cfg)
    fired = []
    for ts in pd.date_range(f"{last.date()} 10:30", f"{last.date()} 12:30", freq="1min", tz=NY):
        now = (ts + pd.Timedelta(seconds=63)).tz_convert("UTC").to_pydatetime()
        bars = df[df.index + pd.Timedelta(minutes=1) <= now]
        alert = watcher.check_symbol(wl, "AAPL", bars, now)
        if alert:
            fired.append(alert)
    assert len(fired) == 1  # heavy volume persists for several bars, cooldown keeps it to one
    assert fired[0].direction == "BEARISH" and fired[0].ticker == "AAPL"
    log_lines = cfg.log_file.read_text().splitlines()
    assert len(log_lines) == 1 and "BEARISH\tAAPL" in log_lines[0]


def test_backtest_follow_through(cfg):
    wl = wl_by(cfg, "stocks")
    df, days = history(n_days=45)
    target = days[-4]
    df = shock(df, target, pct=-2.5)
    # Price keeps falling over the following three sessions.
    for k, d in enumerate(days[-3:], start=1):
        p = 97.5 - k
        m = df.index.normalize().tz_localize(None) == d
        df.loc[m, ["open", "close"]] = p
        df.loc[m, "high"], df.loc[m, "low"] = p + 0.1, p - 0.1
    rows = backtest_symbol(df.tz_convert("UTC"), wl, cfg, "AAPL",
                           test_start=days[-10].tz_localize(None), forward_days=[1, 2, 3])
    bear = [r for r in rows if r["direction"] == "BEARISH"]
    assert len(bear) == 1
    assert bear[0]["fwd1d_pct"] > 0 and bear[0]["fwd3d_pct"] > bear[0]["fwd1d_pct"]


def test_live_survives_empty_download(cfg, monkeypatch):
    from marketwatch import data
    monkeypatch.setattr(data, "fetch_yahoo", lambda tickers, *a, **k: {t: data._tidy(None) for t in tickers})
    watcher = LiveWatcher(cfg)
    assert watcher.check_watchlist(wl_by(cfg, "stocks"), datetime(2026, 11, 20, 16, tzinfo=timezone.utc)) == []


def test_repairs_yahoo_cumulative_volume_glitch():
    from marketwatch.data import repair_cumulative_volume
    idx = pd.date_range("2026-11-24 09:30", periods=120, freq="1min", tz=NY).as_unit("s")
    vol = pd.Series(50_000.0, index=idx)
    vol.iloc[0] = 2_000_000.0            # real opening auction: kept
    vol.iloc[60] = vol.iloc[:60].sum()    # bar stamped with the day's running total
    vol.iloc[90] = 600_000.0              # real 12x burst: kept
    fixed = repair_cumulative_volume(vol)
    assert fixed.iloc[0] == 2_000_000.0
    assert fixed.iloc[60] == 50_000.0
    assert fixed.iloc[90] == 600_000.0
