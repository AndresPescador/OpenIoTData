# Contribuir a OpenIoTData

Gracias por contribuir. Antes de abrir un cambio:

1. Lea [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md) y los ADR.
2. No incluya secretos, dumps, datasets reales ni coordenadas sensibles.
3. Use datos sintéticos marcados como ilustrativos.
4. Mantenga la API compatible o explique la migración en un ADR.

## Entorno

```bash
cp .env.example .env
make bootstrap
```

Para trabajar fuera de contenedores use Python 3.12, Node 22 e instale exactamente los
locks del repositorio:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.lock
cd frontend && npm ci && cd ..
```

Antes de enviar:

```bash
make lint
make test
make check
```

Los cambios en flujos críticos o en la gestión deben completar también
`make setup-e2e` (una vez) y `make validate-beta`, con evidencia en
[`docs/VALIDATION.md`](docs/VALIDATION.md). Consulte la guía de
[`handoff`](docs/HANDOFF.md) para depuración, servicios y riesgos conocidos.

Los cambios de esquema requieren migración Alembic. Los cambios de endpoint requieren actualizar OpenAPI/pruebas y, si afecta ejemplos, `docs/API.md`. Las funciones de interfaz deben respetar WCAG 2.1 AA, teclado, lectores de pantalla, 375 px y movimiento reducido.

## Pull requests

- alcance pequeño y título descriptivo;
- pruebas para comportamiento y fallos relevantes;
- explicación de seguridad, compatibilidad y datos migrados;
- sin reformatear archivos ajenos al cambio;
- sin editar versiones publicadas ni reemplazar silenciosamente artefactos.

Al participar acepta [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Las contribuciones de código se reciben bajo Apache License 2.0 salvo indicación explícita compatible.
