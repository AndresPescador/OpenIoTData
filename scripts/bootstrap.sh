#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está en PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: se requiere Docker Compose v2 (comando 'docker compose')." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Se creó .env con credenciales exclusivamente locales."
fi

docker compose config --quiet

echo "Construyendo e iniciando OpenIoTData..."
if ! docker compose up --build --wait -d; then
  echo "Algún servicio no alcanzó el estado saludable:" >&2
  docker compose ps >&2
  docker compose logs --tail=80 api worker keycloak clamav >&2
  exit 1
fi

./scripts/seed.sh
./scripts/check.sh

echo
echo "OpenIoTData está listo: http://openiotdata.localhost:8080"
echo "Alternativa:               http://localhost:8080"
echo "OpenAPI:                   http://localhost:8000/api/v1/docs"
echo "Keycloak admin:            http://openiotdata.localhost:8080/auth/admin/"
echo "MinIO:                     http://localhost:9001"
