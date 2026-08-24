from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select

from app.db.models import Dataset, DatasetStatus, DatasetVersion, TemporalCoverage, VersionStatus
from app.db.session import SessionLocal


async def test_publish_discover_query_map_points_and_download(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    slug = published_dataset["slug"]
    catalog = await client.get("/api/v1/datasets", params={"topic": "aire"})
    assert catalog.status_code == 200
    assert [item["slug"] for item in catalog.json()["items"]] == [slug]
    assert catalog.json()["items"][0]["formats"] == ["csv"]
    assert catalog.json()["items"][0]["row_count"] == 2
    assert catalog.json()["items"][0]["byte_size"] == len(published_dataset["csv_data"])
    assert catalog.json()["items"][0]["variables"] == ["pm25"]
    assert catalog.json()["items"][0]["temporal_coverage"]["frequency"] == "1 hora"

    detail = await client.get(f"/api/v1/datasets/{slug}")
    assert detail.status_code == 200
    assert detail.json()["versions"][0]["status"] == "published"
    semantic = detail.json()["versions"][0]["semantic_mappings"][0]
    assert semantic["observed_at_field"] == "observed_at"
    assert semantic["variable_units"] == {"pm25": "µg/m³"}

    preview = await client.get(f"/api/v1/datasets/{slug}/preview", params={"limit": 1})
    assert preview.status_code == 200, preview.text
    assert preview.json()["returned"] == 1

    query = await client.post(
        f"/api/v1/datasets/{slug}/query",
        json={
            "resource_id": published_dataset["resource_id"],
            "columns": ["sensor_id", "pm25"],
            "filters": [{"field": "pm25", "operator": "gte", "value": 13}],
            "order_by": "pm25",
            "descending": True,
            "limit": 10,
        },
    )
    assert query.status_code == 200, query.text
    assert query.json()["rows"] == [{"sensor_id": "BOG-AIR-01", "pm25": 15.1}]

    rejected_sql = await client.post(
        f"/api/v1/datasets/{slug}/query",
        json={"columns": ["pm25; DROP TABLE datasets"], "limit": 10},
    )
    assert rejected_sql.status_code == 422

    mapped = await client.get("/api/v1/map/datasets", params={"bbox": "-75,4,-73,5"})
    assert mapped.status_code == 200
    assert mapped.json()["features"][0]["properties"]["slug"] == slug

    points = await client.get(f"/api/v1/datasets/{slug}/points", params={"bbox": "-75,4,-73,5"})
    assert points.status_code == 200, points.text
    assert len(points.json()["features"]) == 2

    downloaded = await client.get(
        f"/api/v1/datasets/{slug}/resources/{published_dataset['resource_id']}/download"
    )
    assert downloaded.status_code == 200
    assert downloaded.content == published_dataset["csv_data"]


async def test_catalog_filters_use_published_schema_location_and_declared_period(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    variable = await client.get("/api/v1/datasets", params={"variable": "pm25"})
    assert [item["slug"] for item in variable.json()["items"]] == [published_dataset["slug"]]
    missing_variable = await client.get("/api/v1/datasets", params={"variable": "temperature"})
    assert missing_variable.json()["items"] == []

    location = await client.get("/api/v1/datasets", params={"location": "Bogotá"})
    assert [item["slug"] for item in location.json()["items"]] == [published_dataset["slug"]]
    missing_location = await client.get("/api/v1/datasets", params={"location": "Medellín"})
    assert missing_location.json()["items"] == []

    async with SessionLocal() as session:
        coverage = await session.scalar(select(TemporalCoverage))
        assert coverage is not None
        coverage.starts_at = datetime.now(UTC) - timedelta(days=30)
        coverage.ends_at = datetime.now(UTC)
        await session.commit()

    recent = await client.get("/api/v1/datasets", params={"period": "12m"})
    assert [item["slug"] for item in recent.json()["items"]] == [published_dataset["slug"]]

    async with SessionLocal() as session:
        coverage = await session.scalar(select(TemporalCoverage))
        assert coverage is not None
        coverage.starts_at = datetime.now(UTC) - timedelta(days=4 * 365)
        coverage.ends_at = None
        await session.commit()

    # An omitted end means an open/ongoing series, so it remains recent.
    open_series = await client.get("/api/v1/datasets", params={"period": "12m"})
    assert [item["slug"] for item in open_series.json()["items"]] == [published_dataset["slug"]]
    historic = await client.get("/api/v1/datasets", params={"period": "historic"})
    assert [item["slug"] for item in historic.json()["items"]] == [published_dataset["slug"]]


async def test_catalog_cursor_paginates_every_supported_sort(client: AsyncClient) -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as session:
        for index, (title, downloads) in enumerate(
            (("Zeta sensors", 4), ("Alpha sensors", 30), ("Beta sensors", 12))
        ):
            dataset = Dataset(
                owner_subject="cursor-test",
                title=title,
                slug=f"cursor-{index}",
                description="Cursor fixture",
                topic="Test",
                tags=[],
                license="CC0 1.0",
                visibility="public",
                status=DatasetStatus.PUBLISHED,
                published_at=now - timedelta(days=index),
                downloads=downloads,
            )
            dataset.versions.append(
                DatasetVersion(
                    number=1,
                    status=VersionStatus.PUBLISHED,
                    is_current=True,
                    published_at=dataset.published_at,
                )
            )
            session.add(dataset)
        await session.commit()

    async def collect(sort: str) -> tuple[list[str], str]:
        titles: list[str] = []
        cursor: str | None = None
        first_cursor = ""
        while True:
            params = {"sort": sort, "limit": 1}
            if cursor:
                params["cursor"] = cursor
            response = await client.get("/api/v1/datasets", params=params)
            assert response.status_code == 200, response.text
            payload = response.json()
            titles.extend(item["title"] for item in payload["items"])
            cursor = payload["next_cursor"]
            first_cursor = first_cursor or cursor or ""
            if cursor is None:
                return titles, first_cursor

    recent, recent_cursor = await collect("recent")
    downloads, _ = await collect("downloads")
    titles, _ = await collect("title")
    assert recent == ["Zeta sensors", "Alpha sensors", "Beta sensors"]
    assert downloads == ["Alpha sensors", "Beta sensors", "Zeta sensors"]
    assert titles == ["Alpha sensors", "Beta sensors", "Zeta sensors"]

    wrong_sort = await client.get(
        "/api/v1/datasets", params={"sort": "title", "cursor": recent_cursor}
    )
    assert wrong_sort.status_code == 422


async def test_public_report_is_visible_to_moderator(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    report = await client.post(
        f"/api/v1/datasets/{published_dataset['slug']}/reports",
        json={"reason": "Metadatos incompletos", "details": "Revisar procedencia."},
    )
    assert report.status_code == 201
    queue = await client.get("/api/v1/admin/reports", headers={"X-Dev-User": "moderator"})
    assert queue.status_code == 200
    assert queue.json()[0]["dataset_id"] == published_dataset["id"]
    closed = await client.patch(
        f"/api/v1/admin/reports/{report.json()['id']}",
        headers={"X-Dev-User": "moderator"},
        json={"status": "resolved"},
    )
    assert closed.status_code == 200
    assert closed.json()["status"] == "resolved"


async def test_published_catalog_metadata_cannot_be_changed_retroactively(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    response = await client.patch(
        f"/api/v1/datasets/{published_dataset['id']}",
        headers={"X-Dev-User": "publisher-one"},
        json={"title": "A replacement title", "license": "CC0-1.0"},
    )
    assert response.status_code == 409

    unchanged = await client.get(f"/api/v1/datasets/{published_dataset['slug']}")
    assert unchanged.status_code == 200
    assert unchanged.json()["title"] == "Calidad del aire Bogotá"
    assert unchanged.json()["license"] == "CC BY 4.0"
