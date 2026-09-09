SHELL := /usr/bin/env bash
COMPOSE := docker compose
BACKEND_PYTHON ?= $(shell if test -x "$(CURDIR)/backend/.venv312/bin/python"; then printf '%s' "$(CURDIR)/backend/.venv312/bin/python"; elif test -x "$(CURDIR)/backend/.venv/bin/python"; then printf '%s' "$(CURDIR)/backend/.venv/bin/python"; else printf '%s' python; fi)

.DEFAULT_GOAL := help

.PHONY: help bootstrap config up wait seed check setup-e2e e2e e2e-ui validate-beta verify ps logs down restart migrate test lint build backup

help: ## Muestra los comandos disponibles
	@awk 'BEGIN {FS = ":.*## "; printf "OpenIoTData — comandos locales\n\n"} /^[a-zA-Z_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## Crea .env, construye, inicia, espera salud y carga datos demo
	./scripts/bootstrap.sh

config: ## Valida e imprime la configuración Compose resuelta
	$(COMPOSE) config --quiet

up: ## Construye e inicia todos los servicios
	$(COMPOSE) up --build -d

wait: ## Espera hasta que los servicios estén saludables
	$(COMPOSE) up -d --wait

seed: ## Carga el catálogo ilustrativo de forma idempotente
	./scripts/seed.sh

check: ## Ejecuta comprobaciones de infraestructura y endpoints
	./scripts/check.sh

setup-e2e: ## Instala Chromium para las pruebas Playwright
	cd frontend && npx playwright install chromium

e2e: ## Recorre OIDC, publicación, consultas, descarga y batch idempotente
	./scripts/e2e-local.sh

e2e-ui: ## Recorre el flujo crítico desde el navegador (requiere la pila levantada)
	cd frontend && npm run e2e

validate-beta: ## Ejecuta la puerta canónica completa de la beta local
	./scripts/validate-beta.sh

verify: ## Ejecuta validaciones locales de código, build y configuración
	$(MAKE) config
	bash -n scripts/*.sh backend/scripts/*.sh
	$(MAKE) lint
	$(MAKE) test
	cd frontend && npm run build

ps: ## Muestra el estado de los contenedores
	$(COMPOSE) ps

logs: ## Sigue los logs de todos los servicios
	$(COMPOSE) logs --tail=100 -f

down: ## Detiene contenedores sin borrar datos
	$(COMPOSE) down --remove-orphans

restart: ## Reinicia la aplicación conservando los volúmenes
	$(COMPOSE) restart

migrate: ## Aplica migraciones Alembic
	$(COMPOSE) exec -T api alembic upgrade head

test: ## Ejecuta pruebas backend y frontend (requiere dependencias locales)
	cd backend && $(BACKEND_PYTHON) -m pytest --cov=app --cov-report=term-missing --cov-fail-under=75
	cd frontend && npm run test

lint: ## Ejecuta validadores de backend y frontend (requiere dependencias locales)
	cd backend && $(BACKEND_PYTHON) -m ruff check .
	cd frontend && npm run lint
	cd frontend && npm run typecheck

build: ## Construye las imágenes de la aplicación
	$(COMPOSE) build api worker frontend

backup: ## Crea respaldo local de PostgreSQL y MinIO en backups/
	./scripts/backup.sh
