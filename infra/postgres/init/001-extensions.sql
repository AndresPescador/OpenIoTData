CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- Keycloak comparte la instancia local, pero mantiene sus tablas aisladas.
-- En producción debe usar una base de datos o instancia independiente.
CREATE SCHEMA IF NOT EXISTS keycloak;
