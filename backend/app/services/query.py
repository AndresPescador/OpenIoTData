from __future__ import annotations

import asyncio
import threading
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

import duckdb

from app.core.config import get_settings
from app.schemas import DataQuery, QueryOperator, QueryResult

OPERATOR_SQL = {
    QueryOperator.EQ: "=",
    QueryOperator.NE: "!=",
    QueryOperator.GT: ">",
    QueryOperator.GTE: ">=",
    QueryOperator.LT: "<",
    QueryOperator.LTE: "<=",
}


def quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def _execute(path: Path, allowed_fields: set[str], query: DataQuery) -> QueryResult:
    settings = get_settings()
    columns = query.columns or list(allowed_fields)
    unknown = set(columns) - allowed_fields
    if query.order_by and query.order_by not in allowed_fields:
        unknown.add(query.order_by)
    unknown.update(item.field for item in query.filters if item.field not in allowed_fields)
    if unknown:
        raise ValueError(f"Unknown fields: {', '.join(sorted(unknown))}")
    projection = ", ".join(quote_identifier(column) for column in columns)
    sql = f"SELECT {projection} FROM read_parquet(?)"  # noqa: S608 - identifiers are allow-listed
    parameters: list[Any] = [str(path)]
    clauses: list[str] = []
    for item in query.filters:
        identifier = quote_identifier(item.field)
        if item.operator in OPERATOR_SQL:
            clauses.append(f"{identifier} {OPERATOR_SQL[item.operator]} ?")
            parameters.append(item.value)
        elif item.operator == QueryOperator.IS_NULL:
            clauses.append(f"{identifier} IS NULL")
        elif item.operator == QueryOperator.IN:
            values = item.value
            if not values:
                clauses.append("FALSE")
            else:
                clauses.append(f"{identifier} IN ({', '.join('?' for _ in values)})")
                parameters.extend(values)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if query.order_by:
        sql += f" ORDER BY {quote_identifier(query.order_by)}"
        sql += " DESC" if query.descending else " ASC"
    sql += " LIMIT ? OFFSET ?"
    parameters.extend([query.limit, query.offset])
    connection = duckdb.connect(database=":memory:", read_only=False)
    connection.execute(f"SET memory_limit='{settings.duckdb_memory_limit}'")
    connection.execute(f"SET threads={settings.duckdb_threads}")
    interrupter = threading.Timer(settings.public_query_timeout_seconds, connection.interrupt)
    interrupter.start()
    try:
        cursor = connection.execute(sql, parameters)
        column_names = [description[0] for description in cursor.description]
        rows = [
            {name: json_safe(value) for name, value in zip(column_names, row, strict=True)}
            for row in cursor.fetchall()
        ]
        return QueryResult(
            columns=column_names,
            rows=rows,
            returned=len(rows),
            limit=query.limit,
            offset=query.offset,
        )
    finally:
        interrupter.cancel()
        connection.close()


async def execute_query(path: Path, allowed_fields: set[str], query: DataQuery) -> QueryResult:
    async with QUERY_SEMAPHORE:
        return await asyncio.to_thread(_execute, path, allowed_fields, query)


def _execute_points(
    path: Path,
    allowed_fields: set[str],
    latitude_field: str | None,
    longitude_field: str | None,
    sensor_field: str | None,
    observed_at_field: str | None,
    nested_location: bool,
    bbox: tuple[float, float, float, float] | None,
    limit: int,
) -> list[dict[str, Any]]:
    requested = {
        item for item in (latitude_field, longitude_field, sensor_field, observed_at_field) if item
    }
    if not requested.issubset(allowed_fields):
        return []
    if nested_location:
        if "location" not in allowed_fields:
            return []
        longitude_expression = 'TRY_CAST("location"."coordinates"[1] AS DOUBLE)'
        latitude_expression = 'TRY_CAST("location"."coordinates"[2] AS DOUBLE)'
    else:
        if not latitude_field or not longitude_field:
            return []
        longitude_expression = f"TRY_CAST({quote_identifier(longitude_field)} AS DOUBLE)"
        latitude_expression = f"TRY_CAST({quote_identifier(latitude_field)} AS DOUBLE)"
    sensor_expression = quote_identifier(sensor_field) if sensor_field else "NULL"
    observed_expression = quote_identifier(observed_at_field) if observed_at_field else "NULL"
    sql = (
        f"SELECT {longitude_expression} AS longitude, "
        f"{latitude_expression} AS latitude, "
        f"{sensor_expression} AS sensor_id, {observed_expression} AS observed_at "
        "FROM read_parquet(?) "
        f"WHERE {longitude_expression} BETWEEN -180 AND 180 "
        f"AND {latitude_expression} BETWEEN -90 AND 90"
    )
    parameters: list[Any] = [str(path)]
    if bbox:
        west, south, east, north = bbox
        sql += (
            f" AND {longitude_expression} BETWEEN ? AND ? AND {latitude_expression} BETWEEN ? AND ?"
        )
        parameters.extend([west, east, south, north])
    sql += " LIMIT ?"
    parameters.append(limit)
    connection = duckdb.connect(database=":memory:")
    settings = get_settings()
    connection.execute(f"SET memory_limit='{settings.duckdb_memory_limit}'")
    connection.execute(f"SET threads={settings.duckdb_threads}")
    interrupter = threading.Timer(settings.public_query_timeout_seconds, connection.interrupt)
    interrupter.start()
    try:
        rows = connection.execute(sql, parameters).fetchall()
        return [
            {
                "longitude": longitude,
                "latitude": latitude,
                "sensor_id": json_safe(sensor_id),
                "observed_at": json_safe(observed_at),
            }
            for longitude, latitude, sensor_id, observed_at in rows
        ]
    finally:
        interrupter.cancel()
        connection.close()


async def execute_points(
    path: Path,
    allowed_fields: set[str],
    *,
    latitude_field: str | None = None,
    longitude_field: str | None = None,
    sensor_field: str | None = None,
    observed_at_field: str | None = None,
    nested_location: bool = False,
    bbox: tuple[float, float, float, float] | None = None,
    limit: int = 1_000,
) -> list[dict[str, Any]]:
    async with QUERY_SEMAPHORE:
        return await asyncio.to_thread(
            _execute_points,
            path,
            allowed_fields,
            latitude_field,
            longitude_field,
            sensor_field,
            observed_at_field,
            nested_location,
            bbox,
            limit,
        )


QUERY_SEMAPHORE = asyncio.Semaphore(get_settings().max_concurrent_queries)
