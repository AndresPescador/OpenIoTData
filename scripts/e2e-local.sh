#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

ORIGIN="${ORIGIN:-http://localhost:8080}"
API="$ORIGIN/api/v1"
RUN_ID="$(date -u +%Y%m%d%H%M%S)-$$"
TEMP_DIR="$(mktemp -d /tmp/openiotdata-e2e.XXXXXX)"
DATASET_ID=""
ACCESS_TOKEN=""

cleanup() {
  if [[ -n "$DATASET_ID" && -n "$ACCESS_TOKEN" ]]; then
    curl --fail --silent --show-error -X POST \
      "$API/datasets/$DATASET_ID/archive" \
      -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null || true
  fi
  case "$TEMP_DIR" in
    /tmp/openiotdata-e2e.*) rm -rf -- "$TEMP_DIR" ;;
  esac
}
trap cleanup EXIT

for command in curl jq sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Error: se requiere '$command'." >&2
    exit 1
  }
done

echo "1/9 OIDC"
TOKEN_RESPONSE="$(curl --fail --silent --show-error \
  -X POST "$ORIGIN/auth/realms/openiotdata/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=password \
  --data-urlencode client_id=openiotdata-web \
  --data-urlencode username=demo.publisher \
  --data-urlencode password=publisher-local-only)"
ACCESS_TOKEN="$(jq -er .access_token <<<"$TOKEN_RESPONSE")"

echo "2/9 Crear borrador"
jq -n --arg run "$RUN_ID" '{
  title: ("Calidad del aire — E2E local " + $run),
  description: "Publicación temporal creada por scripts/e2e-local.sh.",
  topic: "aire",
  tags: ["e2e", "demostración"],
  license: "CC BY 4.0",
  spatial_coverage: {latitude: 4.6486, longitude: -74.0628, crs: "EPSG:4326"},
  temporal_coverage: {
    starts_at: "2026-08-20T12:00:00Z",
    ends_at: "2026-08-20T12:10:00Z",
    frequency: "5 minutos",
    timezone_name: "UTC"
  }
}' >"$TEMP_DIR/create.json"
curl --fail --silent --show-error -X POST "$API/datasets" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TEMP_DIR/create.json" >"$TEMP_DIR/dataset.json"
DATASET_ID="$(jq -er .id "$TEMP_DIR/dataset.json")"
VERSION_ID="$(jq -er '.versions[0].id' "$TEMP_DIR/dataset.json")"
SLUG="$(jq -er .slug "$TEMP_DIR/dataset.json")"

echo "3/9 Cargar CSV y procesar"
curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/resources" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F 'file=@examples/air-quality-bogota.csv;type=text/csv' >"$TEMP_DIR/upload.json"
RESOURCE_ID="$(jq -er .resource.id "$TEMP_DIR/upload.json")"
JOB_ID="$(jq -er .job.id "$TEMP_DIR/upload.json")"

wait_for_job() {
  local job_id="$1"
  local status=""
  for _attempt in $(seq 1 60); do
    curl --fail --silent --show-error "$API/jobs/$job_id" \
      -H "Authorization: Bearer $ACCESS_TOKEN" >"$TEMP_DIR/job.json"
    status="$(jq -er .status "$TEMP_DIR/job.json")"
    case "$status" in
      succeeded) return 0 ;;
      failed)
        jq . "$TEMP_DIR/job.json" >&2
        return 1
        ;;
    esac
    sleep 1
  done
  echo "Error: timeout esperando el trabajo $job_id (último estado: $status)." >&2
  return 1
}

wait_for_job "$JOB_ID"
jq -e '.result.row_count == 6 and .result.column_count == 7' "$TEMP_DIR/job.json" >/dev/null

echo "4/9 Mapear semántica y publicar"
jq -n --arg resource "$RESOURCE_ID" '{
  resource_id: $resource,
  observed_at_field: "observed_at",
  latitude_field: "latitude",
  longitude_field: "longitude",
  sensor_id_field: "station_id",
  variable_units: {pm2_5_ug_m3: "µg/m³", temperature_c: "°C", relative_humidity_pct: "%RH"},
  crs: "EPSG:4326"
}' >"$TEMP_DIR/mapping.json"
curl --fail --silent --show-error -X PUT \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/mapping" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @"$TEMP_DIR/mapping.json" >/dev/null
curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/publish" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >"$TEMP_DIR/published.json"
jq -e '.status == "published" and .versions[0].semantic_mappings[0].variable_units.pm2_5_ug_m3 == "µg/m³"' \
  "$TEMP_DIR/published.json" >/dev/null

echo "5/9 Consultar catálogo, datos y mapa"
curl --fail --silent --show-error "$API/datasets/$SLUG" >"$TEMP_DIR/public.json"
jq -e '.row_count == 6 and .formats == ["csv"] and .temporal_coverage.frequency == "5 minutos"' \
  "$TEMP_DIR/public.json" >/dev/null
curl --fail --silent --show-error -X POST "$API/datasets/$SLUG/query" \
  -H 'Content-Type: application/json' \
  -d '{"columns":["station_id","pm2_5_ug_m3"],"filters":[{"field":"pm2_5_ug_m3","operator":"gte","value":20}],"limit":10}' \
  >"$TEMP_DIR/query.json"
jq -e '.returned == 3' "$TEMP_DIR/query.json" >/dev/null
curl --fail --silent --show-error "$API/datasets/$SLUG/points?bbox=-75,4,-73,5" \
  >"$TEMP_DIR/points.json"
jq -e '.features | length == 6' "$TEMP_DIR/points.json" >/dev/null

echo "6/9 Descargar original reproducible"
curl --fail --silent --show-error -L \
  "$API/datasets/$SLUG/versions/1/resources/$RESOURCE_ID/download" \
  >"$TEMP_DIR/download.csv"
[[ "$(sha256sum examples/air-quality-bogota.csv | cut -d' ' -f1)" == \
   "$(sha256sum "$TEMP_DIR/download.csv" | cut -d' ' -f1)" ]]

echo "7/9 Emitir token de sensor"
curl --fail --silent --show-error -X POST "$API/datasets/$DATASET_ID/tokens" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"gateway-e2e","scopes":["records:write"]}' >"$TEMP_DIR/api-token.json"
DATASET_TOKEN="$(jq -er .token "$TEMP_DIR/api-token.json")"

echo "8/9 Ingesta append-only e idempotencia"
IDEMPOTENCY_KEY="e2e-batch-$RUN_ID"
curl --fail --silent --show-error -X POST "$API/datasets/$DATASET_ID/records:batch" \
  -H "Authorization: Bearer $DATASET_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary @docs/examples/batch.json >"$TEMP_DIR/batch.json"
BATCH_JOB_ID="$(jq -er .job_id "$TEMP_DIR/batch.json")"
wait_for_job "$BATCH_JOB_ID"
curl --fail --silent --show-error -X POST "$API/datasets/$DATASET_ID/records:batch" \
  -H "Authorization: Bearer $DATASET_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data-binary @docs/examples/batch.json >"$TEMP_DIR/replay.json"
jq -e --arg job "$BATCH_JOB_ID" '.job_id == $job and .idempotent_replay == true' \
  "$TEMP_DIR/replay.json" >/dev/null
curl --fail --silent --show-error "$API/datasets/$DATASET_ID/manage" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >"$TEMP_DIR/manage.json"
jq -e '.versions | length == 2 and .[0].status == "published" and .[1].status == "ready"' \
  "$TEMP_DIR/manage.json" >/dev/null

echo "9/9 Archivar publicación temporal"
curl --fail --silent --show-error -X POST "$API/datasets/$DATASET_ID/archive" \
  -H "Authorization: Bearer $ACCESS_TOKEN" >/dev/null
DATASET_ID=""

echo "E2E correcto: OIDC → CSV → ClamAV → Parquet → publicación → consulta/mapa/descarga → batch idempotente."
