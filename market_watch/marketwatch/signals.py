"""Indicator and signal logic, shared by live mode and backtest mode.

Input is a DataFrame of OHLCV bars (columns: open, high, low, close, volume) with a
tz-aware DatetimeIndex marking each bar's *start*. The same function computes every
indicator for every bar, so a backtest replays exactly what live mode would have seen
at each point in time: nothing here looks at bars after the one being evaluated.
"""
from __future__ import annotations


import numpy as np
import pandas as pd

from .config import Config, Watchlist


def assign_trading_dates(df: pd.DataFrame, wl: Watchlist) -> pd.DataFrame:
    """Convert to the session timezone, drop bars outside the session and tag each
    bar with the trading date it belongs to (futures: 18:00 belongs to the next day)."""
    df = df.copy()
    df.index = df.index.tz_convert(wl.timezone)
    t = df.index.time
    if wl.overnight:
        in_session = (t >= wl.session_start) | (t < wl.session_end)
        next_day = t >= wl.session_start
    else:
        in_session = (t >= wl.session_start) & (t < wl.session_end)
        next_day = np.zeros(len(df), dtype=bool)
    df = df[in_session]
    next_day = next_day[in_session]
    dates = df.index.normalize().tz_localize(None)
    dates = dates + pd.to_timedelta(next_day.astype(int), unit="D")
    # A Friday-evening bar rolling to Saturday would only happen with bad data; push
    # weekend dates to Monday so the futures Sunday-evening open joins Monday's session.
    weekday = dates.weekday
    dates = dates + pd.to_timedelta(np.where(weekday == 5, 2, np.where(weekday == 6, 1, 0)), unit="D")
    df["tdate"] = dates
    df["slot"] = df.index.strftime("%H:%M")
    return df


def _same_slot_baseline(df: pd.DataFrame, cfg: Config, eval_dates) -> pd.Series:
    """Average rolling-window volume at the same clock time over the prior
    `baseline_days` calendar days (sessions before the one being evaluated)."""
    pivot = df.pivot_table(index="tdate", columns="slot", values="vol_window", aggfunc="last")
    all_dates = pivot.index
    pieces = []
    for d in eval_dates:
        window = pivot[(all_dates < d) & (all_dates >= d - pd.Timedelta(days=cfg.baseline_days))]
        if len(window) < cfg.min_baseline_days:
            continue
        mean = window.mean(skipna=True)
        count = window.notna().sum()
        mean[count < cfg.min_baseline_days] = np.nan
        pieces.append(pd.DataFrame({"tdate": d, "slot": mean.index, "baseline": mean.values}))
    if not pieces:
        return pd.Series(np.nan, index=df.index)
    base = pd.concat(pieces, ignore_index=True)
    merged = df[["tdate", "slot"]].reset_index().merge(base, on=["tdate", "slot"], how="left")
    return pd.Series(merged["baseline"].values, index=df.index)


def compute_indicators(bars: pd.DataFrame, wl: Watchlist, cfg: Config,
                       eval_dates=None) -> pd.DataFrame:
    """Return bars with indicator columns. `eval_dates` limits the (relatively costly)
    baseline computation to those trading dates; None means every date."""
    df = assign_trading_dates(bars, wl)
    if df.empty:
        return df
    g = df.groupby("tdate", sort=True)

    df["day_high"] = g["high"].cummax()
    df["day_low"] = g["low"].cummin()

    typical = (df["high"] + df["low"] + df["close"]) / 3
    df["_pv"] = typical * df["volume"]
    cum_pv = df.groupby("tdate")["_pv"].cumsum()
    cum_v = g["volume"].cumsum()
    df["vwap"] = (cum_pv / cum_v.replace(0, np.nan))
    df.drop(columns="_pv", inplace=True)

    daily = g.agg(dh=("high", "max"), dl=("low", "min"))
    prev = daily.shift(1)
    df["prev_high"] = df["tdate"].map(prev["dh"])
    df["prev_low"] = df["tdate"].map(prev["dl"])

    lookback = f"{cfg.breakout_lookback_minutes}min"
    window = f"{cfg.volume_window_minutes}min"
    hour_high, hour_low, vol_window = [], [], []
    for _, day in g:
        hour_high.append(day["high"].rolling(lookback, closed="left").max())
        hour_low.append(day["low"].rolling(lookback, closed="left").min())
        vol_window.append(day["volume"].rolling(window).sum())
    df["hour_high"] = pd.concat(hour_high)
    df["hour_low"] = pd.concat(hour_low)
    df["vol_window"] = pd.concat(vol_window)

    if eval_dates is None:
        eval_dates = df["tdate"].unique()
    df["baseline_vol"] = _same_slot_baseline(df, cfg, eval_dates)
    df["vol_ratio"] = df["vol_window"] / df["baseline_vol"].replace(0, np.nan)
    return df


def evaluate_signals(df: pd.DataFrame, wl: Watchlist) -> pd.DataFrame:
    """Add boolean `bullish` / `bearish` columns plus the % move used in alerts."""
    thr = wl.thresholds
    price = df["close"]
    big_volume = df["vol_ratio"] >= thr.volume_ratio

    down_from_high = (df["day_high"] - price) / df["day_high"] * 100
    up_from_low = (price - df["day_low"]) / df["day_low"] * 100

    bearish = (
        big_volume
        & (down_from_high >= thr.move_pct)
        & (price < df["vwap"])
        & ((price < df["prev_low"]) | (price < df["hour_low"]))
    )
    bullish = (
        big_volume
        & (up_from_low >= thr.move_pct)
        & (price > df["vwap"])
        & ((price > df["prev_high"]) | (price > df["hour_high"]))
    )
    df = df.copy()
    df["bearish"] = bearish.fillna(False).astype(bool)
    df["bullish"] = bullish.fillna(False).astype(bool)
    df["pct_from_high"] = down_from_high
    df["pct_from_low"] = up_from_low
    return df


def in_alert_hours(df: pd.DataFrame, wl: Watchlist) -> np.ndarray:
    """Bars (on weekday trading dates) whose clock time is within the alert hours."""
    t = df.index.time
    if wl.alert_start <= wl.alert_end:
        ok = (t >= wl.alert_start) & (t <= wl.alert_end)
    else:
        ok = (t >= wl.alert_start) | (t <= wl.alert_end)
    return ok & (pd.DatetimeIndex(df["tdate"]).weekday < 5)
