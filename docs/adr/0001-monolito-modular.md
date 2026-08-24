# ADR-0001: monolito modular con workers separados

- Estado: aceptada
- Fecha: 2026-08-23

## Contexto

La primera versión necesita catálogo, autenticación, publicación, consulta, geografía, moderación e ingesta. Dividirlos en microservicios introduciría contratos distribuidos, observabilidad, despliegues y consistencia eventual antes de conocer la carga real.

## Decisión

Implementar una sola aplicación FastAPI organizada por módulos de dominio. Ejecutar el trabajo intensivo con procesos Celery separados que comparten paquete, modelos y base de datos. Next.js y Keycloak siguen siendo componentes independientes por responsabilidad técnica.

## Consecuencias

- Las operaciones de catálogo conservan transacciones simples y una sola migración.
- La pila local y CI requieren menos coordinación.
- API y worker deben desplegar versiones compatibles del mismo código.
- Los límites modulares deben impedir dependencias circulares y acceso arbitrario entre capas.
- Un módulo podrá extraerse cuando métricas de escala, aislamiento o cadencia lo justifiquen; no se promete esa extracción de antemano.
