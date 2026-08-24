from __future__ import annotations

from typing import Any

from starlette.responses import JSONResponse


class RequestBodyLimitMiddleware:
    """Reject oversized JSON bodies before FastAPI/Pydantic parses them."""

    def __init__(self, app: Any, batch_max_bytes: int, query_max_bytes: int) -> None:
        self.app = app
        self.batch_max_bytes = batch_max_bytes
        self.query_max_bytes = query_max_bytes

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        path = str(scope.get("path", ""))
        if scope.get("type") != "http" or not (
            path.endswith("/records:batch") or path.endswith("/query")
        ):
            await self.app(scope, receive, send)
            return
        max_bytes = (
            self.batch_max_bytes if path.endswith("/records:batch") else self.query_max_bytes
        )
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        raw_length = headers.get(b"content-length")
        if raw_length:
            try:
                if int(raw_length) > max_bytes:
                    await JSONResponse(
                        {"detail": "Batch exceeds the configured byte limit"}, status_code=413
                    )(scope, receive, send)
                    return
            except ValueError:
                await JSONResponse({"detail": "Invalid Content-Length header"}, status_code=400)(
                    scope, receive, send
                )
                return
        chunks: list[bytes] = []
        total = 0
        more_body = True
        while more_body:
            message = await receive()
            if message.get("type") == "http.disconnect":
                return
            chunk = message.get("body", b"")
            total += len(chunk)
            if total > max_bytes:
                await JSONResponse(
                    {"detail": "Batch exceeds the configured byte limit"}, status_code=413
                )(scope, receive, send)
                return
            chunks.append(chunk)
            more_body = bool(message.get("more_body", False))
        body = b"".join(chunks)
        delivered = False

        async def replay() -> dict[str, Any]:
            nonlocal delivered
            if delivered:
                return {"type": "http.request", "body": b"", "more_body": False}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)
