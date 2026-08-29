from contextlib import contextmanager

from app.schemas.setup import (
    AdminUserPayload,
    CompanyPayload,
    DbConfigPayload,
    MailProviderPayload,
    SetupInitializeRequest,
    StoragePayload,
)
from app.services.directory_store import DirectoryStore


class _PlaceholderCheckingCursor:
    def __init__(self) -> None:
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params=None) -> None:
        parameters = tuple(params or ())
        assert query.count("%s") == len(parameters), (
            f"SQL placeholder mismatch: expected {query.count('%s')}, "
            f"received {len(parameters)}"
        )
        self._row = {"count": 0} if "SELECT COUNT(*) AS count FROM companies" in query else None

    def fetchone(self):
        return self._row


class _Connection:
    def __init__(self) -> None:
        self.cursor_instance = _PlaceholderCheckingCursor()
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance

    def commit(self) -> None:
        self.committed = True


class _Database:
    def __init__(self) -> None:
        self.connection = _Connection()

    def ensure_migrations_applied(self, _config=None) -> None:
        return None

    @contextmanager
    def connect(self, _config=None):
        yield self.connection


class _Security:
    @staticmethod
    def encrypt_secret(value: str) -> str:
        return f"encrypted:{value}"

    @staticmethod
    def hash_password(value: str) -> str:
        return f"hashed:{value}"


def test_setup_initialize_sql_parameter_counts_match_placeholders():
    database = _Database()
    store = DirectoryStore.__new__(DirectoryStore)
    store.db = database
    store.security = _Security()
    payload = SetupInitializeRequest(
        company=CompanyPayload(name="QA Company", domain="qa.example.test"),
        adminUser=AdminUserPayload(
            name="QA Admin",
            email="admin@qa.example.test",
            password="fixture-password",
        ),
        domain="qa.example.test",
        mailProvider=MailProviderPayload(
            provider_type="smtp",
            relay_host="mail-layer",
            relay_port=587,
            username="qa-relay",
            password="fixture-relay-password",
        ),
        storage=StoragePayload(driver="local", local_path="/app/data/storage"),
        dbConfig=DbConfigPayload(
            host="postgres",
            port=5432,
            database="moaworks",
            user="moaworks",
            password="fixture-db-password",
        ),
    )

    store.initialize_installation(payload)

    assert database.connection.committed is True
