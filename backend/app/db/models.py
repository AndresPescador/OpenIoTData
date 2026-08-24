from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import UserDefinedType

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


def enum_column(enum_type: type[enum.Enum], **kwargs: Any) -> Any:
    return mapped_column(
        Enum(
            enum_type,
            values_callable=lambda members: [member.value for member in members],
            native_enum=False,
            validate_strings=True,
            length=max(len(member.value) for member in enum_type),
        ),
        **kwargs,
    )


class Geometry4326(UserDefinedType[str]):
    """Portable declaration: PostGIS geometry in PostgreSQL, WKT text in SQLite tests."""

    cache_ok = True

    def get_col_spec(self, **_: Any) -> str:
        return "geometry(Geometry,4326)"

    def bind_expression(self, bindvalue: Any) -> Any:
        return func.ST_GeomFromEWKT(bindvalue)


@compiles(Geometry4326, "sqlite")
def compile_geometry_sqlite(_: Geometry4326, __: Any, **___: Any) -> str:
    return "TEXT"


class DatasetStatus(enum.StrEnum):
    DRAFT = "draft"
    UPLOADING = "uploading"
    PROCESSING = "processing"
    NEEDS_MAPPING = "needs_mapping"
    READY = "ready"
    PUBLISHED = "published"
    QUARANTINED = "quarantined"
    FAILED = "failed"
    ARCHIVED = "archived"


class VersionStatus(enum.StrEnum):
    DRAFT = "draft"
    PROCESSING = "processing"
    READY = "ready"
    PUBLISHED = "published"
    FAILED = "failed"
    ARCHIVED = "archived"


class ResourceStatus(enum.StrEnum):
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    QUARANTINED = "quarantined"
    FAILED = "failed"


