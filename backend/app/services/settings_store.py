import json
from pathlib import Path

from pydantic import BaseModel

from app.core.config import settings
from app.schemas.setup import (
    CompanyPayload,
    StoragePayload,
)
from app.services.security_service import SecurityService


class PersistedAdminUser(BaseModel):
    name: str
    email: str
    password_hash: str


class PersistedMailProvider(BaseModel):
    provider_type: str
    relay_host: str
    relay_port: int
    username: str
    encrypted_password: str


class PersistedDbConfig(BaseModel):
    host: str
    port: int
    database: str
    user: str
    encrypted_password: str


class PersistedSetupState(BaseModel):
    initialized: bool
    company: CompanyPayload
    admin_user: PersistedAdminUser
    domain: str
    mail_provider: PersistedMailProvider
    storage: StoragePayload
    db_config: PersistedDbConfig


class SettingsStore:
    def __init__(self, state_file: Path | None = None) -> None:
        self.state_file = state_file or settings.setup_state_file
        self.security = SecurityService()

    def ensure_parent(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> PersistedSetupState | None:
        if not self.state_file.exists():
            return None
        data = json.loads(self.state_file.read_text(encoding="utf-8"))
        data = self._migrate_legacy_state(data)
        return PersistedSetupState.model_validate(data)

    def save(self, state: PersistedSetupState) -> None:
        self.ensure_parent()
        self.state_file.write_text(state.model_dump_json(indent=2), encoding="utf-8")

    def is_initialized(self) -> bool:
        state = self.load()
        return bool(state and state.initialized)

    def _migrate_legacy_state(self, data: dict) -> dict:
        changed = False

        admin_user = data.get("admin_user", {})
        if "password" in admin_user and "password_hash" not in admin_user:
            admin_user["password_hash"] = self.security.hash_password(admin_user.pop("password"))
            changed = True

        mail_provider = data.get("mail_provider", {})
        if "password" in mail_provider and "encrypted_password" not in mail_provider:
            mail_provider["encrypted_password"] = self.security.encrypt_secret(mail_provider.pop("password"))
            changed = True

        db_config = data.get("db_config", {})
        if "password" in db_config and "encrypted_password" not in db_config:
            db_config["encrypted_password"] = self.security.encrypt_secret(db_config.pop("password"))
            changed = True

        if changed:
            self.ensure_parent()
            self.state_file.write_text(json.dumps(data, indent=2), encoding="utf-8")

        return data
