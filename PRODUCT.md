# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the approved implementation plan: Next.js and React with TypeScript for the frontend; FastAPI, PostgreSQL/PostGIS, Redis/Celery, MinIO, DuckDB and PyArrow for the backend and data plane; Docker Compose for local operation.

## Users

- People who need to discover, inspect, map, query and download open IoT sensor datasets without creating an account.
- Researchers, civic technologists, students and sensor owners who publish datasets after signing in.
- Devices and scripts that append observations to an owned dataset through scoped API tokens.
- Moderators who review reports, quarantined resources and audit history.

## Product Purpose

OpenIoTData is a public catalog for heterogeneous IoT sensor data. It lets publishers preserve original resources, infer a useful tabular schema, add semantic mappings for time and geography, publish immutable versions and expose the result through downloads and a public API. Success means an unfamiliar dataset can be found, understood and reused without the platform requiring a bespoke SQL table or a sensor-specific schema.

## Positioning

Unlike a generic file catalog or a fixed telemetry dashboard, OpenIoTData combines open-data publishing with schema-on-read inspection, reproducible versions, sensor-oriented semantic mapping and first-class geographic exploration.

## Operating Context

Visitors arrive through search, a shared dataset URL or the map. Publishers work through a resumable multi-step flow: describe the dataset, upload a supported resource, review inferred fields, map optional temporal/geographic semantics, select a license and publish. Sensors and scripts append timestamped JSON batches. Long-running ingestion and exports execute asynchronously and expose progress and recovery states.

## Capabilities and Constraints

- Public anonymous read, search, preview and download; authenticated publication.
- CSV, TSV, JSON, NDJSON, Parquet and GeoJSON resources in v1.
- Flexible resource schemas, with PostgreSQL storing catalog metadata while original and normalized data remain in object storage.
- Dataset-level geometry and optional record-level coordinates in WGS84/EPSG:4326.
- Mandatory explicit open-data license before publication.
- Append-only REST ingestion with scoped, revocable tokens and idempotency keys.
- Local-first Docker Compose deployment; no Kubernetes, Kafka, OpenSearch or ClickHouse in v1.
- Uploaded content is untrusted and must be isolated, limited, scanned and audited.

## Brand Commitments

The confirmed name is OpenIoTData. The interface is a technical, editorial catalog rather than a literal Kaggle copy or a generic real-time monitoring dashboard. Language is Spanish-first, precise, calm and free of inflated claims.

## Evidence on Hand

The sibling Sound Monitoring System provides real architectural and interaction evidence for FastAPI, PostgreSQL, Docker, MapLibre/deck.gl, time-series queries, station tokens and a future first integration. No customer counts, usage metrics, institutional endorsements or scientific validation claims are available and none may be fabricated. Demonstration content must be labelled as illustrative.

## Product Principles

1. Flexible payloads, explicit metadata.
2. Preserve originals and make every published version reproducible.
3. Public discovery must not require an account or domain expertise.
4. Geography and time add capability when present but never block valid non-geographic datasets.
5. Safety, provenance and understandable quality signals precede publication volume.

## Accessibility & Inclusion

Target WCAG 2.1 AA. Core flows must work with keyboard and screen readers, charts require textual/table alternatives, status cannot rely on color alone, motion respects reduced-motion preferences and layouts must remain usable at 375 px and high zoom.
