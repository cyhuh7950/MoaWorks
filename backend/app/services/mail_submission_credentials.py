from __future__ import annotations

import secrets

from passlib.hash import sha512_crypt


def generate_submission_password() -> str:
    return secrets.token_urlsafe(24)


def hash_submission_password(password: str) -> str:
    return "{SHA512-CRYPT}" + sha512_crypt.hash(password)


def verify_submission_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("{SHA512-CRYPT}"):
        return False
    return sha512_crypt.verify(password, password_hash.removeprefix("{SHA512-CRYPT}"))


def build_submission_username(user_email: str) -> str:
    local, separator, domain = user_email.strip().partition("@")
    if not separator or not local or not domain:
        raise ValueError("사용자 이메일 형식이 올바르지 않습니다.")
    return f"{local}@{domain.lower()}"
