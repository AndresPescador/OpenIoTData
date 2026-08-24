# Política de seguridad

## Versiones soportadas

Mientras el proyecto esté en `0.x`, sólo la rama principal y la última versión publicada reciben correcciones. No hay garantía de soporte para snapshots antiguos.

## Reportar una vulnerabilidad

No abra un issue público para vulnerabilidades, credenciales filtradas, datos personales expuestos o instrucciones de explotación. Use **Private vulnerability reporting / Security advisories** del repositorio de GitHub. Si esa función no está disponible, contacte privadamente a los mantenedores del repositorio antes de compartir detalles; el proyecto todavía no publica una dirección institucional verificable.

Incluya, cuando sea seguro:

- componente y versión/commit;
- impacto y prerrequisitos;
- pasos mínimos de reproducción o prueba de concepto no destructiva;
- mitigación sugerida;
- si algún token, dataset o persona pudo verse afectado.

No adjunte archivos de sensores reales ni secretos. Use contenido sintético y retire metadatos personales. Los mantenedores confirmarán recepción y coordinarán divulgación/corrección según severidad y capacidad; no se prometen plazos hasta disponer de un equipo de respuesta formal.

## Alcance prioritario

- escape del aislamiento de cargas o ejecución a través de formatos admitidos;
- acceso a objetos privados o URLs firmadas ajenas;
- omisión de propiedad, roles, scopes, revocación o audience OIDC;
- inyección en consultas DuckDB/PostgreSQL o traversal de rutas;
- duplicación/pérdida por idempotencia y corrupción de versiones;
- agotamiento de CPU, memoria, almacenamiento o cola;
- exposición de coordenadas reducidas, auditoría o datos personales.

## Despliegue local

Las credenciales de `.env.example`, el usuario demo y `start-dev` de Keycloak son inseguros fuera de una máquina de desarrollo. Consulte la lista de endurecimiento en [README.md](README.md#paso-a-producción). Nunca active `DEV_AUTH_BYPASS` en entornos compartidos o productivos.
