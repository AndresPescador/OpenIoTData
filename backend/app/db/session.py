from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base

settings = get_settings()

engine = create_async_engine(
    settings.async_database_url,
    echo=settings.debug,
    pool_pre_ping=not settings.async_database_url.startswith("sqlite"),
)

if settings.async_database_url.startswith("sqlite"):

    @event.listens_for(engine.sync_engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        # Geometry4326 wraps writes with this PostGIS function; SQLite stores the EWKT fallback.
        dbapi_connection.create_function("ST_GeomFromEWKT", 1, lambda value: value)  # type: ignore[attr-defined]


SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def initialize_database() -> None:
    if not settings.auto_create_db:
        return
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def close_database() -> None:
    await engine.dispose()
