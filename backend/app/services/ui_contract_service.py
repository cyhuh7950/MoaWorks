from __future__ import annotations

import json
import tempfile
from pathlib import Path

from app.core.config import settings
from app.schemas.ui_contract import UiContract, UiContractResponse, UiContractUpdateRequest
from app.services.directory_store import DirectoryStore


class UiContractService:
    def __init__(self, state_path: Path | None = None, directory_store: DirectoryStore | None = None) -> None:
        self.state_path = state_path or settings.ui_contract_state_file
        self.directory_store = directory_store or DirectoryStore()

    def get_contract(self) -> UiContractResponse:
        contract = self._apply_installed_company_identity(self._load_contract())
        return UiContractResponse(**contract.model_dump(), source="server")

    def update_contract(self, payload: UiContractUpdateRequest) -> UiContractResponse:
        contract = UiContract(**payload.model_dump())
        self._save_contract(contract)
        contract = self._apply_installed_company_identity(contract)
        return UiContractResponse(**contract.model_dump(), source="server")

    def _apply_installed_company_identity(self, contract: UiContract) -> UiContract:
        identity = self.directory_store.get_public_company_identity()
        if identity is None:
            return contract
        payload = contract.model_dump()
        payload["company"] = {
            **payload["company"],
            "name": identity["name"],
            "domain": identity["domain"],
        }
        return UiContract(**payload)

    def _load_contract(self) -> UiContract:
        if not self.state_path.exists():
            return UiContract()
        payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            return UiContract(**payload)
        return UiContract()

    def _save_contract(self, contract: UiContract) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=str(self.state_path.parent),
            prefix=".ui-contract-state-",
            suffix=".tmp",
            delete=False,
        ) as temp_file:
            temp_file.write(json.dumps(contract.model_dump(), ensure_ascii=False, indent=2))
            temp_path = temp_file.name
        Path(temp_path).replace(self.state_path)
