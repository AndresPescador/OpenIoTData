from __future__ import annotations

import asyncio
import hashlib
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import dataset_graph_options, load_dataset_full
from app.core.config import Settings, get_settings
from app.core.security import client_ip, create_api_token, require_user
from app.db.base import uuid_str
from app.db.models import (
    ApiToken,
    Dataset,
    DatasetStatus,
    DatasetVersion,
    IngestionJob,
    JobStatus,
    Resource,
    ResourceStatus,
    SchemaProfile,
    SemanticMapping,
    SpatialCoverage,
    TemporalCoverage,
    VersionStatus,
)
from app.db.session import get_session
from app.schemas import (
    ApiTokenCreate,
    ApiTokenCreated,
    ConfirmResourceRequest,
    CurrentUser,
    DatasetCreate,
    DatasetDetail,
    DatasetUpdate,
    JobRead,
    PresignUploadRequest,
    PresignUploadResponse,
    SemanticMappingInput,
    VersionCreate,
)
from app.services.catalog import (
    account_usage_bytes,
    apply_spatial_coverage,
    apply_temporal_coverage,
    audit,
    dataset_detail,
    ensure_owner,
    geometry_to_ewkt,
    now_utc,
    resource_read,
    unique_slug,
)
from app.services.processing import enqueue_processing
from app.services.storage import (
    UnsafeUpload,
    get_storage,
    normalize_extension,
    scan_for_malware,
    spool_upload,
    validate_magic,
)

router = APIRouter(prefix="/api/v1", tags=["dataset management"])


def _ensure_mutable(version: DatasetVersion) -> None:
    if version.status in {VersionStatus.PUBLISHED, VersionStatus.ARCHIVED}:
        raise HTTPException(status_code=409, detail="Published versions are immutable")


