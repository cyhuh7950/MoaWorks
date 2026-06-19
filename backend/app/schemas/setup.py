from pydantic import BaseModel, Field, field_validator


class DbConfigPayload(BaseModel):
    host: str = Field(min_length=1)
    port: int = Field(ge=1, le=65535)
    database: str = Field(min_length=1)
    user: str = Field(min_length=1)
    password: str = Field(min_length=1)


class CompanyPayload(BaseModel):
    name: str = Field(min_length=1)
    domain: str = Field(min_length=1)


class AdminUserPayload(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=8)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class MailProviderPayload(BaseModel):
    provider_type: str = Field(min_length=1)
    relay_host: str = Field(min_length=1)
    relay_port: int = Field(ge=1, le=65535)
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class StoragePayload(BaseModel):
    driver: str = Field(min_length=1)
    local_path: str = Field(min_length=1)


class SetupValidateRequest(BaseModel):
    companyName: str = Field(min_length=1)
    domain: str = Field(min_length=1)
    adminEmail: str
    relayType: str = Field(min_length=1)
    storagePath: str = Field(min_length=1)
    dbConfig: DbConfigPayload

    @field_validator("adminEmail")
    @classmethod
    def validate_admin_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("이메일 형식이 올바르지 않습니다.")
        return normalized


class SetupValidateResponse(BaseModel):
    is_valid: bool
    errors: list[str]
    warnings: list[str]


class SetupInitializeRequest(BaseModel):
    company: CompanyPayload
    adminUser: AdminUserPayload
    domain: str = Field(min_length=1)
    mailProvider: MailProviderPayload
    storage: StoragePayload
    dbConfig: DbConfigPayload


class SetupInitializeResponse(BaseModel):
    initialized: bool
    message: str
