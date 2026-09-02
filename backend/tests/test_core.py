from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.config import Settings
from app.db.models import SpatialCoverage
from app.schemas import SpatialCoverageInput
from app.services.inference import infer_and_normalize
from app.services.storage import UnsafeUpload, validate_magic


def test_production_security_defaults_are_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="production",
            auto_create_db=False,
            oidc_issuer_url="https://identity.example/realms/openiotdata",
            token_hash_pepper="development-only-change-me",
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="production",
            auto_create_db=False,
            dev_auth_bypass=True,
            token_hash_pepper="safe-production-secret",
        )


def test_comma_separated_list_settings_are_read_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:8080")
    monkeypatch.setenv("OIDC_ALGORITHMS", "RS256,RS512")

    settings = Settings(_env_file=None)

    assert settings.cors_origins == ["http://localhost:3000", "http://localhost:8080"]
    assert settings.oidc_algorithms == ["RS256", "RS512"]


def test_spatial_input_restricts_crs_and_geometry() -> None:
    with pytest.raises(ValidationError):
        SpatialCoverageInput(crs="EPSG:3857", latitude=4.7, longitude=-74.0)
    with pytest.raises(ValidationError):
        SpatialCoverageInput(geometry={"type": "LineString", "coordinates": []})
    polygon = SpatialCoverageInput(
        geometry={
            "type": "Polygon",
            "coordinates": [[[-74.1, 4.6], [-74.0, 4.6], [-74.0, 4.7], [-74.1, 4.6]]],
        }
    )
    assert polygon.bbox == (-74.1, 4.6, -74.0, 4.7)


def test_inference_normalizes_csv_and_rejects_executable(tmp_path: Path) -> None:
    source = tmp_path / "sensor.csv"
    normalized = tmp_path / "sensor.parquet"
    source.write_text("timestamp,value\n2026-01-01T00:00:00Z,12.5\n", encoding="utf-8")
    result = infer_and_normalize(source, normalized, "csv")
    assert result.row_count == 1
    assert [field.name for field in result.fields] == ["timestamp", "value"]
    assert normalized.read_bytes().startswith(b"PAR1")
    with pytest.raises(ValueError, match="convert it to Parquet"):
        infer_and_normalize(source, normalized, "csv", max_tabular_inference_bytes=10)
    with pytest.raises(UnsafeUpload):
        validate_magic(b"\x7fELF malicious", "csv")


@pytest.mark.parametrize("resource_format", ["csv", "tsv", "json", "ndjson", "parquet", "geojson"])
def test_all_advertised_formats_infer_and_normalize(tmp_path: Path, resource_format: str) -> None:
    source = tmp_path / f"sensor.{resource_format}"
    normalized = tmp_path / f"normalized-{resource_format}.parquet"
    rows = [
        {"observed_at": "2026-01-01T00:00:00Z", "sensor_id": "S-1", "value": 12.5},
        {"observed_at": "2026-01-01T01:00:00Z", "sensor_id": "S-2", "value": 13.0},
    ]
    if resource_format == "csv":
        source.write_text(
            "observed_at,sensor_id,value\n"
            "2026-01-01T00:00:00Z,S-1,12.5\n"
            "2026-01-01T01:00:00Z,S-2,13.0\n",
            encoding="utf-8",
        )
    elif resource_format == "tsv":
        source.write_text(
            "observed_at\tsensor_id\tvalue\n"
            "2026-01-01T00:00:00Z\tS-1\t12.5\n"
            "2026-01-01T01:00:00Z\tS-2\t13.0\n",
            encoding="utf-8",
        )
    elif resource_format == "json":
        source.write_text(json.dumps(rows), encoding="utf-8")
    elif resource_format == "ndjson":
        # NDJSON commonly evolves one observation at a time. Verify missing
        # and newly introduced fields are preserved instead of dropping rows.
        heterogeneous_rows = [
            rows[0],
            {
                "observed_at": rows[1]["observed_at"],
                "sensor_id": rows[1]["sensor_id"],
                "status": "offline",
            },
        ]
        source.write_text(
            "\n".join(json.dumps(row) for row in heterogeneous_rows) + "\n", encoding="utf-8"
        )
    elif resource_format == "parquet":
        import pyarrow as pa
        import pyarrow.parquet as pq

        pq.write_table(pa.Table.from_pylist(rows), source)
    else:
        source.write_text(json.dumps({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": row,
                    "geometry": {
                        "type": "Point",
                        "coordinates": [-74.0, 4.7 + index * 0.01],
                    },
                }
                for index, row in enumerate(rows)
            ],
        }), encoding="utf-8")

    result = infer_and_normalize(source, normalized, resource_format)

    assert result.row_count == 2
    assert result.column_count >= 3
    assert normalized.read_bytes().startswith(b"PAR1")
    if resource_format == "ndjson":
        import pyarrow.parquet as pq

        normalized_rows = pq.read_table(normalized).to_pylist()
        assert normalized_rows[0]["value"] == 12.5
        assert normalized_rows[1]["value"] is None
        assert normalized_rows[1]["status"] == "offline"


def test_postgis_ddl_contains_geometry_and_gist() -> None:
    dialect = postgresql.dialect()
    table_sql = str(CreateTable(SpatialCoverage.__table__).compile(dialect=dialect))
    index = next(
        item for item in SpatialCoverage.__table__.indexes if item.name == "ix_spatial_geom_gist"
    )
    index_sql = str(CreateIndex(index).compile(dialect=dialect))
    assert "geometry(Geometry,4326)" in table_sql
    assert "USING gist" in index_sql
