#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

required_commands=(docker make curl jq sha256sum node npm)
for command in "${required_commands[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Error: se requiere '$command' para validar la beta." >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: se requiere Docker Compose v2 (comando 'docker compose')." >&2
  exit 1
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "22" ]]; then
  echo "Error: la validación reproducible requiere Node 22; se detectó $(node --version)." >&2
  exit 1
fi

if [[ ! -f frontend/node_modules/@playwright/test/package.json ]]; then
  echo "Error: faltan dependencias frontend. Ejecuta 'cd frontend && npm ci'." >&2
  exit 1
fi

if ! (cd frontend && npx playwright install --list 2>/dev/null | grep -q "/chromium-"); then
  echo "Error: Chromium de Playwright no está disponible. Ejecuta 'make setup-e2e'." >&2
  exit 1
fi

if [[ -x backend/.venv312/bin/python ]]; then
  backend_python="backend/.venv312/bin/python"
elif [[ -x backend/.venv/bin/python ]]; then
  backend_python="backend/.venv/bin/python"
else
  backend_python="python"
fi

echo "OpenIoTData · validación integral de beta"
echo "Commit:  $(git rev-parse --short HEAD)"
echo "Docker:  $(docker --version)"
echo "Compose: $(docker compose version --short)"
echo "Python:  $("${BACKEND_PYTHON:-$backend_python}" --version 2>&1)"
echo "Node:    $(node --version)"
echo

make verify
make bootstrap
make seed
make check
make e2e
make e2e-ui
make check

echo
echo "Beta validada. Registra esta ejecución en docs/VALIDATION.md antes del traspaso."
