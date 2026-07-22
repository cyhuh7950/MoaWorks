from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import require_admin
from app.schemas.directory import (
    AuthUserSummary,
    DepartmentCreateRequest,
    DepartmentRecord,
    DirectoryOverviewResponse,
    DomainVerifyRequest,
    DomainVerifyResponse,
    RelayTestRequest,
    RelayTestResponse,
    RoleCreateRequest,
    RoleRecord,
    RoleUpdateRequest,
    UserCreateRequest,
    UserUpdateRequest,
    UserView,
)
from app.services.directory_store import DirectoryStore
from app.services.domain_service import DomainService
from app.services.relay_service import RelayService
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.schemas.mail_messenger import (
    MailDeliveryProviderTestRequest, MailDeliveryProviderUpdateRequest, MailDeliveryProviderView,
    MailDeliveryQueueDetailResponse, MailDeliveryQueueListResponse, MailDeliveryStatusResponse,
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


@router.post("/users", response_model=UserView)
def create_user(
    payload: UserCreateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> UserView:
    return DirectoryStore().create_user(payload)


@router.patch("/users/{user_id}", response_model=UserView)
def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    _: AuthUserSummary = Depends(require_admin),
) -> UserView:
    return DirectoryStore().update_user(user_id, payload)


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


def _delivery_service() -> MailDeliveryOperations:
    return MailDeliveryOperations()

def _delivery_error(exc: Exception):
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
