from __future__ import annotations

import os
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

TEST_ROOT = Path("/tmp") / f"openiotdata-pytest-{os.getpid()}"
TEST_DB = TEST_ROOT / "catalog.db"
TEST_STORAGE = TEST_ROOT / "objects"

os.environ.update(
    {
        "APP_ENV": "test",
        "DEV_AUTH_BYPASS": "true",
        "AUTO_CREATE_DB": "false",
        "DATABASE_URL": f"sqlite+aiosqlite:///{TEST_DB}",
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_PATH": str(TEST_STORAGE),
        "CELERY_TASK_ALWAYS_EAGER": "true",
        "RATE_LIMIT_PER_MINUTE": "0",
        "TOKEN_HASH_PEPPER": "pytest-secret-pepper",
        "CLAMAV_HOST": "",
    }
)

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.storage import get_storage, reset_storage  # noqa: E402


@pytest.fixture(autouse=True)
async def clean_database() -> AsyncIterator[None]:
    await engine.dispose()
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(TEST_STORAGE, ignore_errors=True)
    reset_storage()
    await get_storage().ensure_ready()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as test_client:
        yield test_client


@pytest.fixture
async def published_dataset(client: AsyncClient) -> dict[str, object]:
    created = await client.post(
        "/api/v1/datasets",
        headers={"X-Dev-User": "publisher-one"},
        json={
            "title": "Calidad del aire Bogotá",
            "description": "Mediciones ilustrativas de sensores abiertos.",
            "topic": "Aire",
            "tags": ["aire", "bogotá"],
            "license": "CC BY 4.0",
            "spatial_coverage": {"latitude": 4.711, "longitude": -74.0721},
            "temporal_coverage": {
                "starts_at": "2026-08-01T00:00:00Z",
                "ends_at": "2026-08-01T01:00:00Z",
                "frequency": "1 hora",
                "timezone_name": "UTC",
            },
        },
    )
    assert created.status_code == 201, created.text
    dataset = created.json()
    version_id = dataset["versions"][0]["id"]
    csv_data = (
        b"observed_at,sensor_id,pm25,latitude,longitude\n"
        b"2026-08-01T00:00:00Z,BOG-AIR-01,12.4,4.7110,-74.0721\n"
        b"2026-08-01T01:00:00Z,BOG-AIR-01,15.1,4.7120,-74.0710\n"
    )
    uploaded = await client.post(
        f"/api/v1/datasets/{dataset['id']}/versions/{version_id}/resources",
        headers={"X-Dev-User": "publisher-one"},
        files={"file": ("air.csv", csv_data, "text/csv")},
    )
    assert uploaded.status_code == 201, uploaded.text
    resource = uploaded.json()["resource"]
    job = uploaded.json()["job"]
    assert resource["status"] == "ready", uploaded.text
    assert resource["schema_profile"]["column_count"] == 5
    mapping = await client.put(
        f"/api/v1/datasets/{dataset['id']}/versions/{version_id}/mapping",
        headers={"X-Dev-User": "publisher-one"},
        json={
            "resource_id": resource["id"],
            "observed_at_field": "observed_at",
            "sensor_id_field": "sensor_id",
            "latitude_field": "latitude",
            "longitude_field": "longitude",
            "variable_units": {"pm25": "µg/m³"},
            "crs": "EPSG:4326",
        },
    )
    assert mapping.status_code == 204, mapping.text
    published = await client.post(
        f"/api/v1/datasets/{dataset['id']}/versions/{version_id}/publish",
        headers={"X-Dev-User": "publisher-one"},
    )
    assert published.status_code == 200, published.text
    return {
        "id": dataset["id"],
        "slug": dataset["slug"],
        "version_id": version_id,
        "resource_id": resource["id"],
        "job_id": job["id"],
        "csv_data": csv_data,
    }
