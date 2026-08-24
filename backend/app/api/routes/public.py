from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import current_version, dataset_graph_options, load_dataset_full
from app.core.config import Settings, get_settings
from app.core.security import client_ip, get_optional_user
from app.db.models import (
    Dataset,
    DatasetStatus,
    DatasetVersion,
    Report,
    Resource,
    ResourceField,
    ResourceStatus,
    SchemaProfile,
    SpatialCoverage,
    TemporalCoverage,
    VersionStatus,
)
from app.db.session import get_session
from app.schemas import (
    CurrentUser,
    DataQuery,
    DatasetDetail,
    DatasetPage,
    QueryResult,
    ReportCreate,
    ReportCreated,
    VersionRead,
)
from app.services.catalog import audit, dataset_detail, dataset_summary, version_read
from app.services.query import execute_points, execute_query
from app.services.storage import get_storage

router = APIRouter(prefix="/api/v1", tags=["public catalog"])


CatalogSort = Literal["recent", "downloads", "title"]


def _encode_cursor(dataset: Dataset, sort: CatalogSort) -> str:
    if sort == "downloads":
        value: str | int = dataset.downloads
    elif sort == "title":
        value = dataset.title
    else:
        assert dataset.published_at is not None
        value = dataset.published_at.isoformat()
    serialized = json.dumps(
        {"version": 1, "sort": sort, "value": value, "id": dataset.id},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(serialized).decode().rstrip("=")


def _decode_cursor(cursor: str, expected_sort: CatalogSort) -> tuple[datetime | str | int, str]:
    """Decode a cursor and bind it to the ordering that created it.

    Cursors are opaque to clients. Keeping the sort in the typed payload prevents a
    cursor generated for one ordering from silently skipping rows in another ordering.
    """

    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if (
            not isinstance(payload, dict)
            or payload.get("version") != 1
            or payload.get("sort") != expected_sort
            or not isinstance(payload.get("id"), str)
            or len(payload["id"]) > 64
        ):
            raise ValueError
        value = payload.get("value")
        if expected_sort == "recent":
            if not isinstance(value, str):
                raise ValueError
            return datetime.fromisoformat(value), payload["id"]
        if expected_sort == "downloads":
            if not isinstance(value, int) or value < 0:
                raise ValueError
            return value, payload["id"]
        if not isinstance(value, str) or len(value) > 200:
            raise ValueError
        return value, payload["id"]
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid catalog cursor") from exc


def _current_version_has_location():
    return Dataset.versions.any(
        and_(
            DatasetVersion.is_current.is_(True),
            DatasetVersion.spatial_coverage.has(),
        )
    )


def _current_version_has_field(pattern: str):
    return Dataset.versions.any(
        and_(
            DatasetVersion.is_current.is_(True),
            DatasetVersion.resources.any(
                Resource.schema_profile.has(
                    SchemaProfile.fields.any(ResourceField.name.ilike(pattern))
                )
            ),
        )
    )


def _current_version_period(period: Literal["12m", "3y", "historic"]):
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=365 if period == "12m" else 3 * 365)
    criterion = (
        TemporalCoverage.starts_at <= cutoff
        if period == "historic"
        else or_(TemporalCoverage.ends_at.is_(None), TemporalCoverage.ends_at >= cutoff)
    )
    return Dataset.versions.any(
        and_(
            DatasetVersion.is_current.is_(True),
            DatasetVersion.temporal_coverage.has(criterion),
        )
    )


