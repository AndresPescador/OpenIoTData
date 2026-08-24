from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import load_dataset_full
from app.core.config import Settings, get_settings
from app.core.security import authenticate_api_token, client_ip
from app.db.base import uuid_str
from app.db.models import (
    Dataset,
    DatasetStatus,
    DatasetVersion,
    IngestionJob,
    JobStatus,
    Resource,
    VersionStatus,
)
from app.db.session import get_session
from app.schemas import BatchAccepted, ObservationBatch, SpatialCoverageInput
from app.services.catalog import account_usage_bytes, apply_spatial_coverage, audit
from app.services.processing import enqueue_processing
from app.services.storage import get_storage

router = APIRouter(prefix="/api/v1", tags=["sensor ingestion"])


async def _writable_version(session: AsyncSession, dataset: Dataset) -> DatasetVersion:
    candidates = [
        version
        for version in dataset.versions
        if version.status in {VersionStatus.DRAFT, VersionStatus.PROCESSING, VersionStatus.READY}
    ]
    if candidates:
        return max(candidates, key=lambda version: version.number)
    max_number = await session.scalar(
        select(func.max(DatasetVersion.number)).where(DatasetVersion.dataset_id == dataset.id)
    )
    version = DatasetVersion(
        dataset=dataset,
        number=int(max_number or 0) + 1,
        changelog="Ingesta continua por API",
    )
    version.spatial_coverage = None
    version.temporal_coverage = None
    session.add(version)
    await session.flush()
    return version


def _batch_spatial_coverage(
    version: DatasetVersion, payload: ObservationBatch
) -> SpatialCoverageInput | None:
    points = [record.location.coordinates for record in payload.records if record.location]
    if not points:
        return None
    longitudes = [point[0] for point in points]
    latitudes = [point[1] for point in points]
    west, south, east, north = (
        min(longitudes),
        min(latitudes),
        max(longitudes),
        max(latitudes),
    )
    existing = version.spatial_coverage
    if existing and all(
        value is not None
        for value in (
            existing.min_longitude,
            existing.min_latitude,
            existing.max_longitude,
            existing.max_latitude,
        )
    ):
        west = min(west, existing.min_longitude)
        south = min(south, existing.min_latitude)
        east = max(east, existing.max_longitude)
        north = max(north, existing.max_latitude)
    if west == east and south == north:
        return SpatialCoverageInput(latitude=south, longitude=west)
    return SpatialCoverageInput(bbox=(west, south, east, north))


