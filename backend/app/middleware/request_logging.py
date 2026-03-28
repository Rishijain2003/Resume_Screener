"""Log each HTTP request: method, path, status, duration. Skips noisy health/docs paths at INFO."""

from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("app.http")

_SKIP_PATHS = frozenset({"/health", "/docs", "/redoc", "/openapi.json"})


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        method = request.method
        quiet = method == "GET" and path in _SKIP_PATHS
        if not quiet:
            logger.info("→ %s %s", method, path)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("FAIL %s %s (exception before response)", method, path)
            raise
        elapsed_ms = (time.perf_counter() - start) * 1000
        if not quiet:
            logger.info(
                "← %s %s -> %s (%.1f ms)",
                method,
                path,
                getattr(response, "status_code", "?"),
                elapsed_ms,
            )
        return response
