from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import require_admin
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_operations import (
    MailOperationsDomainUpdateRequest,
    MailOperationsProviderSwitchRequest,
    MailOperationsProviderTestRequest,
    MailOperationsProviderUpdateRequest,
)
from app.services.mail_admin_operations import MailAdminOperations


router = APIRouter()


def _service() -> MailAdminOperations:
    return MailAdminOperations()


def _raise_operation_error(exc: Exception):
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "MAIL_OPERATIONS_FORBIDDEN", "userMessage": str(exc)}) from exc
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "MAIL_OPERATIONS_INVALID", "userMessage": str(exc)}) from exc
    raise exc


@router.get("")
def get_mail_operations(actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().get_overview(actor)
    except Exception as exc:
        _raise_operation_error(exc)


@router.put("/domain")
def update_mail_domain(payload: MailOperationsDomainUpdateRequest, actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().update_domain(actor, payload)
    except Exception as exc:
        _raise_operation_error(exc)


@router.put("/providers/{provider_key}")
def update_mail_provider(provider_key: str, payload: MailOperationsProviderUpdateRequest, actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().update_provider(actor, provider_key, payload)
    except Exception as exc:
        _raise_operation_error(exc)


@router.post("/providers/switch")
def switch_mail_provider(payload: MailOperationsProviderSwitchRequest, actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().switch_provider(actor, payload.targetProvider)
    except Exception as exc:
        _raise_operation_error(exc)


@router.post("/providers/{provider_key}/test")
def test_mail_provider(provider_key: str, payload: MailOperationsProviderTestRequest, actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().test_provider(actor, provider_key, str(payload.recipient))
    except Exception as exc:
        _raise_operation_error(exc)


@router.post("/providers/rollback")
def rollback_mail_provider(actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().rollback_provider(actor)
    except Exception as exc:
        _raise_operation_error(exc)


@router.post("/oci/suppressions/sync")
def sync_oci_suppressions(actor: AuthUserSummary = Depends(require_admin)):
    try:
        return _service().sync_oci_suppressions(actor)
    except Exception as exc:
        _raise_operation_error(exc)
