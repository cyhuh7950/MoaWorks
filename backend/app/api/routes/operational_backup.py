from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import require_admin
from app.schemas.directory import AuthUserSummary
from app.schemas.operational_backup import (
    OperationalBackupJobView,
    OperationalBackupOverview,
    OperationalBackupPolicyUpdate,
    OperationalBackupPolicyView,
    OperationalRestoreDrillView,
)
from app.services.operational_backup_service import OperationalBackupService


router = APIRouter()


def _service() -> OperationalBackupService:
    return OperationalBackupService()


def _raise_error(exc: Exception):
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "OPERATIONAL_BACKUP_INVALID", "userMessage": str(exc)}) from exc
    raise exc


@router.get("", response_model=OperationalBackupOverview)
def get_overview(actor: AuthUserSummary = Depends(require_admin)):
    return _service().get_overview(actor)


@router.put("/policy", response_model=OperationalBackupPolicyView)
def update_policy(payload: OperationalBackupPolicyUpdate, actor: AuthUserSummary = Depends(require_admin)):
    return _service().update_policy(actor, payload)


@router.post("/jobs", response_model=OperationalBackupJobView, status_code=status.HTTP_202_ACCEPTED)
def queue_backup(actor: AuthUserSummary = Depends(require_admin)):
    return _service().queue_backup(actor)


@router.post("/jobs/{backup_id}/restore-drills", response_model=OperationalRestoreDrillView, status_code=status.HTTP_202_ACCEPTED)
def queue_restore_drill(backup_id: str, actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().queue_restore_drill(actor, backup_id)
    except Exception as exc:
        _raise_error(exc)
