from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db.models import DatasetStatus, JobStatus, ResourceStatus, VersionStatus


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CurrentUser(BaseModel):
    subject: str
    display_name: str | None = None
    email: str | None = None
    roles: set[str] = Field(default_factory=set)


class SpatialCoverageInput(StrictModel):
    geometry: dict[str, Any] | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    bbox: tuple[float, float, float, float] | None = None
    crs: Literal["EPSG:4326"] = "EPSG:4326"
    reduce_precision: bool = False

    @model_validator(mode="after")
    def validate_geometry(self) -> SpatialCoverageInput:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        if self.bbox:
            west, south, east, north = self.bbox
            if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
                raise ValueError("bbox must be [west, south, east, north] in EPSG:4326")
        if self.geometry is not None:
            geometry_type = self.geometry.get("type")
            coordinates = self.geometry.get("coordinates")
            if geometry_type == "Point":
                if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
                    raise ValueError("GeoJSON Point requires [longitude, latitude]")
                longitude, latitude = float(coordinates[0]), float(coordinates[1])
                if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                    raise ValueError("GeoJSON Point is outside EPSG:4326")
                self.longitude, self.latitude = longitude, latitude
                self.bbox = (longitude, latitude, longitude, latitude)
            elif geometry_type == "Polygon":
                if not isinstance(coordinates, list) or not coordinates:
                    raise ValueError("GeoJSON Polygon requires at least one ring")
                points: list[tuple[float, float]] = []
                for ring in coordinates:
                    if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                        raise ValueError("Every Polygon ring must be closed and have four points")
                    for point in ring:
                        if not isinstance(point, (list, tuple)) or len(point) < 2:
                            raise ValueError("Invalid Polygon coordinate")
                        longitude, latitude = float(point[0]), float(point[1])
                        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
                            raise ValueError("GeoJSON Polygon is outside EPSG:4326")
                        points.append((longitude, latitude))
                longitudes, latitudes = zip(*points, strict=True)
                self.bbox = (min(longitudes), min(latitudes), max(longitudes), max(latitudes))
            else:
                raise ValueError("Catalog geometry supports GeoJSON Point or Polygon")
        return self


class TemporalCoverageInput(StrictModel):
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    frequency: str | None = Field(default=None, max_length=100)
    timezone_name: str = Field(default="UTC", max_length=100)

    @model_validator(mode="after")
    def validate_range(self) -> TemporalCoverageInput:
        if self.starts_at and self.ends_at and self.starts_at > self.ends_at:
            raise ValueError("starts_at must not be after ends_at")
        return self


class DatasetCreate(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    slug: str | None = Field(default=None, min_length=3, max_length=220)
    description: str = Field(default="", max_length=20_000)
    topic: str | None = Field(default=None, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)
    license: str | None = Field(default=None, max_length=100)
    spatial_coverage: SpatialCoverageInput | None = None
    temporal_coverage: TemporalCoverageInput | None = None

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, tags: list[str]) -> list[str]:
        normalized = [tag.strip().lower() for tag in tags if tag.strip()]
        return list(dict.fromkeys(normalized))


class DatasetUpdate(StrictModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    topic: str | None = Field(default=None, max_length=100)
    tags: list[str] | None = Field(default=None, max_length=20)
    license: str | None = Field(default=None, max_length=100)
    spatial_coverage: SpatialCoverageInput | None = None
    temporal_coverage: TemporalCoverageInput | None = None


class VersionCreate(StrictModel):
    changelog: str = Field(default="", max_length=5_000)


class ResourceFieldRead(BaseModel):
    name: str
    position: int
    physical_type: str
    logical_type: str
    nullable: bool
    null_count: int
    distinct_count: int | None
    examples: list[Any]
    minimum: str | None
    maximum: str | None
    semantic_hint: str | None


class SchemaProfileRead(BaseModel):
    row_count: int
    column_count: int
    quality_summary: dict[str, Any]
    inferred_at: datetime
    fields: list[ResourceFieldRead]


class ResourceRead(BaseModel):
    id: str
    name: str
    original_filename: str
    media_type: str | None
    format: str
    byte_size: int
    checksum_sha256: str
    row_count: int | None
    status: ResourceStatus
    error_message: str | None = None
    schema_profile: SchemaProfileRead | None = None


class SpatialCoverageRead(BaseModel):
    geometry: dict[str, Any] | None
    crs: str
    centroid_latitude: float | None
    centroid_longitude: float | None
    bbox: tuple[float, float, float, float] | None
    precision_reduced: bool


class TemporalCoverageRead(BaseModel):
    starts_at: datetime | None
    ends_at: datetime | None
    frequency: str | None
    timezone_name: str


class SemanticMappingRead(BaseModel):
    resource_id: str
    observed_at_field: str | None = None
    latitude_field: str | None = None
    longitude_field: str | None = None
    sensor_id_field: str | None = None
    variable_units: dict[str, str] = Field(default_factory=dict)
    crs: str


class VersionRead(BaseModel):
    id: str
    number: int
    status: VersionStatus
    changelog: str
    is_current: bool
    published_at: datetime | None
    resources: list[ResourceRead] = Field(default_factory=list)
    semantic_mappings: list[SemanticMappingRead] = Field(default_factory=list)
    spatial_coverage: SpatialCoverageRead | None = None
    temporal_coverage: TemporalCoverageRead | None = None


class DatasetSummary(BaseModel):
    id: str
    owner_subject: str
    title: str
    slug: str
    description: str
    topic: str | None
    tags: list[str]
    license: str | None
    status: DatasetStatus
    published_at: datetime | None
    downloads: int
    current_version: int | None = None
    resource_count: int = 0
    formats: list[str] = Field(default_factory=list)
    variables: list[str] = Field(default_factory=list)
    row_count: int = 0
    byte_size: int = 0
    spatial_coverage: SpatialCoverageRead | None = None
    temporal_coverage: TemporalCoverageRead | None = None


class DatasetDetail(DatasetSummary):
    versions: list[VersionRead]


class DatasetPage(BaseModel):
    items: list[DatasetSummary]
    next_cursor: str | None


class SemanticMappingInput(StrictModel):
    resource_id: str
    observed_at_field: str | None = None
    latitude_field: str | None = None
    longitude_field: str | None = None
    sensor_id_field: str | None = None
    variable_units: dict[str, str] = Field(default_factory=dict)
    crs: Literal["EPSG:4326"] = "EPSG:4326"

    @model_validator(mode="after")
    def coordinate_pair(self) -> SemanticMappingInput:
        if (self.latitude_field is None) != (self.longitude_field is None):
            raise ValueError("latitude_field and longitude_field must be mapped together")
        return self


class PresignUploadRequest(StrictModel):
    filename: str = Field(min_length=1, max_length=255)
    media_type: str | None = Field(default=None, max_length=150)
    byte_size: int = Field(gt=0)
    checksum_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


class PresignUploadResponse(BaseModel):
    resource_id: str
    upload_url: str
    method: Literal["PUT", "POST"]
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int


class ConfirmResourceRequest(StrictModel):
    checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-fA-F]{64}$")
    byte_size: int | None = Field(default=None, gt=0)


