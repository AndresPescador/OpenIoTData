from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import client_ip, require_user
from app.db.models import Dataset, Report, ReportStatus
from app.db.session import get_session
from app.schemas import AdminReportRead, CurrentUser, ReportStatusUpdate
from app.services.catalog import audit

router = APIRouter(prefix="/api/v1/admin", tags=["moderation"])


def require_moderator(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if "moderator" not in user.roles and "admin" not in user.roles:
        raise HTTPException(status_code=403, detail="Moderator role required")
    return user


@router.get("/reports", response_model=list[AdminReportRead])
async def list_reports(
    status: ReportStatus | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    _: CurrentUser = Depends(require_moderator),
    session: AsyncSession = Depends(get_session),
) -> list[AdminReportRead]:
    statement = (
        select(Report, Dataset)
        .join(Dataset, Dataset.id == Report.dataset_id)
        .order_by(Report.created_at.desc())
        .limit(limit)
    )
    if status:
        statement = statement.where(Report.status == status)
    rows = (await session.execute(statement)).all()
    return [
        AdminReportRead(
            id=report.id,
            dataset_id=dataset.id,
            dataset_title=dataset.title,
            dataset_owner=dataset.owner_subject,
            reporter_subject=report.reporter_subject,
            reason=report.reason,
            details=report.details,
            status=report.status.value,
            created_at=report.created_at,
        )
        for report, dataset in rows
    ]


@router.patch("/reports/{report_id}", response_model=AdminReportRead)
async def update_report(
    report_id: str,
    payload: ReportStatusUpdate,
    request: Request,
    user: CurrentUser = Depends(require_moderator),
    session: AsyncSession = Depends(get_session),
) -> AdminReportRead:
    row = (
        await session.execute(
            select(Report, Dataset)
            .join(Dataset, Dataset.id == Report.dataset_id)
            .where(Report.id == report_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    report, dataset = row
    report.status = ReportStatus(payload.status)
    audit(
        session,
        "report.status_updated",
        "report",
        report.id,
        user.subject,
        client_ip(request),
        {"status": payload.status},
    )
    await session.commit()
    return AdminReportRead(
        id=report.id,
        dataset_id=dataset.id,
        dataset_title=dataset.title,
        dataset_owner=dataset.owner_subject,
        reporter_subject=report.reporter_subject,
        reason=report.reason,
        details=report.details,
        status=report.status.value,
        created_at=report.created_at,
    )
