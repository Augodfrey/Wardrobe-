"""Market data: free Yahoo Finance bars via yfinance, or local CSV files.

Yahoo limits how far back intraday bars go (roughly 1m: 30 days, 5m: 60 days,
1h: 730 days) and how much one request may span (1m: 8 days). The helpers here
fetch in chunks inside those limits and return tidy frames:
columns open/high/low/close/volume, tz-aware DatetimeIndex (bar start), sorted.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# (max days back Yahoo serves, max days per request)
YAHOO_LIMITS = {
    "1m": (29, 7),
    "2m": (59, 59),
    "5m": (59, 59),
    "15m": (59, 59),
    "30m": (59, 59),
    "60m": (729, 729),
    "1h": (729, 729),
}

COLUMNS = ["open", "high", "low", "close", "volume"]


def interval_minutes(interval: str) -> int:
    if interval.endswith("m"):
        return int(interval[:-1])
    if interval.endswith("h"):
        return int(interval[:-1]) * 60
    raise ValueError(f"unsupported interval {interval!r}")


def _tidy(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=COLUMNS, dtype=float,
                            index=pd.DatetimeIndex([], tz="UTC"))
    df = df.rename(columns=str.lower)
    df = df[[c for c in COLUMNS if c in df.columns]].dropna(subset=["close"])
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    df = df[~df.index.duplicated(keep="last")].sort_index()
    df["volume"] = repair_cumulative_volume(df["volume"].fillna(0).astype(float))
    return df


def repair_cumulative_volume(vol: pd.Series, spike: float = 20.0, share: float = 0.5,
                             session_gap_minutes: int = 30) -> pd.Series:
    """Yahoo sometimes stamps a 1-minute bar with the whole day's running volume
    (e.g. NVDA showing 193M shares in one minute). Such a bar is both far above the
    recent typical bar and about as large as everything traded so far that session.
    Replace it with the recent median so it can't fake a volume spike or inflate the
    baseline. A genuine opening-auction bar is the session's first bar and is kept."""
    if vol.empty:
        return vol
    values = vol.to_numpy(copy=True)
    times = (vol.index.as_unit("ns").asi8 // 60_000_000_000
             if isinstance(vol.index, pd.DatetimeIndex) else None)
    gap = session_gap_minutes
    recent: list[float] = []
    session_sum = 0.0
    prev_t = None
    for i, v in enumerate(values):
        t = int(times[i]) if times is not None else i
        if prev_t is None or t - prev_t > gap:  # new session
            session_sum = 0.0
            first = True
        else:
            first = False
        prev_t = t
        if not first and len(recent) >= 10:
            med = float(np.median(recent[-30:]))
            if med > 0 and v > spike * med and v >= share * session_sum:
                values[i] = med
                v = med
        recent.append(v)
        if len(recent) > 60:
            del recent[:-30]
        session_sum += v
    return pd.Series(values, index=vol.index, name=vol.name)


def _split_download(raw: pd.DataFrame, tickers: list[str]) -> dict[str, pd.DataFrame]:
    """yf.download returns (ticker, field) or (field, ticker) MultiIndex columns,
    or flat columns for a single ticker, depending on version and arguments."""
    out: dict[str, pd.DataFrame] = {}
    if raw is None or raw.empty:
        return {t: _tidy(None) for t in tickers}
    if isinstance(raw.columns, pd.MultiIndex):
        for level in (0, 1):
            if set(tickers) & set(raw.columns.get_level_values(level)):
                for t in tickers:
                    try:
                        out[t] = _tidy(raw.xs(t, axis=1, level=level))
                    except KeyError:
                        out[t] = _tidy(None)
                return out
        raw = raw.droplevel(1, axis=1) if len(tickers) == 1 else raw
    if len(tickers) == 1:
        return {tickers[0]: _tidy(raw)}
    return {t: _tidy(None) for t in tickers}


def fetch_yahoo(tickers: list[str], interval: str, start: datetime | None = None,
                end: datetime | None = None, period: str | None = None) -> dict[str, pd.DataFrame]:
    import yfinance as yf  # imported lazily so tests/backtests from CSV don't need it

    kwargs = dict(interval=interval, group_by="ticker", auto_adjust=False,
                  prepost=False, progress=False, threads=True)
    if period:
        kwargs["period"] = period
    else:
        kwargs["start"], kwargs["end"] = start, end
    try:
        raw = yf.download(tickers, **kwargs)
    except Exception as exc:  # network errors, Yahoo hiccups
        log.warning("Yahoo download failed for %s: %s", tickers, exc)
        raw = None
    return _split_download(raw, tickers)


def fetch_history(tickers: list[str], interval: str, days: int) -> dict[str, pd.DataFrame]:
    """Fetch up to `days` calendar days of bars, chunked within Yahoo's limits."""
    max_back, chunk = YAHOO_LIMITS.get(interval, (729, 729))
    if days > max_back:
        log.warning("Yahoo only serves ~%d days of %s bars; requested %d. "
                    "Use a coarser --interval or --data-dir for older data.", max_back, interval, days)
        days = max_back
    end = datetime.now(timezone.utc)
    earliest = end - timedelta(days=days)
    frames: dict[str, list[pd.DataFrame]] = {t: [] for t in tickers}
    while end > earliest:
        start = max(earliest, end - timedelta(days=chunk))
        for t, df in fetch_yahoo(tickers, interval, start=start, end=end).items():
            if not df.empty:
                frames[t].append(df)
        end = start
    return {t: _tidy(pd.concat(f)) if f else _tidy(None) for t, f in frames.items()}


def load_csv_dir(directory: str | Path, tickers: list[str]) -> dict[str, pd.DataFrame]:
    """Load <directory>/<TICKER>.csv (e.g. MNQ=F.csv or MNQ.csv) with columns
    timestamp/datetime, open, high, low, close, volume. Naive timestamps are UTC."""
    directory = Path(directory)
    out = {}
    for t in tickers:
        candidates = [directory / f"{t}.csv", directory / f"{t.removesuffix('=F')}.csv"]
        path = next((p for p in candidates if p.exists()), None)
        if path is None:
            log.warning("no CSV for %s in %s", t, directory)
            out[t] = _tidy(None)
            continue
        df = pd.read_csv(path)
        df.columns = [c.lower() for c in df.columns]
        ts_col = next(c for c in ("timestamp", "datetime", "date", "time") if c in df.columns)
        df.index = pd.to_datetime(df.pop(ts_col), utc=False)
        out[t] = _tidy(df)
    return out
