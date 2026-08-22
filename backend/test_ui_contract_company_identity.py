import json

from app.schemas.ui_contract import UiContractUpdateRequest
from app.services.directory_store import DirectoryStore
from app.services.ui_contract_service import UiContractService


class FakeDirectoryStore:
    def __init__(self, company):
        self.company = company

    def get_public_company_identity(self):
        return self.company


class FakeCursor:
    def __init__(self, row):
        self.row = row
        self.query = ""

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query):
        self.query = query

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor


class FakeDatabase:
    def __init__(self, row):
        self.cursor = FakeCursor(row)
        self.migrations_checked = False

    def ensure_migrations_applied(self):
        self.migrations_checked = True

    def connect(self):
        return FakeConnection(self.cursor)


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


def test_directory_store_returns_normalized_active_company_identity():
    store = DirectoryStore.__new__(DirectoryStore)
    store.db = FakeDatabase({"name": " MoaWorks Dev ", "domain": "DEV.MOAWORKS.SINSAN.KR "})

    result = store.get_public_company_identity()

    assert result == {"name": "MoaWorks Dev", "domain": "dev.moaworks.sinsan.kr"}
    assert store.db.migrations_checked is True
    assert "WHERE status = 'active'" in store.db.cursor.query
