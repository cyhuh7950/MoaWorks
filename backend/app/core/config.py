from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MoaWorks"
    app_env: str = "local"
    app_locale: str = "ko-KR"
    app_timezone: str = "Asia/Seoul"

    backend_host: str = "0.0.0.0"
    backend_port: int = 8510
    frontend_port: int = 3510

    postgres_host: str = "postgres"
    postgres_db: str = "moaworks"
    postgres_user: str = "moaworks"
    postgres_password: str = "change-me"
    postgres_port: int = 5432

    mail_layer_host: str = "mail-layer"
    mail_layer_smtp_port: int = 587
    mail_layer_imap_port: int = 993
    mail_ingest_token: str = ""
    mail_inbound_max_message_bytes: int = 25 * 1024 * 1024

    storage_driver: str = "local"
    storage_local_path: str = "./data/storage"
    mail_attachment_max_files: int = 10
    mail_attachment_max_file_bytes: int = 10 * 1024 * 1024
    mail_attachment_max_total_bytes: int = 25 * 1024 * 1024
    mail_scheduler_enabled: bool = True
    mail_scheduler_interval_seconds: int = 30
    schedule_notification_enabled: bool = True
    schedule_notification_interval_seconds: int = 30
    mail_backup_poll_seconds: int = 5
    mail_backup_lease_minutes: int = 10
    mail_backup_ttl_hours: int = 24
    mail_retention_poll_seconds: int = 60
    mail_retention_batch_size: int = 500

    watcher_enabled: bool = True
    watcher_interval_seconds: int = 60

    translation_enabled: bool = False
    translation_provider: str = "disabled"
    translation_state_path: str = "./data/runtime/translation-state.json"
    translation_cache_path: str = "./data/runtime/translation-cache.json"
    ui_contract_state_path: str = "./data/runtime/ui-contract-state.json"

    setup_state_path: str = "./data/runtime/setup-state.json"
    directory_state_path: str = "./data/runtime/directory-state.json"
    setup_secret_key: str = "change-this-stage1-secret-key"
    cors_allowed_origins: list[str] = [
        "http://localhost:3510",
        "http://127.0.0.1:3510",
        "http://localhost:3520",
        "http://127.0.0.1:3520",
    ]
    observability_state_path: str = "./data/runtime/observability-state.json"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def setup_state_file(self) -> Path:
        return Path(self.setup_state_path).resolve()

    @property
    def directory_state_file(self) -> Path:
        return Path(self.directory_state_path).resolve()

    @property
    def observability_state_file(self) -> Path:
        return Path(self.observability_state_path).resolve()

    @property
    def translation_state_file(self) -> Path:
        return Path(self.translation_state_path).resolve()

    @property
    def translation_cache_file(self) -> Path:
        return Path(self.translation_cache_path).resolve()

    @property
    def ui_contract_state_file(self) -> Path:
        return Path(self.ui_contract_state_path).resolve()

    @property
    def storage_path(self) -> Path:
        return Path(self.storage_local_path).resolve()


settings = Settings()
