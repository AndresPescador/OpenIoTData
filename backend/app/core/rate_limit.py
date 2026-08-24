from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response


class InMemoryRateLimitMiddleware(BaseHTTPMiddleware):
    """A single-process safety limit; production can replace it with a Redis gateway limit."""

    def __init__(self, app: object, requests_per_minute: int) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.limit = requests_per_minute
        self.events: dict[str, deque[float]] = defaultdict(deque)
        self.lock = asyncio.Lock()

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if self.limit <= 0 or request.url.path in {"/health", "/api/v1/health"}:
            return await call_next(request)
        client = request.headers.get("X-Forwarded-For", "").rsplit(",", 1)[-1].strip()
        if not client:
            client = request.client.host if request.client else "unknown"
        key = f"{client}:{request.url.path}"
        now = time.monotonic()
        async with self.lock:
            bucket = self.events[key]
            while bucket and bucket[0] <= now - 60:
                bucket.popleft()
            if len(bucket) >= self.limit:
                retry_after = max(1, int(60 - (now - bucket[0])))
                return JSONResponse(
                    {"detail": "Rate limit exceeded"},
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
            bucket.append(now)
            remaining = max(0, self.limit - len(bucket))
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
