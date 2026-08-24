#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! docker compose ps --status running --services | grep -qx api; then
  echo "Error: el servicio api no está en ejecución. Use 'make up' primero." >&2
  exit 1
fi

echo "Cargando datos ilustrativos (operación idempotente)..."
docker compose exec -T api python -m app.seed