@router.get("/datasets", response_model=DatasetPage)
async def list_datasets(
    q: str | None = Query(default=None, max_length=200),
    topic: str | None = Query(default=None, max_length=100),
    sensor: str | None = Query(default=None, max_length=100),
    variable: str | None = Query(default=None, max_length=255),
    location: str | None = Query(default=None, max_length=120),
    period: Literal["12m", "3y", "historic"] | None = None,
    license: str | None = Query(default=None, max_length=100),
    format: str | None = Query(default=None, max_length=20),
    has_location: bool | None = None,
    cursor: str | None = Query(default=None, max_length=1024),
    sort: CatalogSort = "recent",
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_session),
) -> DatasetPage:
    statement = (
        select(Dataset)
        .where(
            Dataset.status == DatasetStatus.PUBLISHED,
            Dataset.visibility == "public",
            Dataset.published_at.is_not(None),
        )
        .options(*dataset_graph_options())
        .limit(limit + 1)
    )
    if sort == "downloads":
        statement = statement.order_by(Dataset.downloads.desc(), Dataset.id.desc())
    elif sort == "title":
        statement = statement.order_by(Dataset.title.asc(), Dataset.id.asc())
    else:
        statement = statement.order_by(Dataset.published_at.desc(), Dataset.id.desc())
    if q:
        pattern = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                Dataset.title.ilike(pattern),
                Dataset.description.ilike(pattern),
                Dataset.topic.ilike(pattern),
                cast(Dataset.tags, String).ilike(pattern),
                _current_version_has_field(pattern),
            )
        )
    if topic:
        statement = statement.where(Dataset.topic.ilike(topic.strip()))
    if sensor:
        sensor_pattern = f"%{sensor.strip()}%"
        statement = statement.where(
            or_(Dataset.topic.ilike(sensor_pattern), Dataset.title.ilike(sensor_pattern))
        )
    if variable:
        statement = statement.where(_current_version_has_field(f"%{variable.strip()}%"))
    if location:
        location_pattern = f"%{location.strip()}%"
        statement = statement.where(
            _current_version_has_location(),
            or_(
                Dataset.title.ilike(location_pattern),
                Dataset.description.ilike(location_pattern),
                cast(Dataset.tags, String).ilike(location_pattern),
            ),
        )
    if period:
        statement = statement.where(_current_version_period(period))
    if license:
        statement = statement.where(Dataset.license.ilike(license.strip()))
    if format:
        statement = statement.where(
            Dataset.versions.any(
                and_(
                    DatasetVersion.is_current.is_(True),
                    DatasetVersion.resources.any(Resource.format == format.lower()),
                )
            )
        )
    if has_location is not None:
        location_exists = _current_version_has_location()
        statement = statement.where(location_exists if has_location else ~location_exists)
    if cursor:
        value, dataset_id = _decode_cursor(cursor, sort)
        if sort == "downloads":
            assert isinstance(value, int)
            statement = statement.where(
                or_(
                    Dataset.downloads < value,
                    and_(Dataset.downloads == value, Dataset.id < dataset_id),
                )
            )
        elif sort == "title":
            assert isinstance(value, str)
            statement = statement.where(
                or_(
                    Dataset.title > value,
                    and_(Dataset.title == value, Dataset.id > dataset_id),
                )
            )
        else:
            assert isinstance(value, datetime)
            statement = statement.where(
                or_(
                    Dataset.published_at < value,
                    and_(Dataset.published_at == value, Dataset.id < dataset_id),
                )
            )
    datasets = list((await session.scalars(statement)).unique())
    has_more = len(datasets) > limit
    datasets = datasets[:limit]
    next_cursor = _encode_cursor(datasets[-1], sort) if has_more and datasets else None
    return DatasetPage(items=[dataset_summary(item) for item in datasets], next_cursor=next_cursor)


@router.get("/datasets/{slug}", response_model=DatasetDetail)
async def get_dataset(slug: str, session: AsyncSession = Depends(get_session)) -> DatasetDetail:
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    detail = dataset_detail(dataset)
    return detail.model_copy(
        update={
            "versions": [
                version for version in detail.versions if version.status == VersionStatus.PUBLISHED
            ]
        }
    )


@router.get("/datasets/{slug}/versions/{version_number}", response_model=VersionRead)
async def get_dataset_version(
    slug: str, version_number: int, session: AsyncSession = Depends(get_session)
) -> VersionRead:
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    version = next(
        (
            item
            for item in dataset.versions
            if item.number == version_number and item.status == VersionStatus.PUBLISHED
        ),
        None,
    )
    if version is None:
        raise HTTPException(status_code=404, detail="Published version not found")
    return version_read(version)


def _ready_resource(dataset: Dataset, resource_id: str | None) -> Resource:
    version = current_version(dataset)
    if version is None:
        raise HTTPException(status_code=404, detail="Dataset has no published version")
    resources = [item for item in version.resources if item.status == ResourceStatus.READY]
    resource = (
        next((item for item in resources if item.id == resource_id), None)
        if resource_id
        else (resources[0] if resources else None)
    )
    if resource is None or not resource.normalized_key or not resource.schema_profile:
        raise HTTPException(status_code=404, detail="Ready resource not found")
    return resource