async def _owned_dataset(session: AsyncSession, dataset_id: str, user: CurrentUser) -> Dataset:
    dataset = await load_dataset_full(session, dataset_id=dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    ensure_owner(dataset, user.subject)
    return dataset


@router.get("/me/datasets", response_model=list[DatasetDetail])
async def my_datasets(
    user: CurrentUser = Depends(require_user), session: AsyncSession = Depends(get_session)
) -> list[DatasetDetail]:
    datasets = list(
        (
            await session.scalars(
                select(Dataset)
                .where(Dataset.owner_subject == user.subject)
                .options(*dataset_graph_options())
                .order_by(Dataset.updated_at.desc())
            )
        ).unique()
    )
    return [dataset_detail(dataset) for dataset in datasets]


@router.get("/datasets/{dataset_id}/manage", response_model=DatasetDetail)
async def manage_dataset(
    dataset_id: str,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> DatasetDetail:
    return dataset_detail(await _owned_dataset(session, dataset_id, user))


@router.post("/datasets", response_model=DatasetDetail, status_code=201)
async def create_dataset(
    payload: DatasetCreate,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> DatasetDetail:
    dataset = Dataset(
        owner_subject=user.subject,
        title=payload.title.strip(),
        slug=await unique_slug(session, payload.slug or payload.title),
        description=payload.description,
        topic=payload.topic,
        tags=payload.tags,
        license=payload.license,
    )
    version = DatasetVersion(number=1, changelog="Versión inicial")
    dataset.versions.append(version)
    apply_spatial_coverage(version, payload.spatial_coverage)
    apply_temporal_coverage(version, payload.temporal_coverage)
    session.add(dataset)
    # Add optional one-to-one coverage rows explicitly. This keeps the behavior
    # deterministic across SQLAlchemy's async relationship loading strategies.
    if version.spatial_coverage:
        session.add(version.spatial_coverage)
    if version.temporal_coverage:
        session.add(version.temporal_coverage)
    await session.flush()
    audit(
        session,
        "dataset.created",
        "dataset",
        dataset.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()
    created = await load_dataset_full(session, dataset_id=dataset.id)
    assert created is not None
    return dataset_detail(created)


@router.patch("/datasets/{dataset_id}", response_model=DatasetDetail)
async def update_dataset(
    dataset_id: str,
    payload: DatasetUpdate,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> DatasetDetail:
    dataset = await _owned_dataset(session, dataset_id, user)
    if dataset.status == DatasetStatus.PUBLISHED:
        raise HTTPException(
            status_code=409,
            detail="Published catalog metadata is immutable in v1",
        )
    values = payload.model_dump(
        exclude_unset=True, exclude={"spatial_coverage", "temporal_coverage"}
    )
    if "tags" in values and values["tags"] is not None:
        values["tags"] = list(
            dict.fromkeys(tag.strip().lower() for tag in values["tags"] if tag.strip())
        )
    for field, value in values.items():
        setattr(dataset, field, value)
    version = max(dataset.versions, key=lambda item: item.number)
    if payload.spatial_coverage is not None or payload.temporal_coverage is not None:
        _ensure_mutable(version)
        apply_spatial_coverage(version, payload.spatial_coverage)
        apply_temporal_coverage(version, payload.temporal_coverage)
        if version.spatial_coverage:
            session.add(version.spatial_coverage)
        if version.temporal_coverage:
            session.add(version.temporal_coverage)
    audit(
        session,
        "dataset.updated",
        "dataset",
        dataset.id,
        user.subject,
        client_ip(request),
        {"fields": list(payload.model_fields_set)},
    )
    await session.commit()
    updated = await load_dataset_full(session, dataset_id=dataset.id)
    assert updated is not None
    return dataset_detail(updated)


@router.post("/datasets/{dataset_id}/versions", response_model=DatasetDetail, status_code=201)
async def create_version(
    dataset_id: str,
    payload: VersionCreate,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> DatasetDetail:
    dataset = await _owned_dataset(session, dataset_id, user)
    previous = max(dataset.versions, key=lambda item: item.number) if dataset.versions else None
    version = DatasetVersion(
        dataset=dataset,
        number=(previous.number + 1) if previous else 1,
        changelog=payload.changelog,
    )
    if previous and previous.spatial_coverage:
        source = previous.spatial_coverage
        version.spatial_coverage = SpatialCoverage(
            geometry=source.geometry,
            geom=geometry_to_ewkt(source.geometry),
            crs=source.crs,
            centroid_latitude=source.centroid_latitude,
            centroid_longitude=source.centroid_longitude,
            min_latitude=source.min_latitude,
            min_longitude=source.min_longitude,
            max_latitude=source.max_latitude,
            max_longitude=source.max_longitude,
            precision_reduced=source.precision_reduced,
        )
    if previous and previous.temporal_coverage:
        source_time = previous.temporal_coverage
        version.temporal_coverage = TemporalCoverage(
            starts_at=source_time.starts_at,
            ends_at=source_time.ends_at,
            frequency=source_time.frequency,
            timezone_name=source_time.timezone_name,
        )
    session.add(version)
    if version.spatial_coverage:
        session.add(version.spatial_coverage)
    if version.temporal_coverage:
        session.add(version.temporal_coverage)
    audit(
        session,
        "dataset.version_created",
        "dataset_version",
        version.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()
    updated = await load_dataset_full(session, dataset_id=dataset.id)
    assert updated is not None
    return dataset_detail(updated)


@router.put("/datasets/{dataset_id}/versions/{version_id}/mapping", status_code=204)
async def set_semantic_mapping(
    dataset_id: str,
    version_id: str,
    payload: SemanticMappingInput,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    dataset = await _owned_dataset(session, dataset_id, user)
    version = next((item for item in dataset.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Dataset version not found")
    _ensure_mutable(version)
    resource = next((item for item in version.resources if item.id == payload.resource_id), None)
    if resource is None or resource.schema_profile is None:
        raise HTTPException(status_code=404, detail="Processed resource not found")
    known_fields = {field.name for field in resource.schema_profile.fields}
    mapped_fields = {
        payload.observed_at_field,
        payload.latitude_field,
        payload.longitude_field,
        payload.sensor_id_field,
        *payload.variable_units.keys(),
    } - {None}
    unknown = mapped_fields - known_fields
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown mapped fields: {sorted(unknown)}")
    mapping = next(
        (item for item in version.semantic_mappings if item.resource_id == resource.id), None
    ) or SemanticMapping(version=version, resource_id=resource.id)
    mapping.observed_at_field = payload.observed_at_field
    mapping.latitude_field = payload.latitude_field
    mapping.longitude_field = payload.longitude_field
    mapping.sensor_id_field = payload.sensor_id_field
    mapping.variable_units = payload.variable_units
    mapping.crs = payload.crs
    session.add(mapping)
    audit(
        session,
        "dataset.mapping_updated",
        "dataset_version",
        version.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()


@router.post("/datasets/{dataset_id}/versions/{version_id}/resources", status_code=201)
async def upload_resource(
    dataset_id: str,
    version_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, object]:
    dataset = await _owned_dataset(session, dataset_id, user)
    version = next((item for item in dataset.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Dataset version not found")
    _ensure_mutable(version)
    safe_filename = Path(file.filename or "resource").name
    temp_path: Path | None = None
    try:
        resource_format = normalize_extension(safe_filename, settings.allowed_extensions)
        temp_path, size, checksum, sample = await spool_upload(file, settings.max_upload_bytes)
        validate_magic(sample, resource_format)
        await scan_for_malware(temp_path, settings)
    except UnsafeUpload as exc:
        if temp_path:
            temp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        usage = await account_usage_bytes(session, user.subject)
        if usage + size > settings.max_account_bytes:
            raise HTTPException(status_code=413, detail="Account storage quota exceeded")
        resource_id = uuid_str()
        key = (
            f"datasets/{dataset.id}/versions/{version.id}/resources/"
            f"{resource_id}/original/resource.{resource_format}"
        )
        storage = get_storage(settings)
        await storage.put_path(key, temp_path, file.content_type)
        resource = Resource(
            id=resource_id,
            version=version,
            name=safe_filename,
            original_filename=safe_filename,
            media_type=file.content_type,
            format=resource_format,
            storage_backend=storage.backend_name,
            original_key=key,
            checksum_sha256=checksum,
            byte_size=size,
        )
        job = IngestionJob(
            dataset_id=dataset.id,
            resource=resource,
            job_type="resource_processing",
        )
        session.add_all([resource, job])
        dataset.status = DatasetStatus.UPLOADING
        audit(
            session,
            "resource.uploaded",
            "resource",
            resource.id,
            user.subject,
            client_ip(request),
            {"checksum_sha256": checksum, "byte_size": size},
        )
        await session.commit()
        resource_key = resource.id
        job_key = job.id
        await enqueue_processing(resource_key, job_key)
        session.expire_all()
        refreshed = await session.scalar(
            select(Resource)
            .where(Resource.id == resource_key)
            .options(selectinload(Resource.schema_profile).selectinload(SchemaProfile.fields))
        )
        refreshed_job = await session.get(IngestionJob, job_key)
        return {
            "resource": resource_read(refreshed) if refreshed else {"id": resource_key},
            "job": _job_read(refreshed_job) if refreshed_job else {"id": job_key},
        }
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


@router.post(
    "/datasets/{dataset_id}/versions/{version_id}/uploads/presign",
    response_model=PresignUploadResponse,
    status_code=201,
)
async def presign_resource_upload(
    dataset_id: str,
    version_id: str,
    payload: PresignUploadRequest,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> PresignUploadResponse:
    dataset = await _owned_dataset(session, dataset_id, user)
    version = next((item for item in dataset.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Dataset version not found")
    _ensure_mutable(version)
    if payload.byte_size > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Upload exceeds the configured limit")
    projected_usage = await account_usage_bytes(session, user.subject) + payload.byte_size
    if projected_usage > settings.max_account_bytes:
        raise HTTPException(status_code=413, detail="Account storage quota exceeded")
    safe_filename = Path(payload.filename).name
    try:
        resource_format = normalize_extension(safe_filename, settings.allowed_extensions)
    except UnsafeUpload as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    storage = get_storage(settings)
    if storage.backend_name != "s3":
        raise HTTPException(status_code=409, detail="Use the multipart resource endpoint locally")
    resource_id = uuid_str()
    key = f"staging/uploads/{resource_id}"
    resource = Resource(
        id=resource_id,
        version=version,
        kind="presigned_pending",
        name=safe_filename,
        original_filename=safe_filename,
        media_type=payload.media_type,
        format=resource_format,
        storage_backend=storage.backend_name,
        original_key=key,
        checksum_sha256=payload.checksum_sha256.lower(),
        byte_size=payload.byte_size,
    )
    session.add(resource)
    audit(
        session,
        "resource.upload_presigned",
        "resource",
        resource.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()
    url = await storage.presign_upload(key, payload.media_type, payload.byte_size, expires=900)
    headers = {"Content-Length": str(payload.byte_size)}
    if payload.media_type:
        headers["Content-Type"] = payload.media_type
    return PresignUploadResponse(
        resource_id=resource.id,
        upload_url=url,
        method="PUT",
        headers=headers,
        expires_in=900,
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


@router.post("/datasets/{dataset_id}/resources/{resource_id}/confirm", response_model=JobRead)
async def confirm_resource(
    dataset_id: str,
    resource_id: str,
    payload: ConfirmResourceRequest,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> JobRead:
    dataset = await _owned_dataset(session, dataset_id, user)
    resource = next(
        (
            resource
            for version in dataset.versions
            for resource in version.resources
            if resource.id == resource_id
        ),
        None,
    )
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found")
    if resource.kind != "presigned_pending":
        raise HTTPException(status_code=409, detail="Resource was already confirmed")
    _ensure_mutable(resource.version)
    storage = get_storage(settings)
    if not await storage.exists(resource.original_key):
        raise HTTPException(status_code=409, detail="Uploaded object is not available")
    actual_size = await storage.size(resource.original_key)
    expected_size = payload.byte_size or resource.byte_size
    if actual_size != expected_size or actual_size > settings.max_upload_bytes:
        raise HTTPException(status_code=422, detail="Uploaded object size does not match")
    staging_key = resource.original_key
    final_key = (
        f"datasets/{dataset.id}/versions/{resource.version_id}/resources/"
        f"{resource.id}/original/resource.{resource.format}"
    )
    await storage.promote(staging_key, final_key)
    try:
        async with storage.materialize(final_key) as path:
            actual_checksum = await asyncio.to_thread(_sha256_file, path)

            def read_sample() -> bytes:
                with path.open("rb") as source:
                    return source.read(8192)

            sample = await asyncio.to_thread(read_sample)
            try:
                validate_magic(sample, resource.format)
            except UnsafeUpload as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
        expected_checksum = (payload.checksum_sha256 or resource.checksum_sha256).lower()
        if actual_checksum != expected_checksum:
            raise HTTPException(status_code=422, detail="Uploaded object checksum does not match")
    except Exception:
        await storage.delete(final_key)
        raise
    resource.byte_size = actual_size
    resource.checksum_sha256 = actual_checksum
    resource.original_key = final_key
    resource.kind = "file"
    job = IngestionJob(dataset_id=dataset.id, resource=resource, job_type="resource_processing")
    session.add(job)
    audit(
        session,
        "resource.confirmed",
        "resource",
        resource.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()
    resource_key = resource.id
    job_key = job.id
    await enqueue_processing(resource_key, job_key)
    session.expire_all()
    refreshed = await session.get(IngestionJob, job_key)
    assert refreshed is not None
    return _job_read(refreshed)


@router.post("/datasets/{dataset_id}/versions/{version_id}/publish", response_model=DatasetDetail)
async def publish_version(
    dataset_id: str,
    version_id: str,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> DatasetDetail:
    dataset = await _owned_dataset(session, dataset_id, user)
    version = next((item for item in dataset.versions if item.id == version_id), None)
    if version is None:
        raise HTTPException(status_code=404, detail="Dataset version not found")
    _ensure_mutable(version)
    if not dataset.license:
        raise HTTPException(status_code=422, detail="An explicit license is required")
    if not version.resources or any(
        resource.status != ResourceStatus.READY for resource in version.resources
    ):
        raise HTTPException(status_code=409, detail="Every resource must finish processing")
    now = now_utc()
    for item in dataset.versions:
        item.is_current = item.id == version.id
    version.status = VersionStatus.PUBLISHED
    version.published_at = now
    dataset.status = DatasetStatus.PUBLISHED
    dataset.published_at = dataset.published_at or now
    audit(
        session,
        "dataset.published",
        "dataset_version",
        version.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()
    published = await load_dataset_full(session, dataset_id=dataset.id)
    assert published is not None
    return dataset_detail(published)


@router.post("/datasets/{dataset_id}/archive", status_code=204)
async def archive_dataset(
    dataset_id: str,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    dataset = await _owned_dataset(session, dataset_id, user)
    dataset.status = DatasetStatus.ARCHIVED
    audit(
        session,
        "dataset.archived",
        "dataset",
        dataset.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()


@router.post("/datasets/{dataset_id}/tokens", response_model=ApiTokenCreated, status_code=201)
async def issue_api_token(
    dataset_id: str,
    payload: ApiTokenCreate,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ApiTokenCreated:
    dataset = await _owned_dataset(session, dataset_id, user)
    raw, prefix, digest = create_api_token(settings)
    token = ApiToken(
        dataset=dataset,
        owner_subject=user.subject,
        name=payload.name,
        prefix=prefix,
        token_hash=digest,
        scopes=list(payload.scopes),
        expires_at=payload.expires_at,
    )
    session.add(token)
    audit(
        session,
        "api_token.created",
        "api_token",
        token.id,
        user.subject,
        client_ip(request),
        {"dataset_id": dataset.id, "scopes": token.scopes},
    )
    await session.commit()
    return ApiTokenCreated(
        id=token.id,
        name=token.name,
        prefix=token.prefix,
        token=raw,
        scopes=token.scopes,
        expires_at=token.expires_at,
    )


@router.delete("/datasets/{dataset_id}/tokens/{token_id}", status_code=204)
async def revoke_api_token(
    dataset_id: str,
    token_id: str,
    request: Request,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await _owned_dataset(session, dataset_id, user)
    token = await session.scalar(
        select(ApiToken).where(ApiToken.id == token_id, ApiToken.dataset_id == dataset_id)
    )
    if token is None:
        raise HTTPException(status_code=404, detail="API token not found")
    token.revoked_at = datetime.now(UTC)
    audit(
        session,
        "api_token.revoked",
        "api_token",
        token.id,
        user.subject,
        client_ip(request),
    )
    await session.commit()


@router.get("/jobs/{job_id}", response_model=JobRead)
async def get_job(
    job_id: str,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> JobRead:
    job = await session.get(IngestionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    dataset = await session.get(Dataset, job.dataset_id)
    if dataset is None or dataset.owner_subject != user.subject:
        raise HTTPException(status_code=403, detail="You cannot inspect this job")
    return _job_read(job)


@router.post("/jobs/{job_id}/retry", response_model=JobRead)
async def retry_job(
    job_id: str,
    user: CurrentUser = Depends(require_user),
    session: AsyncSession = Depends(get_session),
) -> JobRead:
    job = await session.get(IngestionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    dataset = await session.get(Dataset, job.dataset_id)
    if dataset is None or dataset.owner_subject != user.subject:
        raise HTTPException(status_code=403, detail="You cannot retry this job")
    if not job.resource_id or job.status not in {JobStatus.PENDING, JobStatus.FAILED}:
        raise HTTPException(status_code=409, detail="This job is not retryable")
    job.status = JobStatus.PENDING
    job.progress = 0
    job.error_message = None
    await session.commit()
    resource_id = job.resource_id
    await enqueue_processing(resource_id, job.id)
    await session.refresh(job)
    return _job_read(job)


def _job_read(job: IngestionJob) -> JobRead:
    return JobRead(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        progress=job.progress,
        resource_id=job.resource_id,
        result=job.result,
        error_message=job.error_message,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )
