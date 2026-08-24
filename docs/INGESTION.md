# Ingesta de sensores y archivos NDJSON

## Contrato de observación

La ingesta continua acepta un objeto `records` con entre 1 y 10.000 observaciones:

```json
{
  "records": [
    {
      "observed_at": "2026-08-23T15:30:00Z",
      "data": {
        "humidity": 68.4,
        "temperature_c": 19.7,
        "battery_v": 3.92
      },
      "sensor_id": "HUM-BOG-01",
      "location": {
        "type": "Point",
        "coordinates": [-74.0721, 4.711]
      },
      "metadata": {
        "firmware": "1.4.2"
      }
    }
  ]
}
```

Reglas:

- `observed_at` es ISO 8601; use UTC con `Z` cuando sea posible.
- `data` admite propiedades libres, pero no debe contener secretos ni datos personales innecesarios.
- `location.coordinates` es `[longitud, latitud]` en EPSG:4326.
- `sensor_id`, `location` y `metadata` son opcionales.
- La solicitud no puede superar 10 MiB; el servidor valida el límite aunque falte `Content-Length`.
- Nuevas variables o cambios incompatibles producirán un nuevo perfil/recurso; no se reescriben versiones publicadas.

## Envío con `curl`

Primero cree un token de dataset como explica [API.md](API.md). Después:

```bash
export API=http://localhost:8080/api/v1
export DATASET_ID=00000000-0000-0000-0000-000000000000
export DATASET_TOKEN='oidt_cambie_este_valor'

curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/records:batch" \
  -H "Authorization: Bearer $DATASET_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: gateway-HUM-BOG-01-20260823T1530Z-0001' \
  --data-binary @docs/examples/batch.json
```

Respuesta `202 Accepted`:

```json
{
  "job_id": "...",
  "status": "pending",
  "record_count": 2,
  "idempotent_replay": false
}
```

Repita exactamente la misma clave si la conexión termina sin respuesta. Una repetición para el mismo dataset devuelve el trabajo reservado con `idempotent_replay: true`; usar una clave nueva puede duplicar observaciones.

## Archivo NDJSON

Cada línea de [examples/observations.ndjson](examples/observations.ndjson) es una observación independiente, sin el envoltorio `records`. Se publica como recurso mediante el endpoint multipart o el flujo presign/confirm:

```bash
curl --fail --silent --show-error -X POST \
  "$API/datasets/$DATASET_ID/versions/$VERSION_ID/resources" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F 'file=@docs/examples/observations.ndjson;type=application/x-ndjson'
```

La API de lotes JSON convierte internamente cada solicitud aceptada en un recurso NDJSON inmutable. No envíe directamente `Content-Type: application/x-ndjson` a `records:batch`: ese endpoint espera el envoltorio JSON mostrado arriba.

## Estrategia recomendada para gateways

- Agrupar por tiempo o tamaño, hasta 10.000 registros/10 MiB.
- Persistir localmente lote y clave antes de enviar.
- Reintentar `408`, `429` y `5xx` con backoff exponencial y jitter.
- No reintentar `401/403/413/422` sin corregir credencial o contenido.
- Rotar tokens, usar uno por gateway, asignar expiración y revocar al retirar el dispositivo.
- Mantener reloj sincronizado y no fabricar timestamps en el servidor central.
- Enviar unidades estables y declararlas en el mapeo semántico.

## Privacidad geográfica

No publique coordenadas exactas de hogares, infraestructura crítica, especies protegidas u otros activos sensibles. Use ubicación general del dataset, reducción de precisión o elimine la ubicación por registro. La plataforma valida rangos, no determina por sí sola si una coordenada es segura para divulgar.