async def _query_dataset(dataset: Dataset, payload: DataQuery, settings: Settings) -> QueryResult:
    resource = _ready_resource(dataset, payload.resource_id)
    limit = min(payload.limit, settings.max_query_rows)
    payload = payload.model_copy(update={"limit": limit})
    fields = {field.name for field in resource.schema_profile.fields}
    storage = get_storage(settings)
    async with storage.materialize(resource.normalized_key) as path:
        try:
            return await execute_query(path, fields, payload)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/datasets/{slug}/preview", response_model=QueryResult)
async def preview_dataset(
    slug: str,
    resource_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> QueryResult:
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    return await _query_dataset(
        dataset,
        DataQuery(resource_id=resource_id, limit=min(limit, settings.max_preview_rows)),
        settings,
    )


@router.post("/datasets/{slug}/query", response_model=QueryResult)
async def query_dataset(
    slug: str,
    payload: DataQuery,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> QueryResult:
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    return await _query_dataset(dataset, payload, settings)


@router.get("/datasets/{slug}/resources/{resource_id}/download")
async def download_resource(
    slug: str,
    resource_id: str,
    normalized: bool = False,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    resource = _ready_resource(dataset, resource_id)
    key = resource.normalized_key if normalized else resource.original_key
    if not key:
        raise HTTPException(status_code=404, detail="Resource object is unavailable")
    filename = (
        f"{Path(resource.original_filename).stem}.parquet"
        if normalized
        else resource.original_filename
    )
    storage = get_storage(settings)
    dataset.downloads += 1
    await session.commit()
    presigned = await storage.presign_download(key, filename, expires=900)
    if presigned:
        return RedirectResponse(presigned, status_code=307)
    async with storage.materialize(key) as path:
        return FileResponse(path, filename=filename, media_type=resource.media_type)


@router.get("/datasets/{slug}/versions/{version_number}/resources/{resource_id}/download")
async def download_versioned_resource(
    slug: str,
    version_number: int,
    resource_id: str,
    normalized: bool = False,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    version = next(
        (
            item
            for item in dataset.versions
            if item.number == version_number and item.status == VersionStatus.PUBLISHED
        ),
        None,
    )
    resource = (
        next(
            (
                item
                for item in version.resources
                if item.id == resource_id and item.status == ResourceStatus.READY
            ),
            None,
        )
        if version
        else None
    )
    if resource is None:
        raise HTTPException(status_code=404, detail="Published resource not found")
    key = resource.normalized_key if normalized else resource.original_key
    if not key:
        raise HTTPException(status_code=404, detail="Resource object is unavailable")
    filename = (
        f"{Path(resource.original_filename).stem}.parquet"
        if normalized
        else resource.original_filename
    )
    storage = get_storage(settings)
    dataset.downloads += 1
    await session.commit()
    presigned = await storage.presign_download(key, filename, expires=900)
    if presigned:
        return RedirectResponse(presigned, status_code=307)
    async with storage.materialize(key) as path:
        return FileResponse(path, filename=filename, media_type=resource.media_type)


@router.get("/map/datasets")
async def map_datasets(
    bbox: str | None = Query(default=None, description="west,south,east,north"),
    limit: int = Query(default=500, ge=1, le=2_000),
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    statement = (
        select(Dataset, DatasetVersion, SpatialCoverage)
        .join(DatasetVersion, DatasetVersion.dataset_id == Dataset.id)
        .join(SpatialCoverage, SpatialCoverage.version_id == DatasetVersion.id)
        .where(
            Dataset.status == DatasetStatus.PUBLISHED,
            Dataset.visibility == "public",
            DatasetVersion.is_current.is_(True),
        )
        .limit(limit)
    )
    if bbox:
        try:
            west, south, east, north = (float(value) for value in bbox.split(","))
            if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
                raise ValueError
        except ValueError as exc:
            raise HTTPException(
                status_code=422, detail="bbox must be west,south,east,north"
            ) from exc
        if session.bind and session.bind.dialect.name == "postgresql":
            statement = statement.where(
                func.ST_Intersects(
                    SpatialCoverage.geom,
                    func.ST_MakeEnvelope(west, south, east, north, 4326),
                )
            )
        else:
            statement = statement.where(
                SpatialCoverage.max_longitude >= west,
                SpatialCoverage.min_longitude <= east,
                SpatialCoverage.max_latitude >= south,
                SpatialCoverage.min_latitude <= north,
            )
    rows = (await session.execute(statement)).all()
    features = []
    for dataset, version, coverage in rows:
        geometry = coverage.geometry
        if not geometry and coverage.centroid_longitude is not None:
            geometry = {
                "type": "Point",
                "coordinates": [coverage.centroid_longitude, coverage.centroid_latitude],
            }
        features.append(
            {
                "type": "Feature",
                "id": dataset.id,
                "geometry": geometry,
                "properties": {
                    "slug": dataset.slug,
                    "title": dataset.title,
                    "topic": dataset.topic,
                    "version": version.number,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def _parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if value is None:
        return None
    try:
        west, south, east, north = (float(item) for item in value.split(","))
        if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
            raise ValueError
        return west, south, east, north
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="bbox must be west,south,east,north") from exc


@router.get("/datasets/{slug}/points")
async def dataset_record_points(
    slug: str,
    bbox: str | None = Query(default=None, description="west,south,east,north"),
    limit: int = Query(default=1_000, ge=1, le=5_000),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    dataset = await load_dataset_full(session, slug=slug)
    if dataset is None or dataset.status != DatasetStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    version = current_version(dataset)
    if version is None:
        return {"type": "FeatureCollection", "features": []}
    parsed_bbox = _parse_bbox(bbox)
    mappings = {mapping.resource_id: mapping for mapping in version.semantic_mappings}
    storage = get_storage(settings)
    features: list[dict[str, object]] = []
    for resource in version.resources:
        if len(features) >= limit:
            break
        if resource.status != ResourceStatus.READY:
            continue
        if not resource.normalized_key or not resource.schema_profile:
            continue
        mapping = mappings.get(resource.id)
        nested_location = resource.kind == "rest_batch"
        if not nested_location and not (
            mapping and mapping.latitude_field and mapping.longitude_field
        ):
            continue
        known_fields = {field.name for field in resource.schema_profile.fields}
        async with storage.materialize(resource.normalized_key) as path:
            points = await execute_points(
                path,
                known_fields,
                latitude_field=mapping.latitude_field if mapping else None,
                longitude_field=mapping.longitude_field if mapping else None,
                sensor_field=(mapping.sensor_id_field if mapping else "sensor_id")
                if (mapping and mapping.sensor_id_field) or "sensor_id" in known_fields
                else None,
                observed_at_field=(mapping.observed_at_field if mapping else "observed_at")
                if (mapping and mapping.observed_at_field) or "observed_at" in known_fields
                else None,
                nested_location=nested_location,
                bbox=parsed_bbox,
                limit=limit - len(features),
            )
        features.extend(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [point["longitude"], point["latitude"]],
                },
                "properties": {
                    "resource_id": resource.id,
                    "sensor_id": point["sensor_id"],
                    "observed_at": point["observed_at"],
                },
            }
            for point in points
        )
    return {"type": "FeatureCollection", "features": features}


@router.post("/datasets/{slug}/reports", response_model=ReportCreated, status_code=201)
async def report_dataset(
    slug: str,
    payload: ReportCreate,
    request: Request,
    user: CurrentUser | None = Depends(get_optional_user),
    session: AsyncSession = Depends(get_session),
) -> ReportCreated:
    dataset = await session.scalar(
        select(Dataset).where(Dataset.slug == slug, Dataset.status == DatasetStatus.PUBLISHED)
    )
    if dataset is None:
        raise HTTPException(status_code=404, detail="Published dataset not found")
    report = Report(
        dataset_id=dataset.id,
        reporter_subject=user.subject if user else None,
        reason=payload.reason,
        details=payload.details,
    )
    session.add(report)
    await session.flush()
    audit(
        session,
        "dataset.reported",
        "dataset",
        dataset.id,
        user.subject if user else None,
        client_ip(request),
        {"report_id": report.id, "reason": report.reason},
    )
    await session.commit()
    return ReportCreated(id=report.id, status=report.status.value)
