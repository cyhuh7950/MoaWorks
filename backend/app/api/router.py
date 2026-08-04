from fastapi import APIRouter, Depends

from app.api.dependencies import require_admin
from app.api.routes import admin, admin_access_internal, approvals, auth, content_operations, health, mail, mail_internal, mail_operations_admin, messenger, monitoring, notifications, setup, translation, ui_contract, workspace


api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(setup.router, prefix="/setup", tags=["setup"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(mail_operations_admin.router, prefix="/admin/mail-operations", tags=["admin-mail-operations"])
api_router.include_router(content_operations.router, prefix="/admin", tags=["content-admin"])
api_router.include_router(approvals.admin_router, prefix="/admin/approvals", tags=["approvals-admin"])
api_router.include_router(approvals.router, prefix="/approvals", tags=["approvals"])
api_router.include_router(mail.router, prefix="/mail", tags=["mail"])
api_router.include_router(mail_internal.router, prefix="/internal/mail", tags=["mail-internal"])
api_router.include_router(admin_access_internal.router, prefix="/internal/admin-access", tags=["admin-access-internal"])
api_router.include_router(messenger.router, prefix="/messenger", tags=["messenger"])
api_router.include_router(workspace.router, prefix="/workspace", tags=["workspace"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(monitoring.router, prefix="/admin/monitoring", tags=["monitoring"])
api_router.include_router(translation.router, tags=["translation"])
api_router.include_router(translation.admin_router, tags=["translation-admin"])
api_router.include_router(ui_contract.router, tags=["ui-contract"])
api_router.include_router(ui_contract.admin_router, tags=["ui-contract-admin"])
api_router.add_api_route(
    "/internal/observability/events",
    notifications.emit_internal_event,
    methods=["POST"],
    response_model=dict,
    dependencies=[Depends(require_admin)],
)
