"""Alert formatting, per-symbol cooldown, alert log, and push delivery (ntfy / Pushover)."""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import requests

from .config import Config

log = logging.getLogger(__name__)


@dataclass
class Alert:
    time: datetime          # bar time the signal fired on (tz-aware)
    watchlist: str
    ticker: str             # display name, e.g. "MNQ"
    direction: str          # "BULLISH" | "BEARISH"
    price: float
    pct_move: float         # % from the day's high (bearish, negative) or low (bullish, positive)
    vol_ratio: float

    @property
    def title(self) -> str:
        return f"{self.direction} {self.ticker}"

    @property
    def message(self) -> str:
        ref = "day's high" if self.direction == "BEARISH" else "day's low"
        return (f"{self.ticker} {self.direction.lower()} signal: price {self.price:,.2f}, "
                f"{self.pct_move:+.2f}% from the {ref}, volume {self.vol_ratio:.1f}x normal")


class Cooldown:
    """At most one alert per symbol per `minutes`, persisted so restarts don't re-alert."""

    def __init__(self, minutes: int, state_file: Path | None = None):
        self.window = timedelta(minutes=minutes)
        self.state_file = state_file
        self.last: dict[str, datetime] = {}
        if state_file and state_file.exists():
            try:
                self.last = {k: datetime.fromisoformat(v)
                             for k, v in json.loads(state_file.read_text()).items()}
            except (ValueError, OSError) as exc:
                log.warning("ignoring unreadable state file %s: %s", state_file, exc)

    def allow(self, key: str, when: datetime) -> bool:
        prev = self.last.get(key)
        if prev is not None and when - prev < self.window:
            return False
        self.last[key] = when
        if self.state_file:
            self.state_file.write_text(json.dumps({k: v.isoformat() for k, v in self.last.items()}))
        return True


def log_alert(alert: Alert, log_file: Path) -> None:
    sent_at = datetime.now().astimezone().isoformat(timespec="seconds")
    line = (f"{sent_at}\tbar={alert.time.isoformat()}\t{alert.watchlist}\t{alert.direction}\t"
            f"{alert.ticker}\tprice={alert.price:.4f}\tmove={alert.pct_move:+.2f}%\t"
            f"vol_ratio={alert.vol_ratio:.2f}\n")
    with open(log_file, "a") as fh:
        fh.write(line)


class Notifier:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.kind = cfg.notifier

    def send(self, alert: Alert) -> bool:
        try:
            if self.kind == "ntfy":
                return self._ntfy(alert)
            if self.kind == "pushover":
                return self._pushover(alert)
            return True  # "none": console + log only
        except requests.RequestException as exc:
            log.error("push delivery failed for %s: %s", alert.title, exc)
            return False

    def _ntfy(self, alert: Alert) -> bool:
        server = self.cfg.ntfy.get("server", "https://ntfy.sh").rstrip("/")
        topic = os.environ.get("NTFY_TOPIC") or self.cfg.ntfy.get("topic")
        if not topic or topic.startswith("change-me"):
            log.error("set alerts.ntfy.topic in config.yaml (or NTFY_TOPIC) to receive pushes")
            return False
        headers = {
            "Title": alert.title,
            "Tags": "chart_with_upwards_trend" if alert.direction == "BULLISH" else "chart_with_downwards_trend",
            "Priority": "high",
        }
        token = os.environ.get("NTFY_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        r = requests.post(f"{server}/{topic}", data=alert.message.encode(), headers=headers, timeout=10)
        r.raise_for_status()
        return True

    def _pushover(self, alert: Alert) -> bool:
        user = os.environ.get(self.cfg.pushover.get("user_key_env", "PUSHOVER_USER_KEY"))
        token = os.environ.get(self.cfg.pushover.get("app_token_env", "PUSHOVER_APP_TOKEN"))
        if not user or not token:
            log.error("Pushover selected but user key / app token env vars are not set")
            return False
        r = requests.post("https://api.pushover.net/1/messages.json", timeout=10,
                          data={"token": token, "user": user, "title": alert.title,
                                "message": alert.message})
        r.raise_for_status()
        return True
