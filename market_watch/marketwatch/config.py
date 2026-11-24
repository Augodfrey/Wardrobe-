"""Load and validate config.yaml."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from pathlib import Path
from typing import Any

import yaml


def _parse_time(value: str) -> time:
    hh, mm = str(value).split(":")
    return time(int(hh), int(mm))


@dataclass
class Thresholds:
    volume_ratio: float
    move_pct: float


@dataclass
class Watchlist:
    name: str
    symbols: list[str]            # data-source tickers, e.g. "MNQ=F"
    labels: dict[str, str]        # data-source ticker -> name shown in alerts, e.g. "MNQ"
    timezone: str
    session_start: time
    session_end: time
    alert_start: time
    alert_end: time
    thresholds: Thresholds

    @property
    def overnight(self) -> bool:
        """True when the trading day starts the previous evening (futures)."""
        return self.session_start > self.session_end


@dataclass
class Config:
    poll_seconds: int
    volume_window_minutes: int
    baseline_days: int
    min_baseline_days: int
    breakout_lookback_minutes: int
    cooldown_minutes: int
    log_file: Path
    state_file: Path
    notifier: str
    ntfy: dict[str, Any]
    pushover: dict[str, Any]
    watchlists: list[Watchlist]
    backtest: dict[str, Any] = field(default_factory=dict)


def _normalize_symbol(list_name: str, symbol: str) -> str:
    symbol = symbol.strip().upper()
    if list_name.lower().startswith("future") and not symbol.endswith("=F"):
        return symbol + "=F"
    return symbol


def load_config(path: str | Path) -> Config:
    path = Path(path)
    raw = yaml.safe_load(path.read_text())
    base = path.parent

    g = raw.get("general", {})
    a = raw.get("alerts", {})

    watchlists = []
    for name, wl in (raw.get("watchlists") or {}).items():
        session = wl.get("session", {})
        hours = wl.get("alert_hours", session)
        thr = wl.get("thresholds", {})
        symbols, labels = [], {}
        for s in wl.get("symbols", []):
            ticker = _normalize_symbol(name, s)
            symbols.append(ticker)
            labels[ticker] = s.strip().upper().removesuffix("=F")
        watchlists.append(
            Watchlist(
                name=name,
                symbols=symbols,
                labels=labels,
                timezone=session.get("timezone", "America/New_York"),
                session_start=_parse_time(session.get("start", "09:30")),
                session_end=_parse_time(session.get("end", "16:00")),
                alert_start=_parse_time(hours.get("start", "09:30")),
                alert_end=_parse_time(hours.get("end", "16:00")),
                thresholds=Thresholds(
                    volume_ratio=float(thr.get("volume_ratio", 2.5)),
                    move_pct=float(thr.get("move_pct", 1.5)),
                ),
            )
        )
    if not watchlists:
        raise ValueError(f"{path}: no watchlists configured")

    return Config(
        poll_seconds=int(g.get("poll_seconds", 60)),
        volume_window_minutes=int(g.get("volume_window_minutes", 5)),
        baseline_days=int(g.get("baseline_days", 30)),
        min_baseline_days=int(g.get("min_baseline_days", 5)),
        breakout_lookback_minutes=int(g.get("breakout_lookback_minutes", 60)),
        cooldown_minutes=int(a.get("cooldown_minutes", 60)),
        log_file=base / a.get("log_file", "alerts.log"),
        state_file=base / a.get("state_file", ".alert_state.json"),
        notifier=str(a.get("notifier", "none")).lower(),
        ntfy=a.get("ntfy", {}) or {},
        pushover=a.get("pushover", {}) or {},
        watchlists=watchlists,
        backtest=raw.get("backtest", {}) or {},
    )
