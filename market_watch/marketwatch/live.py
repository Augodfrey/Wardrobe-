"""Live mode: poll every minute during alert hours, evaluate the latest completed bar."""
from __future__ import annotations

import logging
import time as _time
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import data
from .alerts import Alert, Cooldown, Notifier, log_alert
from .config import Config, Watchlist
from .signals import assign_trading_dates, compute_indicators, evaluate_signals, in_alert_hours

log = logging.getLogger(__name__)

# Yahoo futures quotes can lag ~10 minutes; skip bars older than this.
MAX_BAR_AGE = timedelta(minutes=20)


def _now_in_alert_hours(now_utc: datetime, wl: Watchlist) -> bool:
    ts = pd.Timestamp(now_utc).tz_convert(wl.timezone)
    probe = pd.DataFrame(index=pd.DatetimeIndex([ts]))
    tdate = ts.normalize().tz_localize(None)
    if wl.overnight and ts.time() >= wl.session_start:
        tdate += pd.Timedelta(days=1)
    probe["tdate"] = tdate
    return bool(in_alert_hours(probe, wl)[0])


class LiveWatcher:
    def __init__(self, cfg: Config, notifier: Notifier | None = None):
        self.cfg = cfg
        self.notifier = notifier or Notifier(cfg)
        self.cooldown = Cooldown(cfg.cooldown_minutes, cfg.state_file)
        self.history: dict[str, pd.DataFrame] = {}
        self.history_day: dict[str, str] = {}
        self.last_bar: dict[str, pd.Timestamp] = {}

    # -- data ---------------------------------------------------------------
    def _refresh_history(self, wl: Watchlist, now_utc: datetime) -> None:
        today = pd.Timestamp(now_utc).tz_convert(wl.timezone).strftime("%Y-%m-%d")
        if self.history_day.get(wl.name) == today:
            return
        log.info("[%s] loading %d days of 1m history for the volume baseline", wl.name,
                 self.cfg.baseline_days)
        # Yahoo serves ~29 days of 1m bars, i.e. ~20 sessions for a 30-day baseline.
        hist = data.fetch_history(wl.symbols, "1m",
                                  min(self.cfg.baseline_days + 2, data.YAHOO_LIMITS["1m"][0]))
        for t, df in hist.items():
            if df.empty:
                log.warning("[%s] no history for %s", wl.name, t)
            self.history[t] = df
        self.history_day[wl.name] = today

    def _bars(self, wl: Watchlist, now_utc: datetime) -> dict[str, pd.DataFrame]:
        recent = data.fetch_yahoo(wl.symbols, "1m", period="5d")
        cutoff = pd.Timestamp(now_utc) - pd.Timedelta(days=self.cfg.baseline_days + 5)
        out = {}
        for t in wl.symbols:
            df = pd.concat([self.history.get(t, data._tidy(None)), recent.get(t, data._tidy(None))])
            df = df[~df.index.duplicated(keep="last")].sort_index()
            df = df[df.index >= cutoff]
            self.history[t] = df  # keep the cache growing through the day
            # Drop the bar still forming: it starts less than a minute ago.
            done = df[df.index + pd.Timedelta(minutes=1) <= pd.Timestamp(now_utc)]
            # Yahoo reports the bar it is still filling with volume 0; drop it too.
            if len(done) and done["volume"].iloc[-1] == 0:
                done = done.iloc[:-1]
            out[t] = done
        return out

    # -- evaluation ---------------------------------------------------------
    def check_watchlist(self, wl: Watchlist, now_utc: datetime) -> list[Alert]:
        self._refresh_history(wl, now_utc)
        alerts = []
        for ticker, bars in self._bars(wl, now_utc).items():
            if bars.empty:
                continue
            alert = self.check_symbol(wl, ticker, bars, now_utc)
            if alert:
                alerts.append(alert)
        return alerts

    def check_symbol(self, wl: Watchlist, ticker: str, bars: pd.DataFrame,
                     now_utc: datetime) -> Alert | None:
        last_ts = bars.index[-1]
        if self.last_bar.get(ticker) == last_ts:
            return None  # no new completed bar since the last check
        if pd.Timestamp(now_utc) - (last_ts + pd.Timedelta(minutes=1)) > MAX_BAR_AGE:
            log.debug("%s: latest bar %s is stale", ticker, last_ts)
            return None
        self.last_bar[ticker] = last_ts

        tagged = assign_trading_dates(bars.iloc[[-1]], wl)
        if tagged.empty:
            return None  # latest bar is outside the session
        # Only the current trading date needs a volume baseline.
        ind = compute_indicators(bars, wl, self.cfg, eval_dates=[tagged["tdate"].iloc[0]])
        row_df = evaluate_signals(ind.iloc[[-1]], wl)
        if not in_alert_hours(row_df, wl)[0]:
            return None
        row = row_df.iloc[0]
        label = wl.labels.get(ticker, ticker)
        log.debug("%s close=%.2f vwap=%.2f ratio=%.2f hi=%.2f lo=%.2f", label, row.close,
                  row.vwap, row.vol_ratio, row.day_high, row.day_low)
        if row.bearish:
            direction, move = "BEARISH", -row.pct_from_high
        elif row.bullish:
            direction, move = "BULLISH", row.pct_from_low
        else:
            return None
        if not self.cooldown.allow(ticker, row_df.index[0].to_pydatetime()):
            log.info("%s %s suppressed (cooldown)", direction, label)
            return None
        alert = Alert(time=row_df.index[0].to_pydatetime(), watchlist=wl.name, ticker=label,
                      direction=direction, price=float(row.close), pct_move=float(move),
                      vol_ratio=float(row.vol_ratio))
        self.emit(alert)
        return alert

    def emit(self, alert: Alert) -> None:
        log.warning("ALERT %s", alert.message)
        log_alert(alert, self.cfg.log_file)
        self.notifier.send(alert)

    # -- loop ---------------------------------------------------------------
    def run(self, once: bool = False) -> None:
        log.info("market watch started (signals only -- this tool never places trades)")
        while True:
            started = _time.monotonic()
            now = datetime.now(timezone.utc)
            for wl in self.cfg.watchlists:
                if not _now_in_alert_hours(now, wl):
                    log.debug("[%s] outside alert hours", wl.name)
                    continue
                try:
                    self.check_watchlist(wl, now)
                except Exception:  # keep watching even if one cycle fails
                    log.exception("[%s] check failed", wl.name)
            if once:
                return
            # Align to a few seconds past each minute so the prior bar is complete.
            elapsed = _time.monotonic() - started
            wait = max(5.0, self.cfg.poll_seconds - elapsed)
            if self.cfg.poll_seconds == 60:
                wait = max(5.0, 60 - datetime.now().second + 3)
            _time.sleep(wait)
