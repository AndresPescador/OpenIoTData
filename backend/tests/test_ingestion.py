from __future__ import annotations

from httpx import AsyncClient

from app.db.models import IngestionJob, JobStatus, Resource, ResourceStatus
from app.db.session import SessionLocal


async def test_scoped_batch_token_is_append_only_and_idempotent(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    issued = await client.post(
        f"/api/v1/datasets/{published_dataset['id']}/tokens",
        headers={"X-Dev-User": "publisher-one"},
        json={"name": "Estación BOG-02", "scopes": ["records:write"]},
    )
    assert issued.status_code == 201, issued.text
    raw_token = issued.json()["token"]
    payload = {
        "records": [
            {
                "observed_at": "2026-08-01T02:00:00Z",
                "sensor_id": "BOG-AIR-02",
                "data": {"pm25": 17.3, "battery": 82},
                "location": {"type": "Point", "coordinates": [-74.07, 4.713]},
                "metadata": {"firmware": "1.2.0"},
            }
        ]
    }
    headers = {"Authorization": f"Bearer {raw_token}", "Idempotency-Key": "batch-00000001"}
    accepted = await client.post(
        f"/api/v1/datasets/{published_dataset['id']}/records:batch",
        headers=headers,
        json=payload,
    )
    assert accepted.status_code == 202, accepted.text
    assert accepted.json()["status"] == "succeeded"
    assert accepted.json()["idempotent_replay"] is False

    replay = await client.post(
        f"/api/v1/datasets/{published_dataset['id']}/records:batch",
        headers=headers,
        json=payload,
    )
    assert replay.status_code == 202
    assert replay.json()["job_id"] == accepted.json()["job_id"]
    assert replay.json()["idempotent_replay"] is True

    changed = {"records": [dict(payload["records"][0], data={"pm25": 99})]}
    conflict = await client.post(
        f"/api/v1/datasets/{published_dataset['id']}/records:batch",
        headers=headers,
        json=changed,
    )
    assert conflict.status_code == 409

    managed = await client.get(
        f"/api/v1/datasets/{published_dataset['id']}/manage",
        headers={"X-Dev-User": "publisher-one"},
    )
    versions = managed.json()["versions"]
    version_one = next(version for version in versions if version["number"] == 1)
    version_two = next(version for version in versions if version["number"] == 2)
    assert version_one["status"] == "published"
    assert len(version_one["resources"]) == 1
    assert version_two["status"] == "ready"

    publish_snapshot = await client.post(
        f"/api/v1/datasets/{published_dataset['id']}/versions/{version_two['id']}/publish",
        headers={"X-Dev-User": "publisher-one"},
    )
    assert publish_snapshot.status_code == 200, publish_snapshot.text

    points = await client.get(f"/api/v1/datasets/{published_dataset['slug']}/points")
    assert points.status_code == 200, points.text
    sensors = {feature["properties"]["sensor_id"] for feature in points.json()["features"]}
    assert "BOG-AIR-02" in sensors

    old_download = await client.get(
        f"/api/v1/datasets/{published_dataset['slug']}/versions/1/resources/"
        f"{published_dataset['resource_id']}/download"
    )
    assert old_download.status_code == 200
    assert old_download.content == published_dataset["csv_data"]


async def test_batch_rejects_wrong_dataset_scope(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    response = await client.post(
        "/api/v1/datasets/not-a-dataset/records:batch",
        headers={"Authorization": "Bearer oidt_bad_bad", "Idempotency-Key": "batch-00000002"},
        json={
            "records": [
                {
                    "observed_at": "2026-08-01T00:00:00Z",
                    "data": {"value": 1},
                }
            ]
        },
    )
    assert response.status_code == 404


async def test_owner_can_recover_a_failed_or_orphaned_job(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    async with SessionLocal() as session:
        job = await session.get(IngestionJob, published_dataset["job_id"])
        resource = await session.get(Resource, published_dataset["resource_id"])
        job.status = JobStatus.PENDING
        job.error_message = "simulated broker interruption before dispatch"
        resource.status = ResourceStatus.UPLOADED
        await session.commit()

    recovered = await client.post(
        f"/api/v1/jobs/{published_dataset['job_id']}/retry",
        headers={"X-Dev-User": "publisher-one"},
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["status"] == "succeeded"


async def test_owner_can_manage_draft_versions_and_revoke_tokens(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    dataset_id = published_dataset["id"]
    owner = {"X-Dev-User": "publisher-one"}

    mine = await client.get("/api/v1/me/datasets", headers=owner)
    assert mine.status_code == 200
    assert any(item["id"] == dataset_id for item in mine.json())
    managed = await client.get(f"/api/v1/datasets/{dataset_id}/manage", headers=owner)
    assert managed.status_code == 200

    # A published catalog is immutable, while a new working version is allowed.
    new_version = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        headers=owner,
        json={"changelog": "Datos de enero"},
    )
    assert new_version.status_code == 201, new_version.text
    assert new_version.json()["versions"][-1]["number"] == 2

    token_response = await client.post(
        f"/api/v1/datasets/{dataset_id}/tokens",
        headers=owner,
        json={"name": "revocable", "scopes": ["records:write"]},
    )
    assert token_response.status_code == 201
    token_id = token_response.json()["id"]
    assert token_response.json()["token"].startswith("oidt_")
    revoked = await client.delete(
        f"/api/v1/datasets/{dataset_id}/tokens/{token_id}", headers=owner
    )
    assert revoked.status_code == 204
    assert (
        await client.delete(f"/api/v1/datasets/{dataset_id}/tokens/not-found", headers=owner)
    ).status_code == 404


async def test_management_and_upload_reject_wrong_owner_or_invalid_resource(
    client: AsyncClient, published_dataset: dict[str, object]
) -> None:
    dataset_id = published_dataset["id"]
    assert (
        await client.get("/api/v1/me/datasets", headers={"X-Dev-User": " "})
    ).status_code == 401
    assert (
        await client.get(f"/api/v1/datasets/{dataset_id}/manage", headers={"X-Dev-User": "other"})
    ).status_code == 403
    assert (
        await client.get("/api/v1/jobs/not-found", headers={"X-Dev-User": "publisher-one"})
    ).status_code == 404

    version = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        headers={"X-Dev-User": "publisher-one"},
        json={"changelog": "Recurso inválido"},
    )
    assert version.status_code == 201
    version_id = version.json()["versions"][-1]["id"]
    bad_extension = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions/{version_id}/resources",
        headers={"X-Dev-User": "publisher-one"},
        files={"file": ("payload.exe", b"MZ executable", "application/octet-stream")},
    )
    assert bad_extension.status_code == 422

    # Presigned uploads are deliberately unavailable in the local storage profile.
    presign = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions/{version_id}/uploads/presign",
        headers={"X-Dev-User": "publisher-one"},
        json={
            "filename": "another.csv",
            "media_type": "text/csv",
            "byte_size": 10,
            "checksum_sha256": "0" * 64,
        },
    )
    assert presign.status_code == 409


async def test_draft_metadata_version_and_mapping_validation(client: AsyncClient) -> None:
    owner = {"X-Dev-User": "draft-owner"}
    created = await client.post(
        "/api/v1/datasets",
        headers=owner,
        json={"title": "Borrador de sensores", "description": "Descripción inicial"},
    )
    assert created.status_code == 201
    dataset = created.json()
    dataset_id = dataset["id"]
    version_id = dataset["versions"][0]["id"]

    updated = await client.patch(
        f"/api/v1/datasets/{dataset_id}",
        headers=owner,
        json={
            "title": "Borrador actualizado",
            "tags": [" IoT ", "iot", "Bogotá"],
            "spatial_coverage": {"bbox": [-74.2, 4.5, -73.9, 4.9], "reduce_precision": True},
            "temporal_coverage": {
                "starts_at": "2026-01-01T00:00:00Z",
                "frequency": "1 hora",
            },
        },
    )
    assert updated.status_code == 200
    assert updated.json()["tags"] == ["iot", "bogotá"]
    assert updated.json()["versions"][0]["spatial_coverage"]["precision_reduced"] is True

    version = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions",
        headers=owner,
        json={"changelog": "Segundo borrador"},
    )
    assert version.status_code == 201
    second_version_id = version.json()["versions"][-1]["id"]
    assert version.json()["versions"][-1]["temporal_coverage"]["frequency"] == "1 hora"

    no_license = await client.post(
        f"/api/v1/datasets/{dataset_id}/versions/{version_id}/publish", headers=owner
    )
    assert no_license.status_code == 422
    unknown_mapping = await client.put(
        f"/api/v1/datasets/{dataset_id}/versions/{second_version_id}/mapping",
        headers=owner,
        json={"resource_id": "missing", "observed_at_field": "observed_at"},
    )
    assert unknown_mapping.status_code == 404

    malformed = await client.post(
        "/api/v1/datasets",
        headers=owner,
        json={"title": "Dataset dañado", "license": "CC0 1.0"},
    )
    assert malformed.status_code == 201
    malformed_version = malformed.json()["versions"][0]["id"]
    failed_upload = await client.post(
        f"/api/v1/datasets/{malformed.json()['id']}/versions/{malformed_version}/resources",
        headers=owner,
        files={"file": ("broken.json", b"{not valid json}", "application/json")},
    )
    assert failed_upload.status_code == 201
    assert failed_upload.json()["resource"]["status"] == "failed"
    assert failed_upload.json()["job"]["status"] == "failed"
