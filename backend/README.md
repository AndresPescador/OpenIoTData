# OpenIoTData backend

FastAPI modular para catálogo, versionado, procesamiento y consulta de recursos IoT
heterogéneos. PostgreSQL guarda el catálogo; los originales y Parquet normalizados viven en
almacenamiento local o S3/MinIO. DuckDB sólo ejecuta consultas construidas con campos y
operadores permitidos por la API.

## Desarrollo local

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Para datos ilustrativos, ejecutar `python -m app.seed`. El worker se inicia con:

```bash
celery -A app.worker.celery_app worker --loglevel=info
```

`DEV_AUTH_BYPASS=true` es exclusivamente local/test. Simula una cuenta mediante
`X-Dev-User`; la configuración rechaza activarlo en producción. En producción se validan JWT
OIDC contra el JWKS de Keycloak.

## Contratos principales

- `GET /api/v1/datasets`, detalle, preview, query, mapa, puntos y descargas son públicos.
- `POST /api/v1/datasets` crea un borrador; carga multipart y presign/confirmación añaden
  recursos; `POST .../publish` publica una versión inmutable.
- `POST /api/v1/datasets/{id}/records:batch` requiere token `records:write` e
  `Idempotency-Key`. Los lotes se acumulan en una nueva versión editable y sólo se vuelven
  públicos al publicar ese snapshot; nunca modifican una versión publicada.
- `GET .../versions/{number}` y la descarga versionada mantienen accesibles snapshots previos.
- `GET/PATCH /api/v1/admin/reports` ofrece la cola mínima de moderación.

OpenAPI está en `/api/v1/docs` y `/api/v1/openapi.json`.

## Límites y seguridad

- Archivos admitidos: CSV, TSV, JSON, NDJSON/JSONL, Parquet y GeoJSON.
- Máximo de carga configurable (1 GiB por defecto), cuota por cuenta y checksum SHA-256.
- La inferencia en memoria de texto/JSON se limita a 256 MiB; recursos mayores deben cargarse
  como Parquet. Parquet se inspecciona antes de leer por filas, columnas y tamaño lógico.
- Cargas S3 directas usan una clave temporal, longitud firmada y promoción a una clave
  inmutable al confirmar; el worker vuelve a escanear el objeto con ClamAV.
- Batch REST: 10.000 registros o 10 MiB. Query: cuerpo de 64 KiB, máximo 100 valores `IN`,
  concurrencia, memoria y tiempo de DuckDB limitados.
- Los nombres proporcionados sólo son metadatos; las claves internas son generadas por la
  plataforma. No se acepta SQL libre.
- Coordenadas y geometrías v1 son únicamente EPSG:4326. PostgreSQL usa
  `geometry(Geometry,4326)`, índice GiST y `ST_Intersects`; SQLite usa EWKT+bbox en pruebas.

Si el broker no acepta un trabajo después del commit, éste permanece `pending` y puede
recuperarse con `POST /api/v1/jobs/{id}/retry`. Para procesamiento pesado en producción, el
worker debe ejecutarse con límites de memoria/CPU y almacenamiento temporal en disco.

## Verificación

```bash
ruff check app alembic tests
pytest -q
```

La migración inicial es explícita y se verifica con `alembic upgrade head` y
`alembic downgrade base` en SQLite; despliegue usa PostgreSQL/PostGIS.
