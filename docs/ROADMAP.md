# Roadmap técnico

El roadmap parte de una beta local validada; no representa compromiso de despliegue
público. Cada etapa mantiene versiones publicadas inmutables y el contrato REST salvo
un ADR y una migración explícitos.

## 0. Base verificable y traspaso — actual

- Dependencias backend resueltas para Python 3.12 y CI instalando los locks.
- Pruebas backend con timeout y diagnóstico de stack.
- Puerta `make validate-beta` con evidencia repetible.
- Guía de arquitectura, operación, seguridad, backup y continuidad.

Salida: [VALIDATION.md](VALIDATION.md) registra una ejecución integral aprobada.

## 1. Interfaz de gestión — implementada en esta entrega

- Crear versiones con changelog, cargar recursos y publicar snapshots.
- Crear, listar y revocar tokens; mostrar el secreto sólo una vez.
- Archivar un dataset mediante confirmación explícita.
- Mostrar y resolver la cola de moderación sólo con rol autorizado.
- Pruebas unitarias de adaptadores/permisos/errores y Playwright de propietario y
  moderación en escritorio y móvil.

Salida: los flujos pasan dentro de `make e2e-ui` y API/handoff ya no los describen
como capacidades «sólo API».

## 2. Integración de referencia y observabilidad — siguiente

1. Integrar el sistema de monitoreo acústico como primer productor real controlado,
   conservando datos sintéticos o anonimizados en desarrollo.
2. Definir métricas y SLO locales para jobs, latencia de consulta, tasa de fallo,
   tamaño de cola y crecimiento del almacenamiento.
3. Añadir reconciliación de jobs pendientes y detección de objetos huérfanos.
4. Ensayar backup/restauración completa y documentar RPO/RTO propuestos.

Salida: una integración automatizada, dashboards operativos mínimos y una restauración
verificada sin cambiar el motor analítico por anticipación.

## 3. Preparación para entorno compartido — no iniciada

TLS, secretos gestionados, eliminación de credenciales demo, CSP con nonce, MFA para
moderación, servicios administrados o endurecidos, rate limit distribuido, imágenes
por digest, SBOM, escaneo de dependencias y revisión legal/privacidad.

Salida: threat model y checklist de despliegue aprobados antes de exponer el sistema a
Internet.
