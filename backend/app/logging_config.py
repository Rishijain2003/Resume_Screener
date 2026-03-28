"""Single place to attach a formatter to the `app` logger tree (works alongside uvicorn)."""

from __future__ import annotations

import logging
import os


def configure_app_logging(level_name: str | None = None) -> None:
    """Ensure loggers under `app.*` emit to stderr with a readable format."""
    level = getattr(logging, (level_name or os.environ.get("LOG_LEVEL") or "INFO").upper(), logging.INFO)
    fmt = "%(asctime)s | %(levelname)-5s | %(name)s | %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(fmt, datefmt=datefmt))
    handler.setLevel(level)

    root_app = logging.getLogger("app")
    root_app.setLevel(level)
    if not any(type(h) is logging.StreamHandler for h in root_app.handlers):
        root_app.addHandler(handler)
    root_app.propagate = False
