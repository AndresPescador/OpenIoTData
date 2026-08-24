from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AuditEvent,
    Dataset,
    DatasetVersion,
    Resource,
    SpatialCoverage,
    TemporalCoverage,
)
from app.schemas import (
    DatasetDetail,
    DatasetSummary,
    ResourceFieldRead,
    ResourceRead,
    SchemaProfileRead,
    SemanticMappingRead,
    SpatialCoverageInput,
    SpatialCoverageRead,
    TemporalCoverageInput,
    TemporalCoverageRead,
    VersionRead,
)


def slugify(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug[:200] or "dataset"


async def unique_slug(session: AsyncSession, requested: str) -> str:
    base = slugify(requested)
    candidate = base
    suffix = 2
    while await session.scalar(select(Dataset.id).where(Dataset.slug == candidate)):
        candidate = f"{base[:190]}-{suffix}"
        suffix += 1
    return candidate


async def account_usage_bytes(session: AsyncSession, subject: str) -> int:
    usage = await session.scalar(
        select(func.coalesce(func.sum(Resource.byte_size), 0))
        .join(DatasetVersion, DatasetVersion.id == Resource.version_id)
        .join(Dataset, Dataset.id == DatasetVersion.dataset_id)
        .where(Dataset.owner_subject == subject)
    )
    return int(usage or 0)


def ensure_owner(dataset: Dataset, subject: str) -> None:
    from fastapi import HTTPException

    if dataset.owner_subject != subject:
        raise HTTPException(status_code=403, detail="You do not own this dataset")


def audit(
    session: AsyncSession,
    action: str,
    target_type: str,
    target_id: str | None,
    actor: str | None,
    ip_address: str | None,
    metadata: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditEvent(
            actor_subject=actor,
            action=action,
            target_type=target_type,
            target_id=target_id,
            ip_address=ip_address,
            event_metadata=metadata or {},
        )
    )


def apply_spatial_coverage(version: DatasetVersion, payload: SpatialCoverageInput | None) -> None:
    if payload is None:
        return
    geometry = payload.geometry
    bbox = payload.bbox
    latitude = payload.latitude
    longitude = payload.longitude
    if latitude is not None and longitude is not None:
        if payload.reduce_precision:
            latitude, longitude = round(latitude, 3), round(longitude, 3)
        geometry = {"type": "Point", "coordinates": [longitude, latitude]}
        bbox = (longitude, latitude, longitude, latitude)
    elif bbox and geometry is None:
        west, south, east, north = bbox
        geometry = {
            "type": "Polygon",
            "coordinates": [
                [
                    [west, south],
                    [east, south],
                    [east, north],
                    [west, north],
                    [west, south],
                ]
            ],
        }
    west = south = east = north = None
    if bbox:
        west, south, east, north = bbox
    coverage = version.spatial_coverage or SpatialCoverage(version=version)
    coverage.geometry = geometry
    coverage.geom = geometry_to_ewkt(geometry)
    coverage.crs = payload.crs
    coverage.min_longitude = west
    coverage.min_latitude = south
    coverage.max_longitude = east
    coverage.max_latitude = north
    coverage.centroid_longitude = (
        longitude
        if longitude is not None
        else ((west + east) / 2 if west is not None and east is not None else None)
    )
    coverage.centroid_latitude = (
        latitude
        if latitude is not None
        else ((south + north) / 2 if south is not None and north is not None else None)
    )
    coverage.precision_reduced = payload.reduce_precision
    version.spatial_coverage = coverage


def geometry_to_ewkt(geometry: dict[str, Any] | None) -> str | None:
    """Convert the supported catalog geometries to EWKT without accepting arbitrary SQL."""
    if not geometry:
        return None
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if (
        geometry_type == "Point"
        and isinstance(coordinates, (list, tuple))
        and len(coordinates) >= 2
    ):
        longitude, latitude = float(coordinates[0]), float(coordinates[1])
        if -180 <= longitude <= 180 and -90 <= latitude <= 90:
            return f"SRID=4326;POINT({longitude} {latitude})"
    if geometry_type == "Polygon" and isinstance(coordinates, list) and coordinates:
        rings: list[str] = []
        for ring in coordinates:
            if not isinstance(ring, list) or len(ring) < 4:
                return None
            points = []
            for point in ring:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    return None
                longitude, latitude = float(point[0]), float(point[1])
                if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                    return None
                points.append(f"{longitude} {latitude}")
            rings.append(f"({','.join(points)})")
        return f"SRID=4326;POLYGON({','.join(rings)})"
    return None


def apply_temporal_coverage(version: DatasetVersion, payload: TemporalCoverageInput | None) -> None:
    if payload is None:
        return
    coverage = version.temporal_coverage or TemporalCoverage(version=version)
    coverage.starts_at = payload.starts_at
    coverage.ends_at = payload.ends_at
    coverage.frequency = payload.frequency
    coverage.timezone_name = payload.timezone_name
    version.temporal_coverage = coverage


def spatial_read(coverage: SpatialCoverage | None) -> SpatialCoverageRead | None:
    if coverage is None:
        return None
    bbox = None
    if all(
        value is not None
        for value in (
            coverage.min_longitude,
            coverage.min_latitude,
            coverage.max_longitude,
            coverage.max_latitude,
        )
    ):
        bbox = (
            coverage.min_longitude,
            coverage.min_latitude,
            coverage.max_longitude,
            coverage.max_latitude,
        )
    return SpatialCoverageRead(
        geometry=coverage.geometry,
        crs=coverage.crs,
        centroid_latitude=coverage.centroid_latitude,
        centroid_longitude=coverage.centroid_longitude,
        bbox=bbox,
        precision_reduced=coverage.precision_reduced,
    )


def temporal_read(coverage: TemporalCoverage | None) -> TemporalCoverageRead | None:
    if coverage is None:
        return None
    return TemporalCoverageRead(
        starts_at=coverage.starts_at,
        ends_at=coverage.ends_at,
        frequency=coverage.frequency,
        timezone_name=coverage.timezone_name,
    )


def resource_read(resource: Any, include_schema: bool = True) -> ResourceRead:
    profile = None
    if include_schema and resource.schema_profile:
        profile = SchemaProfileRead(
            row_count=resource.schema_profile.row_count,
            column_count=resource.schema_profile.column_count,
            quality_summary=resource.schema_profile.quality_summary,
            inferred_at=resource.schema_profile.inferred_at,
            fields=[
                ResourceFieldRead(
                    name=field.name,
                    position=field.position,
                    physical_type=field.physical_type,
                    logical_type=field.logical_type,
                    nullable=field.nullable,
                    null_count=field.null_count,
                    distinct_count=field.distinct_count,
                    examples=field.examples,
                    minimum=field.minimum,
                    maximum=field.maximum,
                    semantic_hint=field.semantic_hint,
                )
                for field in resource.schema_profile.fields
            ],
        )
    return ResourceRead(
        id=resource.id,
        name=resource.name,
        original_filename=resource.original_filename,
        media_type=resource.media_type,
        format=resource.format,
        byte_size=resource.byte_size,
        checksum_sha256=resource.checksum_sha256,
        row_count=resource.row_count,
        status=resource.status,
        error_message=resource.error_message,
        schema_profile=profile,
    )


def version_read(version: DatasetVersion, include_schema: bool = True) -> VersionRead:
    return VersionRead(
        id=version.id,
        number=version.number,
        status=version.status,
        changelog=version.changelog,
        is_current=version.is_current,
        published_at=version.published_at,
        resources=[resource_read(resource, include_schema) for resource in version.resources],
        semantic_mappings=[
            SemanticMappingRead(
                resource_id=mapping.resource_id,
                observed_at_field=mapping.observed_at_field,
                latitude_field=mapping.latitude_field,
                longitude_field=mapping.longitude_field,
                sensor_id_field=mapping.sensor_id_field,
                variable_units=mapping.variable_units,
                crs=mapping.crs,
            )
            for mapping in version.semantic_mappings
        ],
        spatial_coverage=spatial_read(version.spatial_coverage),
        temporal_coverage=temporal_read(version.temporal_coverage),
    )


def dataset_summary(dataset: Dataset) -> DatasetSummary:
    current = next((version for version in dataset.versions if version.is_current), None)
    if current is None and dataset.versions:
        current = max(dataset.versions, key=lambda version: version.number)
    resources = current.resources if current else []
    mappings = current.semantic_mappings if current else []
    variables = {field_name for mapping in mappings for field_name in mapping.variable_units}
    has_mapped_variables = bool(variables)
    excluded_fields = {
        field_name
        for mapping in mappings
        for field_name in (
            mapping.observed_at_field,
            mapping.latitude_field,
            mapping.longitude_field,
            mapping.sensor_id_field,
        )
        if field_name
    }
    for resource in resources:
        if resource.schema_profile is None:
            continue
        for field in resource.schema_profile.fields:
            type_name = f"{field.logical_type} {field.physical_type}".lower()
            inferred_measure = any(
                token in type_name for token in ("int", "float", "double", "decimal")
            )
            if field.semantic_hint in {"measure", "variable"} or (
                not has_mapped_variables and inferred_measure and field.name not in excluded_fields
            ):
                variables.add(field.name)
    return DatasetSummary(
        id=dataset.id,
        owner_subject=dataset.owner_subject,
        title=dataset.title,
        slug=dataset.slug,
        description=dataset.description,
        topic=dataset.topic,
        tags=dataset.tags,
        license=dataset.license,
        status=dataset.status,
        published_at=dataset.published_at,
        downloads=dataset.downloads,
        current_version=current.number if current else None,
        resource_count=len(resources),
        formats=sorted({resource.format for resource in resources}),
        variables=sorted(variables),
        row_count=sum(resource.row_count or 0 for resource in resources),
        byte_size=sum(resource.byte_size for resource in resources),
        spatial_coverage=spatial_read(current.spatial_coverage) if current else None,
        temporal_coverage=temporal_read(current.temporal_coverage) if current else None,
    )


def dataset_detail(dataset: Dataset) -> DatasetDetail:
    summary = dataset_summary(dataset)
    return DatasetDetail(
        **summary.model_dump(),
        versions=[
            version_read(version) for version in sorted(dataset.versions, key=lambda x: x.number)
        ],
    )


def now_utc() -> datetime:
    return datetime.now(UTC)
