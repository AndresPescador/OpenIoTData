# API HTTP

La especificación ejecutable está en `/api/v1/openapi.json`; Swagger UI está en `/api/v1/docs`. Este documento resume los recorridos principales. El contrato OpenAPI prevalece ante cualquier diferencia.

## Bases y autenticación

En la pila local:

```bash
export ORIGIN=http://localhost:8080
export API="$ORIGIN/api/v1"
```

La interfaz web ofrece registro abierto en Keycloak durante el desarrollo local:
selecciona “Crear cuenta” desde la cabecera o desde `/publish`. El modo demo del
frontend es opt-in; con `NEXT_PUBLIC_DEMO_MODE=false`, un fallo del API no se sustituye
por datos ilustrativos.

La lectura de datasets publicados es anónima. La administración usa un access token OIDC con audience `openiotdata-api`:

```bash
TOKEN_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "$ORIGIN/auth/realms/openiotdata/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=password \
  --data-urlencode client_id=openiotdata-web \
  --data-urlencode username=demo.publisher \
  --data-urlencode password=publisher-local-only)"

export ACCESS_TOKEN="$(printf '%s' "$TOKEN_RESPONSE" | jq -r .access_token)"
```

El password grant se habilita sólo para ejemplos locales. El frontend incluido usa Authorization Code + PKCE contra Keycloak. Los tokens `oidt_...` emitidos para sensores son distintos: sólo sirven para escribir observaciones en un dataset concreto.

## Catálogo público

| Método y ruta | Función |
|---|---|
| `GET /datasets` | Catálogo por cursor; filtros `q`, `topic`, `license`, `format`, `has_location` |
| `GET /datasets/{slug}` | Metadatos, versiones y recursos publicados |
| `GET /datasets/{slug}/preview` | Vista previa; admite `resource_id` y `limit` |
| `POST /datasets/{slug}/query` | Columnas, filtros, orden y paginación parametrizados |
| `GET /datasets/{slug}/resources/{id}/download` | Original o `?normalized=true`; URL temporal/descarga |
| `GET /map/datasets` | FeatureCollection; admite `bbox=west,south,east,north` |
| `POST /datasets/{slug}/reports` | Reporte comunitario, autenticación opcional |

Ejemplos:

```bash
curl --fail --silent "$API/datasets?q=ruido&has_location=true&limit=20"

curl --fail --silent \
  "$API/map/datasets?bbox=-74.30,4.45,-73.90,4.90"

curl --fail --silent -X POST "$API/datasets/ruido-ambiental-bogota-demostracion/query" \
  -H 'Content-Type: application/json' \
  -d '{
    "columns": ["observed_at", "sensor_id", "leq_db"],
    "filters": [{"field": "leq_db", "operator": "gte", "value": 60}],
    "order_by": "observed_at",
    "descending": false,
    "limit": 100,
    "offset": 0
  }'
```

Operadores admitidos: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` e `is_null`. Las columnas deben existir en el perfil inferido. El servidor impone límites aunque el cliente solicite valores superiores. No existe SQL libre.

## Crear un borrador

```bash
curl --fail --silent --show-error -X POST "$API/datasets" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Humedad urbana — ejemplo local",
    "description": "Mediciones ilustrativas de un sensor de humedad.",
    "topic": "humedad",
    "tags": ["humedad", "demostración"],
    "license": "CC BY 4.0",
    "spatial_coverage": {
      "latitude": 4.711,
      "longitude": -74.0721,
      "crs": "EPSG:4326",
      "reduce_precision": false
    }
  }' | tee /tmp/openiotdata-draft.json

