from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import require_admin
from app.schemas.ui_contract import UiContractResponse, UiContractUpdateRequest
from app.services.ui_contract_service import UiContractService


router = APIRouter(prefix="/ui-contract", tags=["ui-contract"])
admin_router = APIRouter(prefix="/ui-contract", tags=["ui-contract-admin"], dependencies=[Depends(require_admin)])


@router.get("", response_model=UiContractResponse)
def get_ui_contract() -> UiContractResponse:
    return UiContractService().get_contract()


@admin_router.get("/admin", response_model=UiContractResponse)
def get_admin_ui_contract() -> UiContractResponse:
    return UiContractService().get_contract()


@admin_router.put("/admin", response_model=UiContractResponse)
def update_admin_ui_contract(payload: UiContractUpdateRequest) -> UiContractResponse:
    return UiContractService().update_contract(payload)
