from fastapi import APIRouter, Depends

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
    UserCreateRequest,
    UserUpdateRequest,
    UserView,
)
from app.services.directory_store import DirectoryStore
from app.services.domain_service import DomainService
from app.services.relay_service import RelayService


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
