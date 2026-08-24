"""Initial OpenIoTData catalog and PostGIS schema.

Revision ID: 20260823_0001
Revises: None
"""

from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.compiler import compiles

from alembic import op

revision = "20260823_0001"
down_revision = None
branch_labels = None
depends_on = None


class Geometry4326(sa.types.UserDefinedType[str]):
    """Migration-local type so this revision never depends on current application models."""

    cache_ok = True

    def get_col_spec(self, **_: Any) -> str:
        return "geometry(Geometry,4326)"


@compiles(Geometry4326, "sqlite")
def compile_geometry_sqlite(_: Geometry4326, __: Any, **___: Any) -> str:
    return "TEXT"


def _timestamps() -> tuple[sa.Column[Any], sa.Column[Any]]:
    return (
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def _id() -> sa.Column[Any]:
    return sa.Column("id", sa.String(36), primary_key=True, nullable=False)


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "audit_events",
        sa.Column("actor_subject", sa.String(255)),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=False),
        sa.Column("target_id", sa.String(100)),
        sa.Column("ip_address", sa.String(64)),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        _id(),
    )
    for column in ("actor_subject", "action", "target_id", "created_at"):
        op.create_index(f"ix_audit_events_{column}", "audit_events", [column])

    op.create_table(
        "datasets",
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("slug", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("topic", sa.String(100)),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("license", sa.String(100)),
        sa.Column("visibility", sa.String(20), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "uploading",
                "processing",
                "needs_mapping",
                "ready",
                "published",
                "quarantined",
                "failed",
                "archived",
                name="datasetstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("downloads", sa.Integer(), nullable=False),
        _id(),
        *_timestamps(),
    )
    op.create_index("ix_datasets_owner_subject", "datasets", ["owner_subject"])
    op.create_index("ix_datasets_public_catalog", "datasets", ["status", "published_at"])
    op.create_index("ix_datasets_slug", "datasets", ["slug"], unique=True)
    op.create_index("ix_datasets_status", "datasets", ["status"])

    op.create_table(
        "api_tokens",
        sa.Column(
            "dataset_id",
            sa.String(36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_subject", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        _id(),
        *_timestamps(),
    )
    op.create_index("ix_api_tokens_dataset_id", "api_tokens", ["dataset_id"])
    op.create_index("ix_api_tokens_owner_subject", "api_tokens", ["owner_subject"])
    op.create_index("ix_api_tokens_prefix", "api_tokens", ["prefix"], unique=True)

    op.create_table(
        "dataset_versions",
        sa.Column(
            "dataset_id",
            sa.String(36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "draft",
                "processing",
                "ready",
                "published",
                "failed",
                "archived",
                name="versionstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("changelog", sa.Text(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        _id(),
        *_timestamps(),
        sa.UniqueConstraint("dataset_id", "number", name="dataset_version_number"),
    )
    op.create_index("ix_dataset_versions_dataset_id", "dataset_versions", ["dataset_id"])

    op.create_table(
        "reports",
        sa.Column(
            "dataset_id",
            sa.String(36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reporter_subject", sa.String(255)),
        sa.Column("reason", sa.String(100), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "open",
                "reviewing",
                "resolved",
                "dismissed",
                name="reportstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        _id(),
        *_timestamps(),
    )
    op.create_index("ix_reports_dataset_id", "reports", ["dataset_id"])

    op.create_table(
        "resources",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(150)),
        sa.Column("format", sa.String(20), nullable=False),
        sa.Column("storage_backend", sa.String(20), nullable=False),
        sa.Column("original_key", sa.String(1024), nullable=False),
        sa.Column("normalized_key", sa.String(1024)),
        sa.Column("checksum_sha256", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("row_count", sa.BigInteger()),
        sa.Column(
            "status",
            sa.Enum(
                "uploaded",
                "processing",
                "ready",
                "quarantined",
                "failed",
                name="resourcestatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text()),
        _id(),
        *_timestamps(),
    )
    for column in ("version_id", "format", "status"):
        op.create_index(f"ix_resources_{column}", "resources", [column])

    op.create_table(
        "spatial_coverages",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("geometry", sa.JSON()),
        sa.Column("geom", Geometry4326()),
        sa.Column("crs", sa.String(50), nullable=False),
        sa.Column("centroid_latitude", sa.Float()),
        sa.Column("centroid_longitude", sa.Float()),
        sa.Column("min_latitude", sa.Float()),
        sa.Column("min_longitude", sa.Float()),
        sa.Column("max_latitude", sa.Float()),
        sa.Column("max_longitude", sa.Float()),
        sa.Column("precision_reduced", sa.Boolean(), nullable=False),
        _id(),
        *_timestamps(),
    )
    op.create_index(
        "ix_spatial_bbox",
        "spatial_coverages",
        ["min_longitude", "min_latitude", "max_longitude", "max_latitude"],
    )
    for column in ("min_longitude", "min_latitude", "max_longitude", "max_latitude"):
        op.create_index(f"ix_spatial_coverages_{column}", "spatial_coverages", [column])
    op.create_index("ix_spatial_geom_gist", "spatial_coverages", ["geom"], postgresql_using="gist")

    op.create_table(
        "temporal_coverages",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
        sa.Column("ends_at", sa.DateTime(timezone=True)),
        sa.Column("frequency", sa.String(100)),
        sa.Column("timezone_name", sa.String(100), nullable=False),
        _id(),
        *_timestamps(),
    )
    op.create_index("ix_temporal_coverages_starts_at", "temporal_coverages", ["starts_at"])
    op.create_index("ix_temporal_coverages_ends_at", "temporal_coverages", ["ends_at"])

    op.create_table(
        "ingestion_jobs",
        sa.Column(
            "dataset_id",
            sa.String(36),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("resource_id", sa.String(36), sa.ForeignKey("resources.id", ondelete="SET NULL")),
        sa.Column(
            "api_token_id", sa.String(36), sa.ForeignKey("api_tokens.id", ondelete="SET NULL")
        ),
        sa.Column("job_type", sa.String(50), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "running",
                "succeeded",
                "failed",
                name="jobstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(255)),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        _id(),
        *_timestamps(),
        sa.UniqueConstraint("dataset_id", "idempotency_key", name="dataset_idempotency_key"),
    )
    op.create_index("ix_ingestion_jobs_dataset_id", "ingestion_jobs", ["dataset_id"])
    op.create_index("ix_ingestion_jobs_resource_id", "ingestion_jobs", ["resource_id"])

    op.create_table(
        "schema_profiles",
        sa.Column(
            "resource_id",
            sa.String(36),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("row_count", sa.BigInteger(), nullable=False),
        sa.Column("column_count", sa.Integer(), nullable=False),
        sa.Column("quality_summary", sa.JSON(), nullable=False),
        sa.Column("inferred_at", sa.DateTime(timezone=True), nullable=False),
        _id(),
    )

    op.create_table(
        "semantic_mappings",
        sa.Column(
            "version_id",
            sa.String(36),
            sa.ForeignKey("dataset_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "resource_id",
            sa.String(36),
            sa.ForeignKey("resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("observed_at_field", sa.String(255)),
        sa.Column("latitude_field", sa.String(255)),
        sa.Column("longitude_field", sa.String(255)),
        sa.Column("sensor_id_field", sa.String(255)),
        sa.Column("variable_units", sa.JSON(), nullable=False),
        sa.Column("crs", sa.String(50), nullable=False),
        _id(),
        *_timestamps(),
        sa.UniqueConstraint("version_id", "resource_id", name="mapping_resource"),
    )
    op.create_index("ix_semantic_mappings_version_id", "semantic_mappings", ["version_id"])

    op.create_table(
        "resource_fields",
        sa.Column(
            "profile_id",
            sa.String(36),
            sa.ForeignKey("schema_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("physical_type", sa.String(150), nullable=False),
        sa.Column("logical_type", sa.String(50), nullable=False),
        sa.Column("nullable", sa.Boolean(), nullable=False),
        sa.Column("null_count", sa.BigInteger(), nullable=False),
        sa.Column("distinct_count", sa.BigInteger()),
        sa.Column("examples", sa.JSON(), nullable=False),
        sa.Column("minimum", sa.Text()),
        sa.Column("maximum", sa.Text()),
        sa.Column("semantic_hint", sa.String(50)),
        _id(),
        sa.UniqueConstraint("profile_id", "name", name="profile_field_name"),
    )
    op.create_index("ix_resource_fields_profile_id", "resource_fields", ["profile_id"])


def downgrade() -> None:
    for table in (
        "resource_fields",
        "semantic_mappings",
        "schema_profiles",
        "ingestion_jobs",
        "temporal_coverages",
        "spatial_coverages",
        "resources",
        "reports",
        "dataset_versions",
        "api_tokens",
        "datasets",
        "audit_events",
    ):
        op.drop_table(table)
