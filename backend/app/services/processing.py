from __future__ import annotations

import asyncio
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.db.models import (
    Dataset,
    DatasetStatus,
    DatasetVersion,
    IngestionJob,
    JobStatus,
    Resource,
    ResourceField,
    ResourceStatus,
    SchemaProfile,
    VersionStatus,
)
from app.db.session import SessionLocal
from app.services.inference import infer_and_normalize
from app.services.storage import UnsafeUpload, get_storage, scan_for_malware


def utcnow() -> datetime:
    return datetime.now(UTC)


async def process_resource(resource_id: str, job_id: str | None = None) -> None:
    settings = get_settings()
    storage = get_storage(settings)
    async with SessionLocal() as session:
        resource = await session.scalar(select(Resource).where(Resource.id == resource_id))
        if resource is None:
            raise LookupError(f"Resource {resource_id} does not exist")
        job = await session.get(IngestionJob, job_id) if job_id else None
        resource.status = ResourceStatus.PROCESSING
        if job:
            job.status = JobStatus.RUNNING
            job.progress = 10
            job.started_at = utcnow()
        version = await session.get(DatasetVersion, resource.version_id)
        if version:
            if version.status != VersionStatus.PUBLISHED:
                version.status = VersionStatus.PROCESSING
            dataset = await session.get(Dataset, version.dataset_id)
            if dataset and dataset.status != DatasetStatus.PUBLISHED:
                dataset.status = DatasetStatus.PROCESSING
        await session.commit()

    normalized_key = f"normalized/{resource_id}.parquet"
    try:
        with tempfile.TemporaryDirectory(prefix="oidt-process-") as raw_directory:
            output_path = Path(raw_directory) / "normalized.parquet"
            async with storage.materialize(resource.original_key) as input_path:
                await scan_for_malware(input_path, settings)
                result = await asyncio.to_thread(
                    infer_and_normalize,
                    input_path,
                    output_path,
                    resource.format,
                    settings.max_inferred_rows,
                    settings.max_inferred_columns,
                    settings.max_parquet_logical_bytes,
                    settings.max_tabular_inference_bytes,
                )
            await storage.put_path(normalized_key, output_path, "application/vnd.apache.parquet")

        async with SessionLocal() as session:
            resource = await session.scalar(
                select(Resource)
                .where(Resource.id == resource_id)
                .options(
                    selectinload(Resource.version).selectinload(DatasetVersion.resources),
                    selectinload(Resource.version).selectinload(DatasetVersion.dataset),
                    selectinload(Resource.schema_profile),
                )
            )
            if resource is None:
                return
            if resource.schema_profile:
                await session.delete(resource.schema_profile)
                await session.flush()
            profile = SchemaProfile(
                resource=resource,
                row_count=result.row_count,
                column_count=result.column_count,
                quality_summary=result.quality_summary,
            )
            session.add(profile)
            profile.fields = [
                ResourceField(
                    position=field.position,
                    name=field.name,
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
                for field in result.fields
            ]
            resource.schema_profile = profile
            resource.normalized_key = normalized_key
            resource.row_count = result.row_count
            resource.status = ResourceStatus.READY
            resource.error_message = None
            version = resource.version
            if all(item.status == ResourceStatus.READY for item in version.resources):
                if version.status != VersionStatus.PUBLISHED:
                    version.status = VersionStatus.READY
                if version.dataset.status != DatasetStatus.PUBLISHED:
                    version.dataset.status = DatasetStatus.READY
            job = await session.get(IngestionJob, job_id) if job_id else None
            if job:
                job.status = JobStatus.SUCCEEDED
                job.progress = 100
                job.finished_at = utcnow()
                job.result = {
                    **job.result,
                    "resource_id": resource_id,
                    "row_count": result.row_count,
                    "column_count": result.column_count,
                    "normalized_format": "parquet",
                }
            await session.commit()
    except Exception as exc:
        async with SessionLocal() as session:
            resource = await session.get(Resource, resource_id)
            if resource:
                resource.status = (
                    ResourceStatus.QUARANTINED
                    if isinstance(exc, UnsafeUpload)
                    else ResourceStatus.FAILED
                )
                resource.error_message = str(exc)[:2_000]
                version = await session.get(DatasetVersion, resource.version_id)
                if version:
                    if version.status != VersionStatus.PUBLISHED:
                        version.status = VersionStatus.FAILED
                    dataset = await session.get(Dataset, version.dataset_id)
                    if dataset and dataset.status != DatasetStatus.PUBLISHED:
                        dataset.status = (
                            DatasetStatus.QUARANTINED
                            if isinstance(exc, UnsafeUpload)
                            else DatasetStatus.FAILED
                        )
            job = await session.get(IngestionJob, job_id) if job_id else None
            if job:
                job.status = JobStatus.FAILED
                job.error_message = str(exc)[:2_000]
                job.finished_at = utcnow()
            await session.commit()


async def create_processing_job(resource: Resource, dataset_id: str) -> IngestionJob:
    async with SessionLocal() as session:
        job = IngestionJob(
            dataset_id=dataset_id,
            resource_id=resource.id,
            job_type="resource_processing",
        )
        session.add(job)
        await session.commit()
        await session.refresh(job)
        return job


async def enqueue_processing(resource_id: str, job_id: str) -> None:
    settings = get_settings()
    if settings.celery_task_always_eager:
        await process_resource(resource_id, job_id)
        return
    from app.worker import process_resource_task

    process_resource_task.delay(resource_id, job_id)
