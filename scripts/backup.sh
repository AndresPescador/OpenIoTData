#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="backups/${timestamp}"
mkdir -p "$destination"

echo "Respaldando PostgreSQL..."
docker compose exec -T postgres sh -c \
  'exec pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  >"${destination}/postgres.dump"

echo "Respaldando objetos MinIO..."
mkdir -p "${destination}/minio"
docker compose run --rm --no-deps \
  --entrypoint /bin/sh \
  -v "${PROJECT_DIR}/${destination}/minio:/backup" \
  minio-init -c \
  'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite "local/$S3_BUCKET" /backup'

{
  echo "created_at=${timestamp}"
  echo "project=openiotdata"
  git rev-parse --verify HEAD 2>/dev/null | sed 's/^/git_commit=/' || true
} >"${destination}/manifest.txt"
(
  cd "$destination"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum
) >"${destination}/SHA256SUMS"

echo "Respaldo creado en ${destination}"
echo "El respaldo puede contener datos sensibles: protéjalo y no lo suba a Git."
