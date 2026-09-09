# Traspaso técnico de OpenIoTData

Esta guía permite que una persona nueva levante, valide y continúe la beta local sin
depender de conocimiento oral. Empiece por [PRODUCT.md](../PRODUCT.md),
[ARCHITECTURE.md](ARCHITECTURE.md), [ADR-0001](adr/0001-monolito-modular.md) y
[ADR-0002](adr/0002-schema-on-read.md). Esas decisiones son obligatorias mientras un
nuevo ADR no las sustituya explícitamente.

## Propósito y alcance actual

OpenIoTData publica, descubre y reutiliza datasets IoT heterogéneos. Conserva el
original, normaliza a Parquet, infiere un esquema, permite mapeos temporales y
geográficos y publica versiones inmutables. Esta entrega es una beta local para
desarrollo y demostración interna; no es una configuración apta para Internet.

La UI cubre catálogo, consulta, mapa, descarga, publicación y gestión del propietario
(versiones, tokens y archivo). El rol `moderator` puede listar, revisar, resolver o
descartar reportes en `/admin`. La API pública existente se mantiene compatible; el
único endpoint añadido para la gestión es el listado seguro de tokens, que nunca
devuelve su secreto.

## Mapa de servicios

| Servicio | Responsabilidad | Persistencia / diagnóstico |
|---|---|---|
| `nginx` | Entrada same-origin para UI, API y OIDC | `:8080` |
| `frontend` | Next.js 16, React 19 y cliente OIDC PKCE | `:3000` |
| `api` | FastAPI, catálogo, permisos, auditoría y jobs | `:8000`, OpenAPI `/api/v1/docs` |
| `worker` | ClamAV, inferencia, Parquet y procesamiento | logs de Compose |
| `postgres` | Catálogo, PostGIS, identidad Keycloak y auditoría | volumen `postgres_data`, `:5432` |
| `minio` | Originales y derivados privados | volumen `minio_data`, consola `:9001` |
| `redis` | Broker/resultados transitorios de Celery | volumen `redis_data`, `:6379` |
| `keycloak` | Identidad, roles `publisher` y `moderator` | esquema `keycloak`, `:8081` |
| `clamav` | Escaneo fail-closed de cargas | firmas en `clamav_data`, `:3310` |

Los puertos administrativos sólo escuchan en `127.0.0.1`. Revise `.env.example`
antes de cambiar puertos, cuotas, issuer OIDC o límites de carga. `DEV_AUTH_BYPASS`
y `NEXT_PUBLIC_DEMO_MODE` deben permanecer en `false` para una validación real.

## Primer arranque reproducible

Requisitos: Docker Engine con Compose v2, 10–12 GB de RAM libre, Python 3.12,
Node 22, `make`, `curl`, `jq` y `sha256sum`.

```bash
cp .env.example .env
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.lock
cd frontend && npm ci && cd ..
make setup-e2e
make validate-beta
```

`make validate-beta` ejecuta, en orden, `verify`, `bootstrap`, una segunda carga del
seed para demostrar idempotencia, `check`, `e2e`, `e2e-ui` y una comprobación final.
La primera carga de firmas de ClamAV puede tardar
varios minutos. Registre el resultado en [VALIDATION.md](VALIDATION.md).

Datos de acceso exclusivamente locales:

| Rol | Usuario | Contraseña |
|---|---|---|
| Publicación | `demo.publisher` | `publisher-local-only` |
| Moderación | `demo.moderator` | `moderator-local-only` |
| Keycloak admin | `admin` | `admin-local-only` |

El realm se importa cuando Keycloak crea sus datos por primera vez. Si un volumen
local anterior no contiene `demo.moderator`, cree ese usuario y asígnele los roles
`publisher` y `moderator` desde la consola local; no borre volúmenes con datos útiles.

## Ciclo diario, pruebas y depuración

```bash
make up            # construir/iniciar
make wait          # esperar healthchecks
make ps            # estado
make logs          # logs agregados
make lint          # Ruff, ESLint y TypeScript
make test          # 27 backend + 16 frontend
make check         # servicios, PostGIS y endpoints
make down          # detener sin borrar datos
```

Para un servicio concreto use `docker compose logs --tail=150 api`, `worker`,
`keycloak` o `clamav`. Para comprobar un job, consulte `GET /api/v1/jobs/{id}` con el
token de la persona propietaria. Una prueba backend bloqueada falla a los 60 segundos;
Pytest imprime stacks a los 45 segundos. En algunos sandboxes que no permiten hilos,
`aiosqlite` puede bloquearse antes del primer test: confirme fuera de ese aislamiento
antes de atribuir el fallo a la aplicación.

## Datos demo y límites de seguridad

`make seed` es idempotente y sólo carga contenido sintético señalado como
demostración. Las cargas se consideran hostiles: no omita ClamAV, no publique el
bucket, no interpole SQL y no exponga tokens completos en listados o logs. El secreto
de ingesta se muestra una única vez al crearlo y sólo se conserva su hash.

Los originales y versiones publicadas son inmutables. Archivar retira un dataset del
catálogo sin borrar objetos o auditoría. Los límites relevantes están en `.env.example`:
1 GiB por carga, 20 GiB por cuenta, 10.000 registros o 10 MiB por lote.

## Backup y recuperación

```bash
make backup
cd backups/<fecha-UTC>
sha256sum --check SHA256SUMS
```

El respaldo combina un dump PostgreSQL y el bucket MinIO del mismo corte. Restaure y
ensaye siempre en una instancia separada; las instrucciones completas están en el
[README](../README.md#respaldos-y-recuperación). `backups/` puede contener datos
sensibles y no debe subirse al repositorio.

## Estado, riesgos y aceptación de cambios

- La beta local se acepta sólo con una evidencia completa de `make validate-beta`.
- CI conserva lint, tipos, pruebas, build y validación estática de Compose; Docker E2E
  sigue siendo una puerta manual por consumo de recursos.
- Compose usa imágenes externas sin digest y credenciales demo: no desplegar tal cual.
- La CSP local tolera scripts inline de Next.js; producción requiere nonces/hashes.
- El rate limit es por proceso y Redis no está autenticado; ambos requieren rediseño
  antes de escalar horizontalmente.
- El build local de `npm ci` reporta seis advisories transitivos (dos moderados, dos
  altos y dos críticos); deben triagarse y corregirse con upgrades compatibles, sin
  aplicar automáticamente cambios mayores mediante `npm audit fix --force`.
- Los cambios de esquema requieren migración Alembic reversible; los cambios de API,
  pruebas y documentación deben aterrizar juntos.

Antes de aceptar un cambio, ejecute `make verify`. Si toca autenticación, carga,
procesamiento, publicación, consulta, mapas, descargas o gestión, ejecute además
`make validate-beta`. Mantenga `CONTRIBUTING.md` como guía de colaboración interna.

## Dónde continuar

El orden acordado está en [ROADMAP.md](ROADMAP.md). Tome un ítem, convierta sus
criterios en pruebas primero y mantenga los contratos existentes salvo ADR y plan de
migración explícitos.
