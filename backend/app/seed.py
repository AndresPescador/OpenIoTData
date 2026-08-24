from __future__ import annotations

import asyncio
import hashlib
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.db.models import (
    Dataset,
    DatasetStatus,
    DatasetVersion,
    IngestionJob,
    JobStatus,
    Resource,
    ResourceStatus,
    SemanticMapping,
    VersionStatus,
)
from app.db.session import SessionLocal, close_database, initialize_database
from app.schemas import SpatialCoverageInput, TemporalCoverageInput
from app.services.catalog import apply_spatial_coverage, apply_temporal_coverage
from app.services.processing import process_resource
from app.services.storage import get_storage

DEMO_SLUG = "ruido-ambiental-bogota-demostracion"


async def seed() -> None:
    await initialize_database()
    storage = get_storage()
    await storage.ensure_ready()
    async with SessionLocal() as session:
        if await session.scalar(select(Dataset.id).where(Dataset.slug == DEMO_SLUG)):
            print(f"Demo seed already exists: {DEMO_SLUG}")
            return
        dataset = Dataset(
            owner_subject="seed:openiotdata",
            title="Ruido ambiental en Bogotá — demostración",
            slug=DEMO_SLUG,
            description=(
                "Dataset ilustrativo para validar OpenIoTData. No representa mediciones "
                "oficiales ni ha sido validado científicamente."
            ),
            topic="ruido",
            tags=["ruido", "bogotá", "demostración"],
            license="CC BY 4.0",
        )
        version = DatasetVersion(number=1, changelog="Datos ilustrativos iniciales")
        dataset.versions.append(version)
        apply_spatial_coverage(version, SpatialCoverageInput(latitude=4.711, longitude=-74.0721))
        apply_temporal_coverage(
            version,
            TemporalCoverageInput(
                starts_at=datetime(2026, 8, 1, tzinfo=UTC),
                ends_at=datetime(2026, 8, 1, 2, tzinfo=UTC),
                frequency="1 hora",
            ),
        )
        session.add(dataset)
        await session.flush()
        csv_data = (
            b"observed_at,sensor_id,leq_db,latitude,longitude\n"
            b"2026-08-01T00:00:00Z,BOG-DEMO-01,62.4,4.7110,-74.0721\n"
            b"2026-08-01T01:00:00Z,BOG-DEMO-01,65.1,4.7110,-74.0721\n"
            b"2026-08-01T02:00:00Z,BOG-DEMO-01,59.8,4.7110,-74.0721\n"
        )
        # Defaults are applied on INSERT, so allocate explicitly for the object key.
        from app.db.base import uuid_str

        resource_id = uuid_str()
        key = (
            f"datasets/{dataset.id}/versions/{version.id}/resources/"
            f"{resource_id}/original/resource.csv"
        )
        with tempfile.NamedTemporaryFile(
            prefix="oidt-seed-", suffix=".csv", delete=False
        ) as source:
            source.write(csv_data)
            source_path = Path(source.name)
        try:
            await storage.put_path(key, source_path, "text/csv")
        finally:
            source_path.unlink(missing_ok=True)
        resource = Resource(
            id=resource_id,
            version=version,
            name="demo.csv",
            original_filename="demo.csv",
            media_type="text/csv",
            format="csv",
            storage_backend=storage.backend_name,
            original_key=key,
            checksum_sha256=hashlib.sha256(csv_data).hexdigest(),
            byte_size=len(csv_data),
        )
        job = IngestionJob(
            dataset_id=dataset.id,
            resource=resource,
            job_type="resource_processing",
        )
        session.add_all([resource, job])
        await session.commit()
    await process_resource(resource.id, job.id)
    async with SessionLocal() as session:
        processed_resource = await session.get(Resource, resource.id)
        processed_job = await session.get(IngestionJob, job.id)
        if (
            processed_resource is None
            or processed_resource.status != ResourceStatus.READY
            or processed_job is None
            or processed_job.status != JobStatus.SUCCEEDED
        ):
            error = processed_resource.error_message if processed_resource else "resource missing"
            raise RuntimeError(f"Demo resource processing failed: {error}")
        dataset = await session.scalar(select(Dataset).where(Dataset.slug == DEMO_SLUG))
        version = await session.scalar(
            select(DatasetVersion).where(DatasetVersion.dataset_id == dataset.id)
        )
        now = datetime.now(UTC)
        dataset.status = DatasetStatus.PUBLISHED
        dataset.published_at = now
        version.status = VersionStatus.PUBLISHED
        version.is_current = True
        version.published_at = now
        session.add(
            SemanticMapping(
                version_id=version.id,
                resource_id=processed_resource.id,
                observed_at_field="observed_at",
                latitude_field="latitude",
                longitude_field="longitude",
                sensor_id_field="sensor_id",
                variable_units={"leq_db": "dB"},
            )
        )
        await session.commit()
    print(f"Created illustrative demo dataset: {DEMO_SLUG}")


async def main() -> None:
    try:
        await seed()
    finally:
        await close_database()


if __name__ == "__main__":
    asyncio.run(main())
