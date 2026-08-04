from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import require_admin
from app.schemas.directory import (
    AuthUserSummary,
    DepartmentCreateRequest,
    DepartmentUpdateRequest,
    DepartmentRecord,
    DirectoryOverviewResponse,
    DomainVerifyRequest,
    DomainVerifyResponse,
    OrgImportApplyRequest,
    OrgImportBatchResponse,
    RelayTestRequest,
    RelayTestResponse,
    RoleCreateRequest,
    RoleRecord,
    RoleUpdateRequest,
    UserCreateRequest,
    UserUpdateRequest,
    UserView,
)
from app.services.directory_store import DirectoryStore, DirectoryUserEmailConflictError
from app.services.domain_service import DomainService
from app.services.org_import_service import OrgImportService
from app.services.relay_service import RelayService
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_messenger_service import MailMessengerService
from app.services.resource_policy import ResourceNotFoundError
from app.schemas.mail_messenger import (
    MailDeliveryProviderTestRequest, MailDeliveryProviderUpdateRequest, MailDeliveryProviderView,
    MailDeliveryQueueDetailResponse, MailDeliveryQueueListResponse, MailDeliveryStatusResponse,
    MessengerRoomDeleteResponse,
)


router = APIRouter()


@router.get("/directory", response_model=DirectoryOverviewResponse)
def get_directory(_: AuthUserSummary = Depends(require_admin)) -> DirectoryOverviewResponse:
    return DirectoryStore().get_overview()


@router.post("/departments", response_model=DepartmentRecord)
def create_department(
    payload: DepartmentCreateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> DepartmentRecord:
    return DirectoryStore().create_department(payload.name, payload.parentId, payload.sortOrder)


@router.patch("/departments/{department_id}", response_model=DepartmentRecord)
def update_department(
    department_id: str,
    payload: DepartmentUpdateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> DepartmentRecord:
    return DirectoryStore().update_department(department_id, payload)


@router.delete("/departments/{department_id}", response_model=DepartmentRecord)
def delete_department(
    department_id: str,
    _: AuthUserSummary = Depends(require_admin),
) -> DepartmentRecord:
    return DirectoryStore().delete_department(department_id)


@router.post("/roles", response_model=RoleRecord)
def create_role(
    payload: RoleCreateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> RoleRecord:
    return DirectoryStore().create_role(payload.name, payload.permissions)


@router.patch("/roles/{role_id}", response_model=RoleRecord)
def update_role(
    role_id: str,
    payload: RoleUpdateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> RoleRecord:
    return DirectoryStore().update_role(role_id, payload)


@router.delete("/roles/{role_id}", response_model=RoleRecord)
def delete_role(
    role_id: str,
    _: AuthUserSummary = Depends(require_admin),
) -> RoleRecord:
    return DirectoryStore().delete_role(role_id)


@router.post("/users", response_model=UserView)
def create_user(
    payload: UserCreateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> UserView:
    try:
        return DirectoryStore().create_user(payload)
    except DirectoryUserEmailConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "USER_EMAIL_CONFLICT", "userMessage": str(exc), "adminMessage": str(exc)},
        ) from exc


@router.patch("/users/{user_id}", response_model=UserView)
def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> UserView:
    return DirectoryStore().update_user(user_id, payload)


@router.delete("/users/{user_id}", response_model=UserView)
def delete_user(
    user_id: str,
    actor: AuthUserSummary = Depends(require_admin),
) -> UserView:
    return DirectoryStore().delete_user(actor.userId, user_id)


@router.post("/domains/verify", response_model=DomainVerifyResponse)
def verify_domain(
    payload: DomainVerifyRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> DomainVerifyResponse:
    return DomainService(DirectoryStore()).verify(payload.domain)


@router.post("/relay/test", response_model=RelayTestResponse)
def test_relay(
    payload: RelayTestRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> RelayTestResponse:
    return RelayService(DirectoryStore()).test(payload.providerConfigId, payload.testRecipient)


@router.get("/org-import/template")
def download_org_import_template(_: AuthUserSummary = Depends(require_admin)) -> StreamingResponse:
    content = OrgImportService().build_template()
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="moaworks-org-import-template.xlsx"'},
    )


@router.post("/org-import/validate", response_model=OrgImportBatchResponse)
async def validate_org_import(
    file: UploadFile = File(...),
    deactivation_scope: str = Form("uploaded_departments_only"),
    actor: AuthUserSummary = Depends(require_admin),
) -> OrgImportBatchResponse:
    service = OrgImportService()
    try:
        service.validate_file_metadata(file.filename or "", file.content_type)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "ORG_IMPORT_FILE_INVALID", "userMessage": str(exc)},
        ) from exc

    content = await file.read(service.MAX_UPLOAD_BYTES + 1)
    if len(content) > service.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "ORG_IMPORT_FILE_TOO_LARGE", "userMessage": "업로드 파일은 10 MiB 이하여야 합니다."},
        )
    try:
        return service.validate_upload(actor, file.filename or "org-import.xlsx", content, deactivation_scope)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "ORG_IMPORT_FILE_INVALID", "userMessage": str(exc)},
        ) from exc


