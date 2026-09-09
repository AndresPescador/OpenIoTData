# Evidencia de validación de la beta

Este archivo registra la última ejecución canónica y sirve como plantilla para la
siguiente. No declare la beta lista si falta un resultado o si hubo una incidencia no
resuelta.

## Última ejecución

| Campo | Valor |
|---|---|
| Estado | **APROBADA** |
| Commit | `66b19f0` + cambios de estabilización sin commit |
| Fecha (UTC) | 2026-09-09 01:53 |
| Responsable | Codex |
| URL | `http://openiotdata.localhost:8080` |
| Docker / Compose | `29.7.2` / `5.3.0` |
| Python | `3.12.14` |
| Node | `v22.23.1` |
| Playwright / Chromium | `1.62.1` / `chromium-1234` |

| Paso | Resultado | Duración / notas |
|---|---|---|
| `make verify` | Aprobado | Ruff, ESLint, tipos, 27 backend, 16 frontend y build Next.js |
| `make bootstrap` | Aprobado | Imágenes construidas; 9 servicios saludables |
| `make seed` repetido | Aprobado | `Demo seed already exists`; sin duplicados |
| `make check` inicial | Aprobado | PostGIS, Nginx, frontend, API, OIDC y MinIO |
| `make e2e` | Aprobado | 9/9: OIDC, ClamAV, Parquet, publicación, consulta, mapa, descarga y batch idempotente |
| `make e2e-ui` escritorio | Aprobado | Propietario y moderación; 2/2 |
| `make e2e-ui` móvil 375 px | Aprobado | Propietario y moderación; 2/2 |
| `make check` final | Aprobado | Todos los servicios y endpoints saludables |

Incidencias resueltas: el primer arranque de Docker Desktop terminó su VM QEMU de
forma transitoria; el daemon se recuperó sin borrar volúmenes y el reintento construyó
la pila desde cero. La primera pasada Playwright detectó un selector ambiguo durante
la transición de publicación; se sustituyó por la espera del cierre del panel editable
y la ejecución canónica posterior pasó completa. Ninguna incidencia queda abierta.

## Plantilla para una nueva ejecución

Copie esta sección, no sobrescriba evidencia histórica relevante.

```text
Estado: APROBADA / FALLIDA
Commit:
Fecha y zona horaria:
Responsable:
URL validada:
Docker:
Docker Compose:
Python:
Node:
Playwright / Chromium:

make verify:       resultado / duración
make bootstrap:    resultado / duración
make check:        resultado / duración
make e2e:          resultado / duración
make e2e-ui:       escritorio / móvil / duración
make check final:  resultado / duración

Seed repetido para comprobar idempotencia: sí / no
Servicios saludables: sí / no
Incidencias, logs o enlaces a artefactos:
Decisión y responsable:
```

El criterio de salida exige servicios saludables, seed idempotente, flujo API E2E
correcto y navegador correcto tanto en escritorio como a 375 px.
