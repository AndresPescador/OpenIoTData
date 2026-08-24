from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.json as pajson
import pyarrow.parquet as pq


@dataclass(slots=True)
class InferredField:
    position: int
    name: str
    physical_type: str
    logical_type: str
    nullable: bool
    null_count: int
    distinct_count: int | None
    examples: list[Any]
    minimum: str | None
    maximum: str | None
    semantic_hint: str | None


@dataclass(slots=True)
class InferenceResult:
    row_count: int
    column_count: int
    fields: list[InferredField]
    quality_summary: dict[str, Any]


def _text_encoding(path: Path) -> str:
    with path.open("rb") as source:
        sample = source.read(65536)
    try:
        sample.decode("utf-8")
        return "utf8"
    except UnicodeDecodeError:
        sample.decode("latin1")
        return "latin1"


def _read_json_document(path: Path) -> pa.Table:
    encoding = _text_encoding(path)
    with path.open("r", encoding=encoding) as source:
        document = json.load(source)
    if isinstance(document, list):
        rows = document
    elif isinstance(document, dict):
        if isinstance(document.get("records"), list):
            rows = document["records"]
        else:
            rows = [document]
    else:
        raise ValueError("JSON resources must contain an object, array, or a 'records' array")
    if not all(isinstance(row, dict) for row in rows):
        raise ValueError("Every JSON row must be an object")
    return pa.Table.from_pylist(rows)


def _read_geojson(path: Path) -> pa.Table:
    encoding = _text_encoding(path)
    with path.open("r", encoding=encoding) as source:
        document = json.load(source)
    if document.get("type") == "FeatureCollection":
        features = document.get("features", [])
    elif document.get("type") == "Feature":
        features = [document]
    else:
        raise ValueError("GeoJSON must be a Feature or FeatureCollection")
    rows: list[dict[str, Any]] = []
    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("Invalid GeoJSON feature")
        properties = feature.get("properties") or {}
        if not isinstance(properties, dict):
            raise ValueError("GeoJSON feature properties must be an object")
        row = dict(properties)
        row["geometry"] = feature.get("geometry")
        if feature.get("id") is not None:
            row["feature_id"] = feature["id"]
        rows.append(row)
    return pa.Table.from_pylist(rows)


def read_resource(
    path: Path,
    resource_format: str,
    max_rows: int,
    max_columns: int,
    max_parquet_logical_bytes: int,
) -> pa.Table:
    if resource_format in {"csv", "tsv"}:
        parse_options = pacsv.ParseOptions(delimiter="\t" if resource_format == "tsv" else ",")
        read_options = pacsv.ReadOptions(encoding=_text_encoding(path))
        convert_options = pacsv.ConvertOptions(
            strings_can_be_null=True,
            null_values=["", "null", "NULL", "NA", "N/A", "nan", "NaN"],
        )
        return pacsv.read_csv(
            path,
            read_options=read_options,
            parse_options=parse_options,
            convert_options=convert_options,
        )
    if resource_format == "parquet":
        metadata = pq.ParquetFile(path).metadata
        logical_bytes = sum(
            metadata.row_group(index).total_byte_size for index in range(metadata.num_row_groups)
        )
        if metadata.num_rows > max_rows or metadata.num_columns > max_columns:
            raise ValueError("Parquet dimensions exceed the configured inference limits")
        if logical_bytes > max_parquet_logical_bytes:
            raise ValueError("Parquet logical size exceeds the configured inference limit")
        return pq.read_table(path)
    if resource_format == "geojson":
        return _read_geojson(path)
    if resource_format == "json":
        return _read_json_document(path)
    if resource_format == "ndjson":
        return pajson.read_json(path, read_options=pajson.ReadOptions(block_size=1 << 20))
    raise ValueError(f"Unsupported resource format: {resource_format}")


def _unique_names(names: list[str]) -> tuple[list[str], dict[str, str]]:
    result: list[str] = []
    renames: dict[str, str] = {}
    counts: dict[str, int] = {}
    for position, original in enumerate(names):
        base = original.strip() or f"column_{position + 1}"
        count = counts.get(base, 0)
        counts[base] = count + 1
        final = base if count == 0 else f"{base}_{count + 1}"
        result.append(final)
        if final != original:
            renames[original or f"column_{position + 1}"] = final
    return result, renames


