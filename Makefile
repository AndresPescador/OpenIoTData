SHELL := /usr/bin/env bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

.PHONY: help bootstrap config up wait seed check e2e ps logs down restart migrate test lint build backup

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

e2e: ## Recorre OIDC, publicación, consultas, descarga y batch idempotente
	./scripts/e2e-local.sh

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
	cd backend && python -m pytest
	cd frontend && npm run test

lint: ## Ejecuta validadores de backend y frontend (requiere dependencias locales)
	cd backend && python -m ruff check .
	cd frontend && npm run lint
	cd frontend && npm run typecheck

build: ## Construye las imágenes de la aplicación
	$(COMPOSE) build api worker frontend

backup: ## Crea respaldo local de PostgreSQL y MinIO en backups/
	./scripts/backup.sh
