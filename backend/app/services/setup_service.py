from pathlib import Path

from app.core.config import settings
from app.schemas.setup import SetupInitializeRequest, SetupInitializeResponse, SetupValidateRequest, SetupValidateResponse
from app.services.directory_store import DirectoryStore
from app.services.postgres_service import PostgresService


class SetupPersistenceError(RuntimeError):
    pass


class SetupService:
    def __init__(self) -> None:
        self.directory_store = DirectoryStore()
        self.postgres = PostgresService()

    def validate(self, payload: SetupValidateRequest) -> SetupValidateResponse:
        errors: list[str] = []
        warnings: list[str] = []

        if self.directory_store.is_initialized():
            errors.append("이미 초기 설정이 완료된 시스템입니다.")

        storage_path = Path(payload.storagePath).resolve()
        try:
            storage_path.mkdir(parents=True, exist_ok=True)
            probe = storage_path / ".validate-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except OSError:
            errors.append("저장소 경로에 쓸 수 없습니다.")

        expected_storage_path = Path(settings.storage_local_path).resolve()
        if storage_path != expected_storage_path:
            errors.append("저장소 경로는 현재 실행 서버의 저장소 경로와 일치해야 합니다.")

        if payload.dbConfig.port in {80, 443}:
            warnings.append("DB 포트가 일반 웹 포트와 겹칩니다.")
        if "." not in payload.domain:
            errors.append("도메인 형식이 올바르지 않습니다.")
        if payload.relayType.lower() not in {"smtp", "aws_ses", "oci_email_delivery"}:
            errors.append("지원하지 않는 Relay 유형입니다.")
        errors.extend(self.postgres.validate_runtime_match(payload.dbConfig))

        try:
            self.postgres.test_connection(payload.dbConfig)
        except Exception:  # noqa: BLE001
            errors.append("PostgreSQL 연결을 확인할 수 없습니다.")

        return SetupValidateResponse(
            is_valid=not errors,
            errors=errors,
            warnings=warnings,
        )

    def initialize(self, payload: SetupInitializeRequest) -> SetupInitializeResponse:
        if payload.company.domain.strip().lower() != payload.domain.strip().lower():
            raise ValueError("회사 도메인과 초기 설정 도메인이 일치해야 합니다.")

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

        self.directory_store.initialize_installation(payload)
        verification = self.directory_store.verify_initialization(payload)
        if (
            int(verification["company_count"]) < 1
            or int(verification["admin_count"]) < 1
            or not verification["domain_matched"]
            or not verification["admin_email_matched"]
        ):
            raise SetupPersistenceError(
                "초기 설정 저장 후 DB 재검증에 실패했습니다. "
                f"companies={verification['company_count']}, "
                f"admin_users={verification['admin_count']}, "
                f"domain_matched={verification['domain_matched']}, "
                f"admin_email_matched={verification['admin_email_matched']}"
            )
        return SetupInitializeResponse(
            initialized=True,
            message="초기 설정이 PostgreSQL에 저장되었습니다. 관리자 웹에서 로그인 후 다음 단계 운영 기능으로 이동할 수 있습니다.",
        )
