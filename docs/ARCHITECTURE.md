# Arquitectura de OpenIoTData

## Diagramas

Estos diagramas son la vista visual de esta documentación y están construidos como
HTML autocontenido con SVG inline, siguiendo el formato de `diagram-design`. Se pueden
abrir directamente en un navegador, sin build ni dependencias del backend:

- [Arquitectura de despliegue y límites de confianza](diagrams/openiotdata-architecture.html)
- [Flujo de publicación, normalización e ingesta](diagrams/openiotdata-ingestion-flow.html)

El primero muestra los tres planos principales —clientes, control y datos/cálculo— y
sus dependencias. El segundo muestra quién participa en cada paso y qué artefacto pasa
entre ellos; la rama discontinua representa cuarentena, errores o consultas posteriores.

## Límites del sistema

OpenIoTData separa el plano de control del plano de datos:

- El **plano de control** es relacional: identidad externa, catálogo, propiedad, versiones, trabajos, esquemas inferidos, coberturas, tokens y auditoría.
- El **plano de datos** es orientado a objetos: originales y derivados inmutables bajo claves generadas por la plataforma.
- El **plano de cálculo** es asíncrono: escaneo, inferencia, conversión, perfiles y exportaciones en workers.

El API FastAPI es un monolito modular y comparte modelos/transacciones entre módulos. Celery es un proceso distinto sobre la misma versión del código. Nginx sirve frontend, API e identidad bajo un mismo origen; PostgreSQL, Redis, MinIO y ClamAV no se exponen fuera del host en la configuración local.

## Flujo de un recurso

```text
draft
  └─ upload original → checksum → antivirus
       └─ job Celery → inferir → normalizar Parquet → perfil
            ├─ error/quarantine
            └─ ready → mapeo semántico → publicación inmutable
```

La clave del objeto incluye dataset, versión, recurso y clase (`original` o `normalized`). El nombre entregado por el usuario sólo aparece como metadato y nombre de descarga; no decide rutas locales.

## Consistencia

- PostgreSQL es fuente de verdad del catálogo y del estado de trabajos.
- Un objeto se escribe antes de confirmar su referencia en la base. Un fallo de transacción intenta retirar el objeto; una tarea de mantenimiento debe detectar huérfanos.
- Una versión publicada no se modifica. Una nueva carga continua se incorpora a una versión de trabajo posterior.
- `Idempotency-Key` más dataset tiene restricción única para evitar duplicados incluso con varias réplicas API.
- Redis puede vaciarse sin perder datasets ni objetos; los trabajos pendientes deben poder reconciliarse desde PostgreSQL.

## Consulta y geografía

DuckDB recibe rutas de objetos materializados y una consulta construida por filtros permitidos. Los nombres de columnas se comparan contra el perfil antes de interpolarlos; los valores se parametrizan. No hay endpoint de SQL libre.

PostGIS mantiene cobertura, centroides y envolventes para descubrir datasets por mapa. Las coordenadas por fila permanecen en Parquet; para grandes volúmenes se producirán agregados, clusters o tiles en lugar de GeoJSON masivo.

## Escalado previsto

1. Escalar workers por longitud de cola y separar colas de ingesta/exportación.
2. Añadir réplicas API tras mover rate limiting a Redis y migraciones a un job único.
3. Externalizar PostgreSQL/S3/Redis con observabilidad y backups verificados.
4. Introducir un motor analítico distribuido únicamente si DuckDB deja de cumplir SLO medidos.

Decisiones completas: [ADR-0001](adr/0001-monolito-modular.md) y [ADR-0002](adr/0002-schema-on-read.md).
