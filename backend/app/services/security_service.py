import base64
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet

from app.core.config import settings


class SecurityService:
    def __init__(self) -> None:
        key_material = hashlib.sha256(settings.setup_secret_key.encode("utf-8")).digest()
        self.fernet = Fernet(base64.urlsafe_b64encode(key_material))

    def hash_password(self, password: str) -> str:
        salt = secrets.token_bytes(16)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
        )
        return f"scrypt${base64.b64encode(salt).decode()}${base64.b64encode(derived).decode()}"

    def verify_password(self, password: str, password_hash: str) -> bool:
        algorithm, salt_b64, digest_b64 = password_hash.split("$", 2)
        if algorithm != "scrypt":
            return False
        salt = base64.b64decode(salt_b64.encode("utf-8"))
        expected = base64.b64decode(digest_b64.encode("utf-8"))
        candidate = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
        )
        return hmac.compare_digest(candidate, expected)

    def encrypt_secret(self, value: str) -> str:
        return self.fernet.encrypt(value.encode("utf-8")).decode("utf-8")

    def decrypt_secret(self, value: str) -> str:
        return self.fernet.decrypt(value.encode("utf-8")).decode("utf-8")