class JobRead(BaseModel):
    id: str
    job_type: str
    status: JobStatus
    progress: int
    resource_id: str | None
    result: dict[str, Any]
    error_message: str | None
    created_at: datetime
    finished_at: datetime | None


class QueryOperator(StrEnum):
    EQ = "eq"
    NE = "ne"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    IN = "in"
    IS_NULL = "is_null"


class QueryFilter(StrictModel):
    field: str = Field(min_length=1, max_length=255)
    operator: QueryOperator
    value: Any = None

    @model_validator(mode="after")
    def validate_value(self) -> QueryFilter:
        if self.operator == QueryOperator.IN and not isinstance(self.value, list):
            raise ValueError("The 'in' operator requires an array")
        if self.operator == QueryOperator.IN and len(self.value) > 100:
            raise ValueError("The 'in' operator accepts at most 100 values")
        if self.operator != QueryOperator.IS_NULL and self.value is None:
            raise ValueError("This operator requires a value")
        return self


class DataQuery(StrictModel):
    resource_id: str | None = None
    columns: list[str] | None = Field(default=None, max_length=100)
    filters: list[QueryFilter] = Field(default_factory=list, max_length=20)
    order_by: str | None = None
    descending: bool = False
    limit: int = Field(default=100, ge=1, le=2_000)
    offset: int = Field(default=0, ge=0, le=1_000_000)


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    returned: int
    limit: int
    offset: int


class GeoJsonPoint(StrictModel):
    type: Literal["Point"]
    coordinates: tuple[float, float]

    @field_validator("coordinates")
    @classmethod
    def valid_coordinates(cls, value: tuple[float, float]) -> tuple[float, float]:
        longitude, latitude = value
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError("location coordinates must be [longitude, latitude] in EPSG:4326")
        return value


class ObservationRecord(StrictModel):
    observed_at: datetime
    data: dict[str, Any]
    location: GeoJsonPoint | None = None
    sensor_id: str | None = Field(default=None, max_length=255)
    record_metadata: dict[str, Any] = Field(default_factory=dict, alias="metadata")


class ObservationBatch(StrictModel):
    records: list[ObservationRecord] = Field(min_length=1, max_length=10_000)


class BatchAccepted(BaseModel):
    job_id: str
    status: JobStatus
    record_count: int
    idempotent_replay: bool = False


class ApiTokenCreate(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    scopes: list[Literal["records:write"]] = Field(default_factory=lambda: ["records:write"])
    expires_at: datetime | None = None


class ApiTokenCreated(BaseModel):
    id: str
    name: str
    prefix: str
    token: str
    scopes: list[str]
    expires_at: datetime | None


class ApiTokenRead(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: list[str]
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class ReportCreate(StrictModel):
    reason: str = Field(min_length=3, max_length=100)
    details: str = Field(default="", max_length=5_000)


class ReportCreated(BaseModel):
    id: str
    status: str


class AdminReportRead(BaseModel):
    id: str
    dataset_id: str
    dataset_title: str
    dataset_owner: str
    reporter_subject: str | None
    reason: str
    details: str
    status: str
    created_at: datetime


class ReportStatusUpdate(StrictModel):
    status: Literal["reviewing", "resolved", "dismissed"]