@router.post(
    "/datasets/{dataset_id}/records:batch",
    response_model=BatchAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_batch(
    dataset_id: str,
    payload: ObservationBatch,
    request: Request,
    idempotency_key: str = Header(min_length=8, max_length=255, alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> BatchAccepted:
    content_length = request.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > settings.max_batch_bytes:
                raise HTTPException(
                    status_code=413, detail="Batch exceeds the configured byte limit"
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header") from exc
    if len(payload.records) > settings.max_batch_records:
        raise HTTPException(status_code=413, detail="Batch exceeds the configured record limit")
    serialized_rows = [record.model_dump(mode="json", by_alias=True) for record in payload.records]
    body_size = sum(
        len(json.dumps(row, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) + 1
        for row in serialized_rows
    )
    if body_size > settings.max_batch_bytes:
        raise HTTPException(status_code=413, detail="Batch exceeds the configured byte limit")
    payload_hash = hashlib.sha256(
        json.dumps(serialized_rows, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()

    dataset = await load_dataset_full(session, dataset_id=dataset_id)
    if dataset is None or dataset.status in {DatasetStatus.ARCHIVED, DatasetStatus.QUARANTINED}:
        raise HTTPException(status_code=404, detail="Writable dataset not found")
    token = await authenticate_api_token(
        request, dataset_id, session, settings, required_scope="records:write"
    )
    existing = await session.scalar(
        select(IngestionJob).where(
            IngestionJob.dataset_id == dataset_id,
            IngestionJob.idempotency_key == idempotency_key,
        )
    )
    if existing:
        if existing.result.get("payload_sha256") != payload_hash:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key was already used with a different payload",
            ) from None
        if existing.status == JobStatus.PENDING and existing.resource_id:
            await session.commit()
            await enqueue_processing(existing.resource_id, existing.id)
            await session.refresh(existing)
        return BatchAccepted(
            job_id=existing.id,
            status=existing.status,
            record_count=int(existing.result.get("record_count", len(payload.records))),
            idempotent_replay=True,
        )

    # The unique constraint makes reservation atomic across API workers.
    job = IngestionJob(
        dataset_id=dataset.id,
        api_token_id=token.id,
        job_type="record_batch",
        idempotency_key=idempotency_key,
        result={"record_count": len(payload.records), "payload_sha256": payload_hash},
    )
    session.add(job)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        replay = await session.scalar(
            select(IngestionJob).where(
                IngestionJob.dataset_id == dataset_id,
                IngestionJob.idempotency_key == idempotency_key,
            )
        )
        if replay is None:
            raise
        if replay.result.get("payload_sha256") != payload_hash:
            raise HTTPException(
                status_code=409,
                detail="Idempotency-Key was already used with a different payload",
            ) from None
        return BatchAccepted(
            job_id=replay.id,
            status=replay.status,
            record_count=int(replay.result.get("record_count", len(payload.records))),
            idempotent_replay=True,
        )

    version = await _writable_version(session, dataset)
    resource_id = uuid_str()
    filename = f"batch-{job.id}.ndjson"
    key = f"datasets/{dataset.id}/versions/{version.id}/resources/{resource_id}/original/{filename}"
    descriptor, raw_path = tempfile.mkstemp(prefix="oidt-batch-", suffix=".ndjson")
    os.close(descriptor)
    temp_path = Path(raw_path)
    try:
        digest = hashlib.sha256()
        with temp_path.open("wb") as output:
            for row in serialized_rows:
                encoded = (
                    json.dumps(row, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
                    + b"\n"
                )
                digest.update(encoded)
                output.write(encoded)
        projected_usage = (
            await account_usage_bytes(session, dataset.owner_subject) + temp_path.stat().st_size
        )
        if projected_usage > settings.max_account_bytes:
            raise HTTPException(status_code=413, detail="Account storage quota exceeded")
        storage = get_storage(settings)
        await storage.put_path(key, temp_path, "application/x-ndjson")
        resource = Resource(
            id=resource_id,
            version=version,
            kind="rest_batch",
            name=filename,
            original_filename=filename,
            media_type="application/x-ndjson",
            format="ndjson",
            storage_backend=storage.backend_name,
            original_key=key,
            checksum_sha256=digest.hexdigest(),
            byte_size=temp_path.stat().st_size,
        )
        session.add(resource)
        await session.flush()
        job.resource_id = resource.id
        coverage = _batch_spatial_coverage(version, payload)
        if coverage:
            apply_spatial_coverage(version, coverage)
            session.add(version.spatial_coverage)
        if dataset.status != DatasetStatus.PUBLISHED:
            dataset.status = DatasetStatus.UPLOADING
        audit(
            session,
            "records.batch_accepted",
            "resource",
            resource.id,
            f"api-token:{token.prefix}",
            client_ip(request),
            {
                "job_id": job.id,
                "record_count": len(payload.records),
                "idempotency_key": idempotency_key,
            },
        )
        await session.commit()
    except Exception:
        await session.rollback()
        # The storage object is immutable but may be orphaned if DB commit fails; remove it safely.
        storage = get_storage(settings)
        await storage.delete(key)
        raise
    finally:
        temp_path.unlink(missing_ok=True)

    job_key = job.id
    await enqueue_processing(resource_id, job_key)
    session.expire_all()
    refreshed = await session.get(IngestionJob, job_key)
    return BatchAccepted(
        job_id=job_key,
        status=refreshed.status if refreshed else JobStatus.PENDING,
        record_count=len(payload.records),
        idempotent_replay=False,
    )
