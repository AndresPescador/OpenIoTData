from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Dataset, DatasetVersion, Resource, SchemaProfile


def dataset_graph_options() -> tuple[object, ...]:
    return (
        selectinload(Dataset.versions)
        .selectinload(DatasetVersion.resources)
        .selectinload(Resource.schema_profile)
        .selectinload(SchemaProfile.fields),
        selectinload(Dataset.versions).selectinload(DatasetVersion.spatial_coverage),
        selectinload(Dataset.versions).selectinload(DatasetVersion.temporal_coverage),
        selectinload(Dataset.versions).selectinload(DatasetVersion.semantic_mappings),
    )


async def load_dataset_full(
    session: AsyncSession, *, dataset_id: str | None = None, slug: str | None = None
) -> Dataset | None:
    statement = select(Dataset).options(*dataset_graph_options())
    if dataset_id is not None:
        statement = statement.where(Dataset.id == dataset_id)
    elif slug is not None:
        statement = statement.where(Dataset.slug == slug)
    else:
        raise ValueError("dataset_id or slug is required")
    return await session.scalar(statement)


def current_version(dataset: Dataset) -> DatasetVersion | None:
    current = next((version for version in dataset.versions if version.is_current), None)
    if current:
        return current
    return max(dataset.versions, key=lambda version: version.number) if dataset.versions else None