class JobStatus(enum.StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ReportStatus(enum.StrEnum):
    OPEN = "open"
    REVIEWING = "reviewing"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class Dataset(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "datasets"

    owner_subject: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    topic: Mapped[str | None] = mapped_column(String(100))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    license: Mapped[str | None] = mapped_column(String(100))
    visibility: Mapped[str] = mapped_column(String(20), default="public", nullable=False)
    status: Mapped[DatasetStatus] = enum_column(
        DatasetStatus, default=DatasetStatus.DRAFT, index=True, nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    downloads: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    versions: Mapped[list[DatasetVersion]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan", order_by="DatasetVersion.number"
    )
    api_tokens: Mapped[list[ApiToken]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan"
    )
    reports: Mapped[list[Report]] = relationship(back_populates="dataset")


class DatasetVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("dataset_id", "number", name="dataset_version_number"),)

    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[VersionStatus] = enum_column(
        VersionStatus, default=VersionStatus.DRAFT, nullable=False
    )
    changelog: Mapped[str] = mapped_column(Text, default="", nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    dataset: Mapped[Dataset] = relationship(back_populates="versions")
    resources: Mapped[list[Resource]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    semantic_mappings: Mapped[list[SemanticMapping]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )
    spatial_coverage: Mapped[SpatialCoverage | None] = relationship(
        back_populates="version", cascade="all, delete-orphan", uselist=False
    )
    temporal_coverage: Mapped[TemporalCoverage | None] = relationship(
        back_populates="version", cascade="all, delete-orphan", uselist=False
    )


class Resource(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "resources"

    version_id: Mapped[str] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(30), default="file", nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(150))
    format: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(20), nullable=False)
    original_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    normalized_key: Mapped[str | None] = mapped_column(String(1024))
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    row_count: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[ResourceStatus] = enum_column(
        ResourceStatus, default=ResourceStatus.UPLOADED, index=True, nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    version: Mapped[DatasetVersion] = relationship(back_populates="resources")
    schema_profile: Mapped[SchemaProfile | None] = relationship(
        back_populates="resource", cascade="all, delete-orphan", uselist=False
    )
    jobs: Mapped[list[IngestionJob]] = relationship(back_populates="resource")


class SchemaProfile(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "schema_profiles"

    resource_id: Mapped[str] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    row_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False)
    quality_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    inferred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    resource: Mapped[Resource] = relationship(back_populates="schema_profile")
    fields: Mapped[list[ResourceField]] = relationship(
        back_populates="profile", cascade="all, delete-orphan", order_by="ResourceField.position"
    )


class ResourceField(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "resource_fields"
    __table_args__ = (UniqueConstraint("profile_id", "name", name="profile_field_name"),)

    profile_id: Mapped[str] = mapped_column(
        ForeignKey("schema_profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    physical_type: Mapped[str] = mapped_column(String(150), nullable=False)
    logical_type: Mapped[str] = mapped_column(String(50), nullable=False)
    nullable: Mapped[bool] = mapped_column(Boolean, nullable=False)
    null_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    distinct_count: Mapped[int | None] = mapped_column(BigInteger)
    examples: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    minimum: Mapped[str | None] = mapped_column(Text)
    maximum: Mapped[str | None] = mapped_column(Text)
    semantic_hint: Mapped[str | None] = mapped_column(String(50))

    profile: Mapped[SchemaProfile] = relationship(back_populates="fields")


class SemanticMapping(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "semantic_mappings"
    __table_args__ = (UniqueConstraint("version_id", "resource_id", name="mapping_resource"),)

    version_id: Mapped[str] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    resource_id: Mapped[str] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), nullable=False
    )
    observed_at_field: Mapped[str | None] = mapped_column(String(255))
    latitude_field: Mapped[str | None] = mapped_column(String(255))
    longitude_field: Mapped[str | None] = mapped_column(String(255))
    sensor_id_field: Mapped[str | None] = mapped_column(String(255))
    variable_units: Mapped[dict[str, str]] = mapped_column(JSON, default=dict, nullable=False)
    crs: Mapped[str] = mapped_column(String(50), default="EPSG:4326", nullable=False)

    version: Mapped[DatasetVersion] = relationship(back_populates="semantic_mappings")


class SpatialCoverage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "spatial_coverages"

    version_id: Mapped[str] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    geometry: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # EWKT is accepted natively by PostGIS. The JSON copy remains the portable API representation.
    geom: Mapped[str | None] = mapped_column(Geometry4326())
    crs: Mapped[str] = mapped_column(String(50), default="EPSG:4326", nullable=False)
    centroid_latitude: Mapped[float | None] = mapped_column(Float)
    centroid_longitude: Mapped[float | None] = mapped_column(Float)
    min_latitude: Mapped[float | None] = mapped_column(Float, index=True)
    min_longitude: Mapped[float | None] = mapped_column(Float, index=True)
    max_latitude: Mapped[float | None] = mapped_column(Float, index=True)
    max_longitude: Mapped[float | None] = mapped_column(Float, index=True)
    precision_reduced: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    version: Mapped[DatasetVersion] = relationship(back_populates="spatial_coverage")


class TemporalCoverage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "temporal_coverages"

    version_id: Mapped[str] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    frequency: Mapped[str | None] = mapped_column(String(100))
    timezone_name: Mapped[str] = mapped_column(String(100), default="UTC", nullable=False)

    version: Mapped[DatasetVersion] = relationship(back_populates="temporal_coverage")


class IngestionJob(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (
        UniqueConstraint("dataset_id", "idempotency_key", name="dataset_idempotency_key"),
    )

    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    resource_id: Mapped[str | None] = mapped_column(
        ForeignKey("resources.id", ondelete="SET NULL"), index=True
    )
    api_token_id: Mapped[str | None] = mapped_column(
        ForeignKey("api_tokens.id", ondelete="SET NULL")
    )
    job_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[JobStatus] = enum_column(JobStatus, default=JobStatus.PENDING, nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(255))
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    resource: Mapped[Resource | None] = relationship(back_populates="jobs")


class ApiToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "api_tokens"

    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    owner_subject: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    dataset: Mapped[Dataset] = relationship(back_populates="api_tokens")


class Report(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "reports"

    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("datasets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    reporter_subject: Mapped[str | None] = mapped_column(String(255))
    reason: Mapped[str] = mapped_column(String(100), nullable=False)
    details: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[ReportStatus] = enum_column(
        ReportStatus, default=ReportStatus.OPEN, nullable=False
    )

    dataset: Mapped[Dataset] = relationship(back_populates="reports")


class AuditEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "audit_events"

    actor_subject: Mapped[str | None] = mapped_column(String(255), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(100), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True, nullable=False
    )


Index("ix_datasets_public_catalog", Dataset.status, Dataset.published_at)
Index(
    "ix_spatial_bbox",
    SpatialCoverage.min_longitude,
    SpatialCoverage.min_latitude,
    SpatialCoverage.max_longitude,
    SpatialCoverage.max_latitude,
)
Index("ix_spatial_geom_gist", SpatialCoverage.geom, postgresql_using="gist")