@router.post("/org-import/apply", response_model=OrgImportBatchResponse)
def apply_org_import(
    payload: OrgImportApplyRequest,
    actor: AuthUserSummary = Depends(require_admin),
) -> OrgImportBatchResponse:
    try:
        return OrgImportService().apply_batch(actor, payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "ORG_IMPORT_APPLY_INVALID", "userMessage": str(exc), "adminMessage": str(exc)},
        ) from exc


@router.get("/org-import/{batch_id}", response_model=OrgImportBatchResponse)
def get_org_import_batch(
    batch_id: str,
    _: AuthUserSummary = Depends(require_admin),
) -> OrgImportBatchResponse:
    return OrgImportService().get_batch(batch_id)


def _delivery_service() -> MailDeliveryOperations:
    return MailDeliveryOperations()

def _delivery_error(exc: Exception):
    if isinstance(exc, ResourceNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code":"MAIL_DELIVERY_NOT_FOUND","userMessage":"대상을 찾을 수 없습니다.","adminMessage":str(exc)})
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code":"MAIL_DELIVERY_FORBIDDEN","userMessage":str(exc)})
    if isinstance(exc, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code":"MAIL_DELIVERY_INVALID","userMessage":str(exc)})
    raise exc

@router.get("/mail-delivery/status", response_model=MailDeliveryStatusResponse)
def get_mail_delivery_status(user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().get_status(user)
    except Exception as exc: _delivery_error(exc)

@router.get("/mail-delivery/queue", response_model=MailDeliveryQueueListResponse)
def get_mail_delivery_queue(status_filter: str | None = Query(default=None, alias="status"), limit: int = Query(default=100,ge=1,le=200), offset: int = Query(default=0,ge=0), user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().list_queue(user,status_filter,limit,offset)
    except Exception as exc: _delivery_error(exc)

@router.get("/mail-delivery/queue/{queue_id}", response_model=MailDeliveryQueueDetailResponse)
def get_mail_delivery_queue_detail(queue_id: str, user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().queue_detail(user,queue_id)
    except Exception as exc: _delivery_error(exc)

@router.post("/mail-delivery/queue/{queue_id}/retry", response_model=MailDeliveryQueueDetailResponse)
def retry_mail_delivery(queue_id: str, user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().retry(user,queue_id)
    except Exception as exc: _delivery_error(exc)

@router.post("/mail-delivery/provider/test", response_model=MailDeliveryProviderView)
def test_mail_delivery_provider(payload: MailDeliveryProviderTestRequest, user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().test_provider(user,payload.timeoutSeconds)
    except Exception as exc: _delivery_error(exc)

@router.patch("/mail-delivery/provider", response_model=MailDeliveryProviderView)
def update_mail_delivery_provider(payload: MailDeliveryProviderUpdateRequest, user: AuthUserSummary = Depends(require_admin)):
    try: return _delivery_service().update_provider(user,payload)
    except Exception as exc: _delivery_error(exc)


@router.delete("/messenger/rooms/{room_id}", response_model=MessengerRoomDeleteResponse)
def admin_delete_messenger_room(
    room_id: str,
    user: AuthUserSummary = Depends(require_admin),
) -> MessengerRoomDeleteResponse:
    try:
        return MailMessengerService().delete_room(user, room_id, allow_admin=True)
    except ResourceNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "MESSENGER_NOT_FOUND", "userMessage": "대상을 찾을 수 없습니다.", "adminMessage": str(exc)},
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "MESSENGER_FORBIDDEN", "userMessage": str(exc)},
        ) from exc
