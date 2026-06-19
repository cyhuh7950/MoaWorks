from pathlib import Path

from app.schemas.setup import (
    SetupInitializeRequest,
    SetupInitializeResponse,
    SetupValidateRequest,
    SetupValidateResponse,
)
from app.services.security_service import SecurityService
from app.services.settings_store import (
    PersistedAdminUser,
    PersistedDbConfig,
    PersistedMailProvider,
    PersistedSetupState,
    SettingsStore,
)


class SetupService:
    def __init__(self, store: SettingsStore) -> None:
        self.store = store
        self.security = SecurityService()

    def validate(self, payload: SetupValidateRequest) -> SetupValidateResponse:
        errors: list[str] = []
        warnings: list[str] = []

        if self.store.is_initialized():
            errors.append("이미 초기 설정이 완료된 시스템입니다.")

        storage_path = Path(payload.storagePath).resolve()
        try:
            storage_path.mkdir(parents=True, exist_ok=True)
            probe = storage_path / ".validate-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError:
            errors.append("저장소 경로에 쓸 수 없습니다.")

        if payload.dbConfig.port in {80, 443}:
            warnings.append("DB 포트가 일반 웹 포트와 겹칩니다.")
        if "." not in payload.domain:
            errors.append("도메인 형식이 올바르지 않습니다.")
        if payload.relayType.lower() not in {"smtp", "aws_ses", "oci_email_delivery"}:
            errors.append("지원하지 않는 Relay 유형입니다.")

        return SetupValidateResponse(
            is_valid=not errors,
            errors=errors,
            warnings=warnings,
        )

    def initialize(self, payload: SetupInitializeRequest) -> SetupInitializeResponse:
        validation = self.validate(
            SetupValidateRequest(
                companyName=payload.company.name,
                domain=payload.domain,
                adminEmail=payload.adminUser.email,
                relayType=payload.mailProvider.provider_type,
                storagePath=payload.storage.local_path,
                dbConfig=payload.dbConfig,
            )
        )
        if not validation.is_valid:
            raise ValueError(", ".join(validation.errors))

        state = PersistedSetupState(
            initialized=True,
            company=payload.company,
            admin_user=PersistedAdminUser(
                name=payload.adminUser.name,
                email=payload.adminUser.email,
                password_hash=self.security.hash_password(payload.adminUser.password),
            ),
            domain=payload.domain,
            mail_provider=PersistedMailProvider(
                provider_type=payload.mailProvider.provider_type,
                relay_host=payload.mailProvider.relay_host,
                relay_port=payload.mailProvider.relay_port,
                username=payload.mailProvider.username,
                encrypted_password=self.security.encrypt_secret(payload.mailProvider.password),
            ),
            storage=payload.storage,
            db_config=PersistedDbConfig(
                host=payload.dbConfig.host,
                port=payload.dbConfig.port,
                database=payload.dbConfig.database,
                user=payload.dbConfig.user,
                encrypted_password=self.security.encrypt_secret(payload.dbConfig.password),
            ),
        )
        self.store.save(state)
        return SetupInitializeResponse(
            initialized=True,
            message="초기 설정이 저장되었습니다. 관리자 웹에서 다음 단계 운영 기능으로 이동할 수 있습니다.",
        )
