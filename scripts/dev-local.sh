#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ENV_FILE="$PROJECT_DIR/scripts/dev-local.env"

usage() {
  cat <<'EOF'
Uso: scripts/dev-local.sh <comando>

Modo host (backend + frontend sin Docker ni infraestructura):

  api     Arranca FastAPI en el host en el puerto 8000
  seed    Carga el catálogo ilustrativo en la base local (idempotente)
  web     Arranca Next.js en el host en el puerto 3000
  reset   Elimina los datos locales del modo host (destructivo)
  env     Muestra la configuración resuelta y la guía de uso

Este modo omite ClamAV, OIDC/Keycloak, PostGIS y el worker Celery. No sustituye a
'make validate-beta' ni debe usarse en entornos compartidos.
EOF
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: no se encontró $ENV_FILE." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  if [[ "${APP_ENV:-}" == "production" ]]; then
    echo "Error: el modo host no puede ejecutarse con APP_ENV=production." >&2
    exit 1
  fi
}

backend_python() {
  if [[ -x "$PROJECT_DIR/backend/.venv312/bin/python" ]]; then
    printf '%s' "$PROJECT_DIR/backend/.venv312/bin/python"
  elif [[ -x "$PROJECT_DIR/backend/.venv/bin/python" ]]; then
    printf '%s' "$PROJECT_DIR/backend/.venv/bin/python"
  else
    printf '%s' "python"
  fi
}

ensure_data_dir() {
  mkdir -p "$PROJECT_DIR/backend/data"
}

require_backend() {
  PYTHON_BIN="$(backend_python)"
  if [[ ! -x "$PYTHON_BIN" ]] && ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "Error: no se encontró un intérprete de Python." >&2
    echo "Cree el entorno con: python3.12 -m venv backend/.venv" >&2
    exit 1
  fi
}

require_frontend() {
  if [[ ! -d "$PROJECT_DIR/frontend/node_modules" ]]; then
    echo "Error: faltan las dependencias del frontend." >&2
    echo "Instálelas con: cd frontend && npm ci" >&2
    exit 1
  fi
}

warn_degraded() {
  cat >&2 <<'EOF'
Modo host: sin ClamAV, sin OIDC/Keycloak, sin PostGIS y con procesamiento en
línea (sin worker Celery). Únicamente para desarrollo local.
EOF
}

cmd_api() {
  load_env
  require_backend
  ensure_data_dir
  warn_degraded
  cd "$PROJECT_DIR/backend"
  echo "API:      http://localhost:8000"
  echo "OpenAPI:  http://localhost:8000/api/v1/docs"
  exec "$PYTHON_BIN" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
}

cmd_seed() {
  load_env
  require_backend
  ensure_data_dir
  cd "$PROJECT_DIR/backend"
  echo "Cargando el catálogo ilustrativo en la base local (operación idempotente)..."
  exec "$PYTHON_BIN" -m app.seed
}

cmd_web() {
  load_env
  require_frontend
  cd "$PROJECT_DIR/frontend"
  echo "Frontend: http://localhost:3000"
  echo "API:      ${NEXT_PUBLIC_API_URL:-}"
  exec npm run dev
}

cmd_reset() {
  local target="$PROJECT_DIR/backend/data"
  if [[ ! -e "$target" ]]; then
    echo "No hay datos locales que eliminar ($target)."
    return 0
  fi
  printf 'Se eliminará %s (base local y objetos). Escriba "si" para continuar: ' "$target"
  local answer=""
  read -r answer
  if [[ "$answer" != "si" ]]; then
    echo "Cancelado."
    return 1
  fi
  rm -rf "$target"
  echo "Datos locales eliminados."
}

cmd_env() {
  load_env
  echo "Configuración del modo host (scripts/dev-local.env):"
  printf '  %-28s %s\n' "APP_ENV" "${APP_ENV:-}"
  printf '  %-28s %s\n' "DATABASE_URL" "${DATABASE_URL:-}"
  printf '  %-28s %s\n' "STORAGE_BACKEND" "${STORAGE_BACKEND:-}"
  printf '  %-28s %s\n' "LOCAL_STORAGE_PATH" "${LOCAL_STORAGE_PATH:-}"
  printf '  %-28s %s\n' "CELERY_TASK_ALWAYS_EAGER" "${CELERY_TASK_ALWAYS_EAGER:-}"
  printf '  %-28s %s\n' "DEV_AUTH_BYPASS" "${DEV_AUTH_BYPASS:-}"
  printf '  %-28s %s\n' "CLAMAV_REQUIRED" "${CLAMAV_REQUIRED:-}"
  printf '  %-28s %s\n' "NEXT_PUBLIC_API_URL" "${NEXT_PUBLIC_API_URL:-}"
  printf '  %-28s %s\n' "NEXT_PUBLIC_DEV_AUTH_BYPASS" "${NEXT_PUBLIC_DEV_AUTH_BYPASS:-}"
  echo
  echo "Terminal 1: make dev-seed && make dev-api"
  echo "Terminal 2: make dev-web"
  echo
  echo "UI: http://localhost:3000   API: http://localhost:8000/api/v1/docs"
}

command="${1:-}"
case "$command" in
  api) cmd_api ;;
  seed) cmd_seed ;;
  web) cmd_web ;;
  reset) cmd_reset ;;
  env) cmd_env ;;
  ""|-h|--help|help) usage ;;
  *)
    echo "Comando desconocido: $command" >&2
    echo >&2
    usage >&2
    exit 1
    ;;
esac
