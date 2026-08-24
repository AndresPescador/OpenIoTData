from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, datasets, ingestion, public, system
from app.core.body_limit import RequestBodyLimitMiddleware
from app.core.config import get_settings
from app.core.rate_limit import InMemoryRateLimitMiddleware
from app.db.session import close_database, initialize_database
from app.services.storage import get_storage

settings = get_settings()
logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.dev_auth_bypass:
        logger.warning(
            "DEV_AUTH_BYPASS IS ACTIVE. Requests impersonate X-Dev-User; "
            "never use this in production."
        )
    await initialize_database()
    await get_storage(settings).ensure_ready()
    yield
    await close_database()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description=(
        "Catálogo público, publicación versionada e ingesta heterogénea de sensores IoT. "
        "No acepta SQL proporcionado por usuarios."
    ),
    openapi_url=f"{settings.api_prefix}/openapi.json",
    docs_url=f"{settings.api_prefix}/docs",
    redoc_url=f"{settings.api_prefix}/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Dev-User"],
)
app.add_middleware(InMemoryRateLimitMiddleware, requests_per_minute=settings.rate_limit_per_minute)
app.add_middleware(
    RequestBodyLimitMiddleware,
    batch_max_bytes=settings.max_batch_bytes,
    query_max_bytes=settings.max_query_body_bytes,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), camera=(), microphone=()")
    if request.url.path.startswith(settings.api_prefix):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(system.router)
app.include_router(datasets.router)
app.include_router(ingestion.router)
app.include_router(public.router)
app.include_router(admin.router)
