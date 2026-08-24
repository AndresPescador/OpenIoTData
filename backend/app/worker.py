from __future__ import annotations

import asyncio

from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery("openiotdata", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_always_eager=settings.celery_task_always_eager,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_time_limit=60 * 30,
    worker_prefetch_multiplier=1,
)


@celery_app.task(name="openiotdata.process_resource", autoretry_for=(), acks_late=True)
def process_resource_task(resource_id: str, job_id: str) -> None:
    from app.db.session import close_database
    from app.services.processing import process_resource

    async def run_in_fresh_loop() -> None:
        try:
            await process_resource(resource_id, job_id)
        finally:
            # Celery invokes this sync task repeatedly inside the same prefork child.
            # asyncio.run() creates a new loop each time, so pooled asyncpg connections
            # from a previous task must be disposed before that loop closes.
            await close_database()

    asyncio.run(run_in_fresh_loop())
