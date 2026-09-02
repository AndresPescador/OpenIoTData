# OpenIoTData

Portal abierto para publicar, descubrir, explorar en el mapa y reutilizar datasets heterogéneos de sensores IoT. Los metadatos, permisos y versiones viven en PostgreSQL/PostGIS; los archivos originales y su normalización Parquet permanecen en almacenamiento de objetos y se consultan con esquema inferido.

> Este repositorio contiene una primera versión funcional para desarrollo local. Los datos de demostración son ilustrativos: no representan mediciones verificadas ni una validación científica.

## Inicio rápido

Requisitos:

- Docker Engine 24+ y Docker Compose v2.20+.
- Aproximadamente 10–12 GB de RAM disponibles; ClamAV reserva hasta 3 GB porque cargar y actualizar firmas produce picos importantes.
- `curl` y `make` para usar los comandos auxiliares; `jq` y `sha256sum` para el recorrido `make e2e`.

Arranque completo:

```bash
cp .env.example .env
make bootstrap
```

`make bootstrap` valida Compose, construye las imágenes, espera los healthchecks, aplica las migraciones desde el arranque de `api`, ejecuta el seed idempotente y verifica los endpoints. La primera ejecución puede tardar varios minutos mientras ClamAV descarga o carga sus firmas.

Abra [http://openiotdata.localhost:8080](http://openiotdata.localhost:8080). Si el navegador no resuelve subdominios `.localhost`, use [http://localhost:8080](http://localhost:8080); Keycloak seguirá anunciando el issuer canónico `openiotdata.localhost`.
Para el registro/inicio de sesión del E2E, mantenga el hostname canónico (o defina
`PLAYWRIGHT_BASE_URL` a una URL que comparta ese origen con Keycloak), ya que las cookies
OIDC son same-origin.

Comandos habituales:

```bash
make up       # construir e iniciar
make wait     # esperar servicios saludables
make seed     # recargar datos ilustrativos, sin duplicarlos
make check    # comprobar Compose y endpoints
make e2e      # publicar/consultar/descargar un dataset temporal y archivarlo
make e2e-ui   # probar el recorrido crítico desde Chromium y móvil
make verify   # lint, tipos, pruebas, build y configuración
make logs     # seguir logs
make down     # detener sin borrar volúmenes
make backup   # exportar PostgreSQL y objetos
```

No use `docker compose down -v` salvo que quiera eliminar de forma irreversible la base de datos, los objetos y las firmas locales.

## Servicios y puertos locales

| Servicio | URL o puerto | Acceso |
|---|---:|---|
| Aplicación vía Nginx | `http://localhost:8080` | Público local |
| Frontend directo | `http://localhost:3000` | Sólo diagnóstico |
| API directa | `http://localhost:8000` | Sólo diagnóstico |
| OpenAPI | `http://localhost:8000/api/v1/docs` | Público local |
| Keycloak | `http://openiotdata.localhost:8080/auth` | Mismo origen |
| Consola MinIO | `http://localhost:9001` | Administrador local |
| API MinIO | `http://localhost:9000` | URLs firmadas/local |
| PostgreSQL/PostGIS | `127.0.0.1:5432` | Administrador local |
| Redis | `127.0.0.1:6379` | Administrador local |
| ClamAV | `127.0.0.1:3310` | Administrador local |

Todos los puertos salvo el proxy web están ligados a `127.0.0.1`. La comunicación de la aplicación usa una red de datos interna; PostgreSQL, Redis y MinIO reciben además una red `diagnostics` exclusivamente para que Docker publique esos puertos en el host local. ClamAV usa una red separada para actualizar firmas. En producción deben retirarse tanto `diagnostics` como los puertos administrativos.

### Credenciales exclusivamente demo

| Uso | Usuario | Contraseña |
|---|---|---|
| Publicador Keycloak | `demo.publisher` | `publisher-local-only` |
| Administrador Keycloak | `admin` | `admin-local-only` |
| MinIO | `openiotdata` | `openiotdata-minio-local-only` |
| PostgreSQL | `openiotdata` | `openiotdata-local-only` |

Estas credenciales se importan para facilitar el desarrollo. Nunca deben reutilizarse en una red compartida o producción. Cambie todos los valores de `.env`; no suba ese archivo al repositorio. `DEV_AUTH_BYPASS` permanece en `false` en Compose y la API prohíbe activarlo fuera de `development` o `test`.

## Arquitectura

```mermaid
flowchart LR
    Browser[Navegador] --> Nginx[Nginx :8080]
    Nginx --> Web[Next.js :3000]
    Nginx --> API[FastAPI :8000]
    Nginx --> KC[Keycloak /auth]
    API --> PG[(PostgreSQL + PostGIS)]
    API --> Redis[(Redis)]
    API --> MinIO[(MinIO/S3)]
    Redis --> Worker[Celery worker]
    Worker --> AV[ClamAV]
    Worker --> MinIO
    Worker --> PG
    Worker --> Compute[PyArrow + DuckDB]
```

Se usa un monolito modular: una API mantiene los módulos de catálogo, publicación, consulta, identidad y moderación; Celery separa el trabajo intensivo. Esto conserva transacciones y despliegue simples sin impedir extraer workers o el plano de consulta cuando las métricas reales lo exijan.

### Responsabilidad de cada almacenamiento

- **PostgreSQL/PostGIS:** datasets, versiones, recursos, campos inferidos, trabajos, permisos, auditoría y coberturas geográficas.
- **MinIO/S3:** originales inmutables, lotes NDJSON y derivados Parquet. El bucket es privado; la API entrega URLs temporales firmadas.
- **Redis:** cola y resultados transitorios de Celery, no fuente de verdad.
- **DuckDB/PyArrow:** inferencia, normalización y consultas parametrizadas sobre Parquet. No se acepta SQL del usuario.

No se crea una tabla SQL por dataset. El motivo y sus consecuencias están registrados en [ADR-0002](docs/adr/0002-schema-on-read.md).

## Flujo de publicación

1. El publicador inicia sesión en Keycloak desde el frontend mediante OIDC Authorization Code + PKCE. El recorrido reproducible por `curl` de `docs/API.md` usa el password grant exclusivamente como atajo local; no representa el flujo del navegador ni debe habilitarse en producción.
2. Crea un borrador con título, descripción y metadatos mínimos.
3. Sube CSV, TSV, JSON, NDJSON, Parquet o GeoJSON. Para archivos grandes se solicita una URL firmada y se confirma el checksum SHA-256.
4. ClamAV examina el recurso; el worker infiere campos, calcula estadísticas limitadas y normaliza a Parquet.
5. El usuario revisa el esquema y, si aplica, mapea tiempo, latitud, longitud, sensor, variables y unidades.
6. La publicación exige que el dataset tenga una licencia declarada y que todos los recursos estén listos. La versión publicada queda inmutable; el modelo actual no guarda una licencia independiente por versión.
7. Cualquier visitante puede buscar, previsualizar, consultar, ubicar en el mapa y descargar.

La interfaz REST detallada está en [docs/API.md](docs/API.md) y el recorrido con `curl` en [docs/INGESTION.md](docs/INGESTION.md).

## Ingesta continua por API

Un propietario crea un token limitado al dataset con el scope `records:write`. Luego envía lotes append-only a:

```text
POST /api/v1/datasets/{dataset_id}/records:batch
```

Cada observación exige `observed_at` y un objeto libre `data`; `sensor_id`, `location` GeoJSON y `metadata` son opcionales. Cada solicitud requiere `Idempotency-Key`, acepta como máximo 10.000 registros o 10 MiB y devuelve `202 Accepted`. Repetir la misma clave para el mismo dataset devuelve el trabajo existente sin duplicar datos.

## Desarrollo sin Docker para la aplicación

La infraestructura puede seguir en contenedores mientras API y frontend se ejecutan en el host.

Backend:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
cd backend
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=/api/v1 NEXT_PUBLIC_DEMO_MODE=false npm run dev
```

El modo demo está separado del recorrido real. Para abrir el frontend sin API y con
datos ilustrativos, use `cd frontend && npm run dev:demo`; nunca se debe usar ese modo
para verificar la disponibilidad del backend. En el flujo normal, `NEXT_PUBLIC_DEMO_MODE`
debe permanecer en `false` y los errores de la API se muestran al usuario.
Si se activa en Compose para una comprobación aislada, reconstruya `frontend` para que
la variable pública quede incluida en el bundle (`NEXT_PUBLIC_DEMO_MODE=true docker compose build frontend`).

La pantalla de inicio de sesión de Keycloak permite crear una cuenta local mediante
“Crear cuenta”. El registro está abierto en la configuración de desarrollo; las cuentas
locales pueden publicar datasets y el catálogo sigue siendo anónimo para lectura.

Para el proxy de mismo origen, use la pila Compose. El frontend compilado recibe `NEXT_PUBLIC_API_URL=/api/v1`; Nginx conserva la URI al enviarla a FastAPI, por lo que nunca se duplica `/api/v1`.

Pruebas locales:

```bash
make lint
make test
make verify
make e2e-ui
docker compose config --quiet
bash -n scripts/*.sh
```

`make e2e-ui` necesita la pila levantada con `make bootstrap` y los navegadores de
Playwright instalados (`cd frontend && npx playwright install chromium`). La pila local
reserva aproximadamente 10–12 GB de RAM, principalmente por ClamAV.

## Seguridad y gobierno de datos

Las cargas son contenido hostil. En local, la API y el worker esperan a ClamAV saludable y `CLAMAV_REQUIRED=true`; fallan cerrados si el escaneo no está disponible. Además:

- extensiones y firmas de archivo permitidas, nombres internos generados y checksums;
- límites en el borde de 64 KiB para JSON general (incluido `query`), 10 MiB para lotes REST y 1 GiB para multipart, además de 20 GiB por cuenta;
- workers sin capacidades Linux, sistema de archivos de sólo lectura, temporales acotados y sin red externa;
- bucket privado, tokens API hasheados y revocables, versiones inmutables y auditoría;
- CORS explícito, rate limiting y cabeceras de seguridad en API/Nginx;
- reducción de precisión disponible para ubicaciones sensibles;
- licencia de dataset obligatoria y canal de reporte comunitario.

La CSP local permite scripts inline por el arranque de Next.js. En producción debe sustituirse por nonces/hashes. Consulte [SECURITY.md](SECURITY.md) y la [política de publicación](docs/DATASET_POLICY.md).

## Respaldos y recuperación

```bash
make backup
```

El comando crea `backups/<fecha-UTC>/postgres.dump`, una copia lógica del bucket en `minio/`, un manifiesto y `SHA256SUMS`. `backups/` está ignorado por Git, pero puede contener información sensible y debe cifrarse fuera del equipo.

Compruebe un respaldo:

```bash
cd backups/20260823T120000Z
sha256sum --check SHA256SUMS
```

Pruebe la recuperación en una instancia separada, nunca sobre la única copia:

```bash
createdb -h 127.0.0.1 -U openiotdata openiotdata_restore
pg_restore -h 127.0.0.1 -U openiotdata -d openiotdata_restore --no-owner postgres.dump
```

Los objetos pueden restaurarse con `mc mirror` hacia un bucket vacío. PostgreSQL y MinIO forman una sola unidad lógica: restaure ambos desde el mismo corte. Defina RPO/RTO, cifrado, retención y pruebas periódicas antes de producción.

## Paso a producción

La configuración Compose es deliberadamente local. Antes de publicar en Internet:

- fijar imágenes por digest y generar SBOM/escaneo de dependencias;
- usar TLS, dominio real, cookies seguras y una CSP con nonce; retirar puertos administrativos;
- usar secretos administrados, rotarlos y eliminar usuarios/credenciales demo;
- ejecutar Keycloak con `start`, una base aislada, correo verificado, MFA para moderadores y protección de fuerza bruta revisada;
- usar PostgreSQL/PostGIS y S3 administrados o con alta disponibilidad, cifrado, versionado y políticas de ciclo de vida;
- autenticar/cifrar Redis, separar cola de resultados y limitar egress del worker;
- ejecutar migraciones como job único, no al arrancar cada réplica;
- aislar procesadores de archivos con límites de CPU, memoria, tiempo y red; mantener ClamAV actualizado;
- centralizar logs, métricas y trazas; alertar por errores de ingesta, cola, cuota, latencia y almacenamiento;
- sustituir el rate limiter en memoria por uno distribuido y probar carga, recuperación y moderación;
- revisar privacidad, términos, eliminación legal y publicación de coordenadas sensibles.

La transición a ClickHouse, Trino o tiles vectoriales sólo se justifica con datos de volumen y concurrencia. La API pública debe mantenerse estable al cambiar el motor.

La beta de interfaz cubre registro, publicación, descubrimiento, consulta, mapa y
descarga. La creación de nuevas versiones, tokens de ingesta, archivo de datasets,
reportes y resolución de moderación siguen disponibles exclusivamente mediante la API;
no forman parte del cierre de UI.

## Estructura

```text
backend/                 FastAPI, modelos, workers y migraciones
frontend/                Next.js y experiencia del catálogo
infra/                   Nginx, realm Keycloak e inicialización PostGIS
scripts/                 bootstrap, seed, checks y backups
docs/                    API, ingesta, políticas y decisiones
docker-compose.yml       pila local completa
```

## Contribuir y licencias

Consulte [CONTRIBUTING.md](CONTRIBUTING.md) y [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). El código se distribuye bajo [Apache License 2.0](LICENSE). Esa licencia no se aplica automáticamente a los datasets: cada publicador debe escoger y declarar una licencia de datos compatible con sus derechos.
