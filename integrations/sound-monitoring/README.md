# Adaptador de monitoreo acústico

Publica mediciones del proyecto `Sound-Monitoring-System` como lotes idempotentes de OpenIoTData.

```bash
cp .env.example .env
set -a
source .env
set +a
python3 publish.py --from 2026-04-08T00:00:00Z --to 2026-04-09T00:00:00Z --dry-run
python3 publish.py --from 2026-04-08T00:00:00Z --to 2026-04-09T00:00:00Z
```

El token debe tener permiso de ingesta únicamente sobre el dataset configurado. Cada rango y contenido genera una clave de idempotencia estable, por lo que repetir exactamente el mismo envío no duplica observaciones.

Para ejecución periódica se recomienda un timer de systemd o cron que use ventanas cerradas y solapadas; la idempotencia hace seguro reintentar una ventana después de un fallo.