export DATASET_ID="$(jq -r .id /tmp/openiotdata-draft.json)"
export VERSION_ID="$(jq -r '.versions[0].id' /tmp/openiotdata-draft.json)"
```

La licencia declarada pertenece actualmente al dataset y se usa al publicar sus versiones; el modelo no almacena todavía una licencia independiente por versión. La publicación sin esa licencia de dataset falla con `422`. Punto, bbox y GeoJSON `Point`/`Polygon` usan longitud antes de latitud y EPSG:4326.

## Cargar un recurso

Para archivos pequeños se puede usar multipart:

```bash
curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/resources" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F 'file=@docs/examples/observations.ndjson;type=application/x-ndjson'
```

La respuesta incluye recurso y trabajo. Consulte `GET /jobs/{job_id}` mientras el estado sea `pending` o `running`, hasta que termine en `succeeded` o `failed`.

Para carga directa a S3/MinIO:

1. Calcular bytes y SHA-256.
2. `POST /datasets/{dataset_id}/versions/{version_id}/uploads/presign`.
3. Ejecutar el `PUT` a `upload_url` con exactamente los headers devueltos.
4. `POST /datasets/{dataset_id}/resources/{resource_id}/confirm`.

```bash
FILE=docs/examples/observations.ndjson
BYTES="$(wc -c <"$FILE" | tr -d ' ')"
SHA256="$(sha256sum "$FILE" | cut -d' ' -f1)"

curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/uploads/presign" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"filename\":\"observations.ndjson\",\"media_type\":\"application/x-ndjson\",\"byte_size\":$BYTES,\"checksum_sha256\":\"$SHA256\"}"
```

La confirmación vuelve a verificar tamaño, checksum y formato antes de crear el trabajo. Las URLs firmadas duran 15 minutos en la v1 y no convierten el bucket en público.

## Mapeo y publicación

Después de que el recurso esté `ready`:

```bash
curl --fail --silent --show-error -X PUT \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/mapping" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"resource_id\": \"$RESOURCE_ID\",
    \"observed_at_field\": \"observed_at\",
    \"latitude_field\": \"latitude\",
    \"longitude_field\": \"longitude\",
    \"sensor_id_field\": \"sensor_id\",
    \"variable_units\": {\"humidity\": \"%RH\"},
    \"crs\": \"EPSG:4326\"
  }"

curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/publish" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

Latitud y longitud se mapean juntas. Publicar exige la licencia declarada del dataset y que todos los recursos terminen correctamente. Una versión publicada es inmutable; `POST /datasets/{dataset_id}/versions` crea la siguiente.

## Tokens de sensores e ingesta

```bash
curl --fail --silent --show-error -X POST "$API/datasets/$DATASET_ID/tokens" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"gateway-laboratorio","scopes":["records:write"]}'
```

El secreto `token` se devuelve una sola vez. Guárdelo fuera de logs y repositorios.
`GET /datasets/{dataset_id}/tokens` lista exclusivamente id, nombre, prefijo, scopes y
fechas de creación, expiración, último uso y revocación; nunca contiene `token` ni su
hash. Para revocar: `DELETE /datasets/{dataset_id}/tokens/{token_id}`.

El lote completo está documentado en [INGESTION.md](INGESTION.md).

## Gestión desde la interfaz beta

Además de registro, publicación, catálogo, consulta, mapa y descarga, la UI local
permite a la persona propietaria crear versiones con changelog, cargar y publicar un
nuevo snapshot, administrar tokens de ingesta y archivar con confirmación. La ruta
`/admin` lista y resuelve reportes para roles `moderator` o `admin`. La creación de un
reporte comunitario continúa disponible mediante `POST /datasets/{slug}/reports`.

## Estados, paginación y errores

- Listados públicos usan cursor opaco; no debe interpretarse ni fabricarse.
- Operaciones largas responden con un job consultable.
- Nginx acepta hasta 64 KiB en cuerpos JSON generales, incluido `POST /datasets/{slug}/query`; `records:batch` tiene su límite separado de 10 MiB y la carga multipart de recursos, 1 GiB.
- `400/422`: solicitud o mapeo inválido; `401`: credencial ausente/expirada; `403`: scope/propiedad; `404`: recurso no visible; `409`: estado incompatible; `413`: cuota o tamaño.
- Los detalles de error siguen el formato de FastAPI y no deben mostrarse al usuario sin traducción contextual.
- Reintente `429` y errores transitorios con backoff y jitter. No reintente una escritura sin una clave de idempotencia estable.
