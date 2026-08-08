import json

from app.schemas.ui_contract import UiContractUpdateRequest
from app.services.ui_contract_service import UiContractService


class FakeDirectoryStore:
    def __init__(self, company):
        self.company = company

    def get_public_company_identity(self):
        return self.company


def stale_contract():
    return {
        "brand": {
            "primary": "#123456",
            "secondary": "#111827",
            "accent": "#9a6b2f",
            "blocked": "#9f1239",
        },
        "company": {
            "name": "오래된 이름",
            "domain": "moaworks.local",
            "logoDataUrl": "",
        },
        "menuOrder": ["메일"],
        "homeCardOrder": ["mail"],
        "quickComposeVisible": True,
        "helpText": "Help",
        "messages": {},
    }


def test_public_contract_uses_installed_company_identity_for_login_domain(tmp_path):
    state_path = tmp_path / "ui-contract.json"
    state_path.write_text(json.dumps(stale_contract(), ensure_ascii=False), encoding="utf-8")
    service = UiContractService(
        state_path=state_path,
        directory_store=FakeDirectoryStore({"name": "MoaWorks Dev", "domain": "dev.moaworks.sinsan.kr"}),
    )

    result = service.get_contract()

    assert result.company.name == "MoaWorks Dev"
    assert result.company.domain == "dev.moaworks.sinsan.kr"
    assert result.brand.primary == "#123456"
    assert result.menuOrder == ["메일"]


def test_admin_contract_update_cannot_replace_installed_login_domain(tmp_path):
    state_path = tmp_path / "ui-contract.json"
    service = UiContractService(
        state_path=state_path,
        directory_store=FakeDirectoryStore({"name": "MoaWorks Dev", "domain": "dev.moaworks.sinsan.kr"}),
    )
    payload = UiContractUpdateRequest(**stale_contract())

    result = service.update_contract(payload)

    assert result.company.name == "MoaWorks Dev"
    assert result.company.domain == "dev.moaworks.sinsan.kr"
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted["brand"]["primary"] == "#123456"
