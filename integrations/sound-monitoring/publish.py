#!/usr/bin/env python3
"""Publish Sound Monitoring System measurements to OpenIoTData.

The adapter intentionally uses only the Python standard library so it can run
next to the existing dashboard service or from a small scheduled container.
It reads the source dashboard's raw-measurement endpoint and sends immutable,
idempotent batches to an OpenIoTData dataset.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable


@dataclass(frozen=True)
class Settings:
    source_base_url: str
    target_base_url: str
    dataset_id: str
    api_token: str
    station_id: str
    latitude: float | None
    longitude: float | None
    batch_size: int = 500
    timeout_seconds: int = 30

    @classmethod
    def from_environment(cls) -> "Settings":
        def optional_float(name: str) -> float | None:
            value = os.getenv(name)
            return float(value) if value not in (None, "") else None

        required = {
            "SOUND_SOURCE_URL": os.getenv("SOUND_SOURCE_URL"),
            "OPENIOTDATA_URL": os.getenv("OPENIOTDATA_URL"),
            "OPENIOTDATA_DATASET_ID": os.getenv("OPENIOTDATA_DATASET_ID"),
            "OPENIOTDATA_API_TOKEN": os.getenv("OPENIOTDATA_API_TOKEN"),
            "SOUND_STATION_ID": os.getenv("SOUND_STATION_ID"),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ValueError(f"Faltan variables requeridas: {', '.join(missing)}")

        return cls(
            source_base_url=str(required["SOUND_SOURCE_URL"]).rstrip("/"),
            target_base_url=str(required["OPENIOTDATA_URL"]).rstrip("/"),
            dataset_id=str(required["OPENIOTDATA_DATASET_ID"]),
            api_token=str(required["OPENIOTDATA_API_TOKEN"]),
            station_id=str(required["SOUND_STATION_ID"]),
            latitude=optional_float("SOUND_STATION_LATITUDE"),
            longitude=optional_float("SOUND_STATION_LONGITUDE"),
            batch_size=int(os.getenv("SOUND_BATCH_SIZE", "500")),
            timeout_seconds=int(os.getenv("HTTP_TIMEOUT_SECONDS", "30")),
        )


def request_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    payload: Any | None = None,
    timeout: int = 30,
    attempts: int = 3,
) -> Any:
    encoded = None
    merged_headers = {"Accept": "application/json", **(headers or {})}
    if payload is not None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        merged_headers["Content-Type"] = "application/json"

    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(
                url, data=encoded, method=method, headers=merged_headers
            )
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read()
                return json.loads(body) if body else None
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    assert last_error is not None
    raise last_error


def source_measurements(
    settings: Settings, start: str, end: str, limit: int
) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"from": start, "to": end, "limit": limit})
    url = (
        f"{settings.source_base_url}/dashboard/stations/"
        f"{urllib.parse.quote(settings.station_id, safe='')}/measurements/raw?{query}"
    )
    response = request_json(url, timeout=settings.timeout_seconds)
    if isinstance(response, dict):
        for key in ("data", "items", "measurements", "results"):
            if isinstance(response.get(key), list):
                return list(response[key])
    if isinstance(response, list):
        return response
    raise ValueError("La API de sonido no devolvió una colección de mediciones")


def first_value(record: dict[str, Any], names: Iterable[str]) -> Any:
    for name in names:
        if record.get(name) is not None:
            return record[name]
    return None


def to_observation(settings: Settings, record: dict[str, Any]) -> dict[str, Any]:
    observed_at = first_value(
        record,
        ("observed_at", "recorded_at", "timestamp", "captured_at", "created_at"),
    )
    if observed_at is None:
        raise ValueError("La medición no contiene una marca temporal reconocible")

    reserved = {
        "observed_at",
        "recorded_at",
        "timestamp",
        "captured_at",
        "created_at",
        "station_id",
        "latitude",
        "longitude",
        "lat",
        "lon",
        "lng",
    }
    data = {key: value for key, value in record.items() if key not in reserved}

    latitude = first_value(record, ("latitude", "lat"))
    longitude = first_value(record, ("longitude", "lon", "lng"))
    latitude = settings.latitude if latitude is None else float(latitude)
    longitude = settings.longitude if longitude is None else float(longitude)

    observation: dict[str, Any] = {
        "observed_at": str(observed_at),
        "sensor_id": str(record.get("station_id") or settings.station_id),
        "data": data,
        "metadata": {"source": "sound-monitoring-system"},
    }
    if latitude is not None and longitude is not None:
        observation["location"] = {
            "type": "Point",
            "coordinates": [longitude, latitude],
        }
    return observation


def idempotency_key(
    settings: Settings, start: str, end: str, observations: list[dict[str, Any]]
) -> str:
    digest = hashlib.sha256()
    digest.update(settings.station_id.encode())
    digest.update(start.encode())
    digest.update(end.encode())
    digest.update(json.dumps(observations, sort_keys=True).encode())
    return f"sound-{digest.hexdigest()[:40]}"


def publish_batch(
    settings: Settings,
    start: str,
    end: str,
    observations: list[dict[str, Any]],
) -> Any:
    url = (
        f"{settings.target_base_url}/api/v1/datasets/"
        f"{urllib.parse.quote(settings.dataset_id, safe='')}/records:batch"
    )
    return request_json(
        url,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.api_token}",
            "Idempotency-Key": idempotency_key(
                settings, start, end, observations
            ),
        },
        payload={"records": observations},
        timeout=settings.timeout_seconds,
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publica mediciones acústicas en OpenIoTData"
    )
    parser.add_argument("--from", dest="start", required=True, help="ISO 8601")
    parser.add_argument("--to", dest="end", default=utc_now(), help="ISO 8601")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        settings = Settings.from_environment()
        raw = source_measurements(
            settings, args.start, args.end, settings.batch_size
        )
        observations = [to_observation(settings, item) for item in raw]
        if args.dry_run:
            json.dump(
                {"records": observations}, sys.stdout, ensure_ascii=False, indent=2
            )
            sys.stdout.write("\n")
            return 0
        result = publish_batch(settings, args.start, args.end, observations)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

