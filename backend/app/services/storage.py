from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import struct
import tempfile
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath

import boto3
from botocore.client import Config
from fastapi import HTTPException, UploadFile

from app.core.config import Settings, get_settings


class UnsafeUpload(ValueError):
    pass


def normalize_extension(filename: str, allowed: set[str]) -> str:
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension == "jsonl":
        extension = "ndjson"
    if extension not in allowed and not (extension == "ndjson" and "jsonl" in allowed):
        raise UnsafeUpload(f"Unsupported file format: {extension or 'missing extension'}")
    return extension


def validate_magic(sample: bytes, extension: str) -> None:
    forbidden = {
        b"\x7fELF": "ELF executable",
        b"MZ": "Windows executable",
        b"PK\x03\x04": "ZIP archive",
        b"\xca\xfe\xba\xbe": "Java class",
    }
    for signature, name in forbidden.items():
        if sample.startswith(signature):
            raise UnsafeUpload(f"The uploaded content is a forbidden {name}")
    if extension == "parquet" and not sample.startswith(b"PAR1"):
        raise UnsafeUpload("Invalid Parquet signature")
    if extension != "parquet" and b"\x00" in sample:
        raise UnsafeUpload("Text-based sensor resources cannot contain NUL bytes")


async def spool_upload(upload: UploadFile, max_bytes: int) -> tuple[Path, int, str, bytes]:
    descriptor, raw_path = tempfile.mkstemp(prefix="oidt-upload-")
    os.close(descriptor)
    path = Path(raw_path)
    size = 0
    digest = hashlib.sha256()
    sample = b""
    try:
        with path.open("wb") as destination:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(
                        status_code=413, detail="Upload exceeds the configured limit"
                    )
                digest.update(chunk)
                if len(sample) < 8192:
                    sample += chunk[: 8192 - len(sample)]
                destination.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="Empty resources are not accepted")
        return path, size, digest.hexdigest(), sample
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


async def scan_for_malware(path: Path, settings: Settings) -> None:
    """Scan through ClamAV's INSTREAM protocol; optionally fail closed when unavailable."""
    if not settings.clamav_host:
        return
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.clamav_host, settings.clamav_port), timeout=5
        )
        writer.write(b"zINSTREAM\0")
        with path.open("rb") as source:
            while chunk := source.read(64 * 1024):
                writer.write(struct.pack("!I", len(chunk)))
                writer.write(chunk)
                await writer.drain()
        writer.write(struct.pack("!I", 0))
        await writer.drain()
        result = (
            await asyncio.wait_for(reader.read(4096), timeout=settings.clamav_timeout_seconds)
        ).decode("utf-8", errors="replace")
        writer.close()
        await writer.wait_closed()
        if "FOUND" in result:
            raise UnsafeUpload("Malware scanner rejected the uploaded resource")
        if "OK" not in result:
            raise RuntimeError(f"Unexpected ClamAV response: {result.strip()}")
    except UnsafeUpload:
        raise
    except Exception as exc:
        if settings.clamav_required:
            raise UnsafeUpload("Malware scanner is unavailable; upload rejected") from exc


class ObjectStorage(ABC):
    backend_name: str

    @abstractmethod
    async def ensure_ready(self) -> None: ...

    @abstractmethod
    async def put_path(self, key: str, source: Path, content_type: str | None = None) -> None: ...

    @abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abstractmethod
    async def size(self, key: str) -> int: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    async def presign_upload(
        self, key: str, content_type: str | None, byte_size: int, expires: int
    ) -> str: ...

    @abstractmethod
    async def promote(self, source_key: str, destination_key: str) -> None: ...

    @abstractmethod
    async def presign_download(self, key: str, filename: str, expires: int) -> str | None: ...

    @abstractmethod
    @asynccontextmanager
    async def materialize(self, key: str) -> AsyncIterator[Path]:
        yield Path()