def _logical_type(data_type: pa.DataType) -> str:
    if pa.types.is_timestamp(data_type):
        return "timestamp"
    if pa.types.is_date(data_type):
        return "date"
    if pa.types.is_time(data_type):
        return "time"
    if pa.types.is_integer(data_type):
        return "integer"
    if pa.types.is_floating(data_type) or pa.types.is_decimal(data_type):
        return "number"
    if pa.types.is_boolean(data_type):
        return "boolean"
    if pa.types.is_string(data_type) or pa.types.is_large_string(data_type):
        return "string"
    if pa.types.is_binary(data_type):
        return "binary"
    if pa.types.is_list(data_type) or pa.types.is_large_list(data_type):
        return "array"
    if pa.types.is_struct(data_type) or pa.types.is_map(data_type):
        return "object"
    return "unknown"


def _semantic_hint(name: str, logical_type: str) -> str | None:
    normalized = name.lower().replace("-", "_").replace(" ", "_")
    if normalized in {"latitude", "lat", "y"}:
        return "latitude"
    if normalized in {"longitude", "lon", "lng", "long", "x"}:
        return "longitude"
    if normalized in {"sensor_id", "station_id", "device_id", "sensor", "station"}:
        return "sensor_id"
    if logical_type in {"timestamp", "date"} or normalized in {
        "timestamp",
        "observed_at",
        "datetime",
        "time",
        "fecha",
    }:
        return "observed_at"
    return None


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _field_profile(position: int, field: pa.Field, column: pa.ChunkedArray) -> InferredField:
    null_count = column.null_count
    sampled = column.slice(0, min(len(column), 100_000))
    non_null_values = [_json_safe(value.as_py()) for value in sampled if value.is_valid][:5]
    distinct_count = None
    minimum = maximum = None
    try:
        distinct_count = int(pc.count_distinct(sampled).as_py())
    except Exception:
        pass
    try:
        result = pc.min_max(column).as_py()
        minimum = str(_json_safe(result["min"])) if result and result["min"] is not None else None
        maximum = str(_json_safe(result["max"])) if result and result["max"] is not None else None
    except Exception:
        pass
    logical_type = _logical_type(field.type)
    return InferredField(
        position=position,
        name=field.name,
        physical_type=str(field.type),
        logical_type=logical_type,
        nullable=field.nullable or null_count > 0,
        null_count=null_count,
        distinct_count=distinct_count,
        examples=non_null_values,
        minimum=minimum,
        maximum=maximum,
        semantic_hint=_semantic_hint(field.name, logical_type),
    )


def infer_and_normalize(
    path: Path,
    output_path: Path,
    resource_format: str,
    max_rows: int = 20_000_000,
    max_columns: int = 1_000,
    max_parquet_logical_bytes: int = 1024 * 1024 * 1024,
    max_tabular_inference_bytes: int = 256 * 1024 * 1024,
) -> InferenceResult:
    if resource_format != "parquet" and path.stat().st_size > max_tabular_inference_bytes:
        raise ValueError(
            "Text/JSON resource exceeds the inference limit; convert it to Parquet first"
        )
    table = read_resource(path, resource_format, max_rows, max_columns, max_parquet_logical_bytes)
    if table.num_rows > max_rows or table.num_columns > max_columns:
        raise ValueError("Resource dimensions exceed the configured inference limits")
    names, renamed = _unique_names(table.column_names)
    if names != table.column_names:
        table = table.rename_columns(names)
    if not table.column_names:
        raise ValueError("The resource has no columns")
    fields = [
        _field_profile(position, table.schema.field(position), table.column(position))
        for position in range(table.num_columns)
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, output_path, compression="zstd", use_dictionary=True)
    total_cells = table.num_rows * table.num_columns
    null_cells = sum(field.null_count for field in fields)
    quality = {
        "completeness": round(1 - (null_cells / total_cells), 6) if total_cells else 1.0,
        "null_cells": null_cells,
        "sampled_distinct_rows": min(table.num_rows, 100_000),
        "renamed_columns": renamed,
    }
    return InferenceResult(
        row_count=table.num_rows,
        column_count=table.num_columns,
        fields=fields,
        quality_summary=quality,
    )
