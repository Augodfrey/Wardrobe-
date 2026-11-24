"""Command line entry point.

    python -m marketwatch live                 # watch during market hours
    python -m marketwatch live --once          # single check, then exit
    python -m marketwatch backtest             # replay the last 3 months
    python -m marketwatch test-alert           # send a sample push notification

Signals only: this program has no broker connection and never places trades.
"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime

from .alerts import Alert, Notifier, log_alert
from .backtest import run_backtest
from .config import load_config
from .live import LiveWatcher


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="marketwatch", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-c", "--config", default="config.yaml")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    live = sub.add_parser("live", help="poll every minute and push alerts")
    live.add_argument("--once", action="store_true", help="run one check and exit")

    bt = sub.add_parser("backtest", help="replay history and report signal follow-through")
    bt.add_argument("--days", type=int, help="calendar days to replay (default from config: 90)")
    bt.add_argument("--interval", help="bar size: 1m, 5m, 15m, 1h (default from config: 5m)")
    bt.add_argument("--data-dir", help="read <SYMBOL>.csv bars from this folder instead of Yahoo")
    bt.add_argument("--output", help="CSV file for the alert list")

    sub.add_parser("test-alert", help="send a sample alert through the configured push service")

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")
    for noisy in ("yfinance", "urllib3", "peewee"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    cfg = load_config(args.config)
    if args.cmd == "live":
        LiveWatcher(cfg).run(once=args.once)
    elif args.cmd == "backtest":
        run_backtest(cfg, days=args.days, interval=args.interval,
                     data_dir=args.data_dir, output=args.output)
    elif args.cmd == "test-alert":
        alert = Alert(time=datetime.now().astimezone(), watchlist="test", ticker="TEST",
                      direction="BULLISH", price=123.45, pct_move=1.8, vol_ratio=3.2)
        ok = Notifier(cfg).send(alert)
        log_alert(alert, cfg.log_file)
        print("sent" if ok else "not sent -- see errors above", "|", alert.message)


if __name__ == "__main__":
    main()