class LocalStorage(ObjectStorage):
    backend_name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path_for(self, key: str) -> Path:
        normalized = PurePosixPath(key)
        if normalized.is_absolute() or ".." in normalized.parts:
            raise ValueError("Unsafe object key")
        path = (self.root / Path(*normalized.parts)).resolve()
        if self.root != path and self.root not in path.parents:
            raise ValueError("Object key escapes storage root")
        return path

    async def ensure_ready(self) -> None:
        await asyncio.to_thread(self.root.mkdir, parents=True, exist_ok=True)

    async def put_path(self, key: str, source: Path, content_type: str | None = None) -> None:
        destination = self.path_for(key)

        def copy() -> None:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)

        await asyncio.to_thread(copy)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self.path_for(key).is_file)

    async def size(self, key: str) -> int:
        return (await asyncio.to_thread(self.path_for(key).stat)).st_size

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.path_for(key).unlink, missing_ok=True)

    async def presign_upload(
        self, key: str, content_type: str | None, byte_size: int, expires: int
    ) -> str:
        # Local storage cannot offer a safe direct PUT; callers receive the authenticated API route.
        return ""

    async def promote(self, source_key: str, destination_key: str) -> None:
        source = self.path_for(source_key)
        destination = self.path_for(destination_key)

        def move() -> None:
            destination.parent.mkdir(parents=True, exist_ok=True)
            source.replace(destination)

        await asyncio.to_thread(move)

    async def presign_download(self, key: str, filename: str, expires: int) -> str | None:
        return None

    @asynccontextmanager
    async def materialize(self, key: str) -> AsyncIterator[Path]:
        path = self.path_for(key)
        if not await asyncio.to_thread(path.is_file):
            raise FileNotFoundError(key)
        yield path


class S3Storage(ObjectStorage):
    backend_name = "s3"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
        )
        self.presign_client = boto3.client(
            "s3",
            endpoint_url=settings.s3_public_endpoint_url or settings.s3_endpoint_url,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4"),
        )
        self.bucket = settings.s3_bucket

    async def ensure_ready(self) -> None:
        def ensure() -> None:
            try:
                self.client.head_bucket(Bucket=self.bucket)
            except Exception:
                self.client.create_bucket(Bucket=self.bucket)

        await asyncio.to_thread(ensure)

    async def put_path(self, key: str, source: Path, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else None
        await asyncio.to_thread(
            self.client.upload_file,
            str(source),
            self.bucket,
            key,
            ExtraArgs=extra or {},
        )

    async def exists(self, key: str) -> bool:
        try:
            await asyncio.to_thread(self.client.head_object, Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    async def size(self, key: str) -> int:
        result = await asyncio.to_thread(self.client.head_object, Bucket=self.bucket, Key=key)
        return int(result["ContentLength"])

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=self.bucket, Key=key)

    async def presign_upload(
        self, key: str, content_type: str | None, byte_size: int, expires: int
    ) -> str:
        params: dict[str, str | int] = {
            "Bucket": self.bucket,
            "Key": key,
            "ContentLength": byte_size,
        }
        if content_type:
            params["ContentType"] = content_type
        url = await asyncio.to_thread(
            self.presign_client.generate_presigned_url,
            "put_object",
            Params=params,
            ExpiresIn=expires,
        )
        return url

    async def promote(self, source_key: str, destination_key: str) -> None:
        await asyncio.to_thread(
            self.client.copy_object,
            Bucket=self.bucket,
            Key=destination_key,
            CopySource={"Bucket": self.bucket, "Key": source_key},
        )
        await self.delete(source_key)

    async def presign_download(self, key: str, filename: str, expires: int) -> str | None:
        safe_filename = (
            "".join(
                character if character.isalnum() or character in {".", "_", "-"} else "_"
                for character in Path(filename).name
            )[:200]
            or "resource"
        )
        url = await asyncio.to_thread(
            self.presign_client.generate_presigned_url,
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{safe_filename}"',
            },
            ExpiresIn=expires,
        )
        return url

    @asynccontextmanager
    async def materialize(self, key: str) -> AsyncIterator[Path]:
        descriptor, raw_path = tempfile.mkstemp(prefix="oidt-object-")
        os.close(descriptor)
        path = Path(raw_path)
        try:
            await asyncio.to_thread(self.client.download_file, self.bucket, key, str(path))
            yield path
        finally:
            path.unlink(missing_ok=True)


_storage: ObjectStorage | None = None


def get_storage(settings: Settings | None = None) -> ObjectStorage:
    global _storage
    configured = settings or get_settings()
    if _storage is None:
        _storage = (
            S3Storage(configured)
            if configured.storage_backend == "s3"
            else LocalStorage(configured.local_storage_path)
        )
    return _storage


def reset_storage() -> None:
    global _storage
    _storage = None
