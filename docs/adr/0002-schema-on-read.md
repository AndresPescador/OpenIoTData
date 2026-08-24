# ADR-0002: esquema inferido y datos tabulares fuera de PostgreSQL

- Estado: aceptada
- Fecha: 2026-08-23

## Contexto

Los publicadores pueden aportar humedad, aire, ruido u otras mediciones con columnas y tipos desconocidos. Una tabla fija rechazaría casos válidos; crear una tabla por dataset complica permisos, migraciones, nombres, índices, cuotas y consultas seguras. Guardar cada fila como JSONB simplifica la escritura, pero encarece analítica, tipos y exportación a escala.

## Decisión

Preservar el recurso original y convertir datos tabulares válidos a Parquet. Inferir un perfil por recurso y versión con PyArrow; registrar campos, tipos lógicos, nulabilidad, ejemplos y estadísticas acotadas en PostgreSQL. Consultar Parquet con DuckDB mediante una API parametrizada. PostgreSQL/PostGIS conserva el catálogo relacional y coberturas, no las observaciones arbitrarias.

La inferencia es una propuesta reproducible y visible. Valores incompatibles no se descartan silenciosamente: el recurso falla, conserva el campo como texto o requiere corrección/mapeo explícito según el formato. Un cambio de esquema crea otro recurso o versión.

## Consecuencias

- Se admite heterogeneidad sin DDL generado por usuarios.
- Original, checksum, esquema y versión permiten reproducir resultados.
- Consultas transaccionales fila a fila no son objetivo del portal.
- Los filtros disponibles dependen del perfil y tienen límites de filas/tiempo.
- Se requiere gestión de objetos huérfanos, compactación de lotes y evolución controlada del formato Parquet.
- El motor analítico puede cambiar sin alterar el catálogo ni la API pública.
