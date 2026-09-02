from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request
from starlette.responses import PlainTextResponse

from app.core.config import Settings
from app.core.rate_limit import InMemoryRateLimitMiddleware
from app.core.security import (
    _decode_oidc_token,
    _roles_from_claims,
    client_ip,
    create_api_token,
    hash_api_token,
)
from app.services.storage import (
    LocalStorage,
    UnsafeUpload,
    normalize_extension,
    scan_for_malware,
    spool_upload,
    validate_magic,
)


def test_security_helpers_and_client_ip() -> None:
    settings = Settings(_env_file=None, token_hash_pepper="test-pepper")
    raw, prefix, digest = create_api_token(settings)
    assert raw.startswith(f"oidt_{prefix}_")
    assert digest == hash_api_token(raw, settings)
    assert _roles_from_claims({"realm_access": {"roles": ["publisher"]}}, "api") == {"publisher"}
    assert _roles_from_claims(
        {"resource_access": {"api": {"roles": ["moderator"]}}}, "api"
    ) == {"moderator"}
    with pytest.raises(HTTPException, match="OIDC is not configured"):
        _decode_oidc_token("not-a-token", Settings(_env_file=None))

    request = Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": Headers({"x-forwarded-for": "10.0.0.1, 10.0.0.2"}).raw,
        "query_string": b"",
        "client": ("127.0.0.1", 1234),
        "scheme": "http",
        "server": ("testserver", 80),
    })
    assert client_ip(request) == "10.0.0.2"


@pytest.mark.asyncio
async def test_local_storage_and_upload_safety(tmp_path: Path) -> None:
    storage = LocalStorage(tmp_path / "objects")
    source = tmp_path / "source.txt"
    source.write_bytes(b"hello")
    await storage.ensure_ready()
    await storage.put_path("a/source.txt", source, "text/plain")
    assert await storage.exists("a/source.txt")
    assert await storage.size("a/source.txt") == 5
    async with storage.materialize("a/source.txt") as materialized:
        assert materialized.read_bytes() == b"hello"
    await storage.promote("a/source.txt", "b/final.txt")
    assert not await storage.exists("a/source.txt")
    assert await storage.exists("b/final.txt")
    await storage.delete("b/final.txt")
    assert not await storage.exists("b/final.txt")
    with pytest.raises(ValueError):
        storage.path_for("../escape")
    with pytest.raises(ValueError):
        storage.path_for("/absolute")

    assert normalize_extension("readings.jsonl", {"ndjson"}) == "ndjson"
    with pytest.raises(UnsafeUpload):
        normalize_extension("readings.xls", {"csv"})
    validate_magic(b"observed_at,value\n", "csv")
    validate_magic(b"PAR1", "parquet")
    with pytest.raises(UnsafeUpload):
        validate_magic(b"not parquet", "parquet")
    with pytest.raises(UnsafeUpload):
        validate_magic(b"bad\x00text", "csv")

    upload = UploadFile(file=BytesIO(b"one,two\n1,2\n"), filename="ok.csv")
    path, size, checksum, sample = await spool_upload(upload, 100)
    assert size == len(sample) == path.stat().st_size
    assert len(checksum) == 64
    path.unlink(missing_ok=True)
    with pytest.raises(HTTPException) as empty:
        await spool_upload(UploadFile(file=BytesIO(b""), filename="empty.csv"), 100)
    assert empty.value.status_code == 422
    with pytest.raises(HTTPException) as too_large:
        await spool_upload(UploadFile(file=BytesIO(b"12345"), filename="large.csv"), 4)
    assert too_large.value.status_code == 413

    await scan_for_malware(source, Settings(_env_file=None, clamav_host=None))
    with pytest.raises(UnsafeUpload):
        await scan_for_malware(
            source,
            Settings(_env_file=None, clamav_host="127.0.0.1", clamav_port=9, clamav_required=True),
        )


@pytest.mark.asyncio
async def test_rate_limit_middleware_returns_headers_and_429() -> None:
    app = FastAPI()
    app.add_middleware(InMemoryRateLimitMiddleware, requests_per_minute=1)

    @app.get("/resource")
    async def resource() -> PlainTextResponse:
        return PlainTextResponse("ok")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        first = await client.get("/resource")
        second = await client.get("/resource")
    assert first.status_code == 200
    assert first.headers["x-ratelimit-remaining"] == "0"
    assert second.status_code == 429
    assert second.headers["retry-after"]
