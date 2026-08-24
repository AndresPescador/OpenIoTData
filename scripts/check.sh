#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

read_env_default() {
  local key="$1"
  local fallback="$2"
  local value=""
  if [[ -f .env ]]; then
    value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
  fi
  printf '%s' "${value:-$fallback}"
}

WEB_PORT="${WEB_PORT:-$(read_env_default WEB_PORT 8080)}"
FRONTEND_PORT="${FRONTEND_PORT:-$(read_env_default FRONTEND_PORT 3000)}"
API_PORT="${API_PORT:-$(read_env_default API_PORT 8000)}"
MINIO_API_PORT="${MINIO_API_PORT:-$(read_env_default MINIO_API_PORT 9000)}"

check_url() {
  local name="$1"
  local url="$2"
  printf '  %-18s ' "$name"
  if curl --fail --silent --show-error --max-time 10 "$url" >/dev/null; then
    echo "OK"
  else
    echo "FALLÓ ($url)" >&2
    return 1
  fi
}

docker compose config --quiet

required=(postgres redis minio keycloak clamav api worker frontend nginx)
running="$(docker compose ps --status running --services)"
for service in "${required[@]}"; do
  if ! grep -qx "$service" <<<"$running"; then
    echo "Error: el servicio '$service' no está en ejecución." >&2
    docker compose ps >&2
    exit 1
  fi
done

unhealthy="$(docker compose ps --status unhealthy --services)"
if [[ -n "$unhealthy" ]]; then
  echo "Error: servicios no saludables:" >&2
  printf '%s\n' "$unhealthy" >&2
  docker compose ps >&2
  exit 1
fi

if ! docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT 1 FROM pg_extension WHERE extname = '\''postgis'\''"' \
  | grep -qx 1; then
  echo "Error: la extensión PostGIS no está instalada." >&2
  exit 1
fi

echo "Comprobando endpoints:"
check_url "Nginx" "http://127.0.0.1:${WEB_PORT}/nginx-health"
check_url "Frontend" "http://127.0.0.1:${FRONTEND_PORT}/"
check_url "API" "http://127.0.0.1:${API_PORT}/health"
check_url "OIDC discovery" "http://127.0.0.1:${WEB_PORT}/auth/realms/openiotdata/.well-known/openid-configuration"
check_url "MinIO" "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live"

echo "Infraestructura saludable."
