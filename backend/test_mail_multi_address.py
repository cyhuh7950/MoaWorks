"""Local contract checks for additional owned mail identities."""

from pathlib import Path
from types import SimpleNamespace
from contextlib import contextmanager
import sqlite3

import pytest

from app.services.mail_delivery_service import MailDeliveryWorker, SmtpRelayAdapter
from app.services.mail_messenger_service import MailMessengerService
from app.schemas.mail_messenger import MailSendRequest
from app.services.mail_identity_service import MailIdentityService
from app.services.oci_email_operations import OciEmailOperations
from app.services.mail_transports import MailProviderRoutingAdapter


class IdentityCursor:
    def __init__(self, owner="user-a", active=True, provider=None):
        self.owner, self.active = owner, active
        self.provider = provider or {"provider_type": "oci_email_delivery", "dkim_domain": None, "encrypted_dkim_private_key": None}
        self.query = ""
        self.params = ()

    def execute(self, query, params):
        self.query, self.params = query, params

    def fetchone(self):
        if "FROM mail_addresses" in self.query:
            return {"address": self.params[2], "is_primary": False} if self.active and self.params[1] == self.owner else None
        return self.provider


def test_selected_address_requires_current_user_ownership():
    cursor = IdentityCursor()
    assert MailIdentityService.resolve_sender(cursor, "company-a", "user-a", "alias@sinsan.kr") == ("alias@sinsan.kr", True)
    with pytest.raises(ValueError, match="허용되지"):
        MailIdentityService.resolve_sender(cursor, "company-a", "user-b", "alias@sinsan.kr")
    assert "a.user_id=%s" in cursor.query and "a.active=TRUE" in cursor.query


@pytest.mark.parametrize("invalid", ["a@@sinsan.kr", "@sinsan.kr", "a@", "a b@sinsan.kr"])
def test_malformed_address_is_rejected_before_domain_lookup(invalid):
    with pytest.raises(ValueError, match="올바른 메일 주소"):
        MailIdentityService._normalize_address(invalid)


def test_new_oci_address_waits_for_domain_and_approved_sender():
    cursor = IdentityCursor()
    gateway = SimpleNamespace(snapshot=lambda domain: SimpleNamespace(
        email_domains=({"name": domain, "status": "ACTIVE"},),
        approved_senders=({"email": "someone-else@sinsan.kr", "status": "ACTIVE"},),
    ))
    service = MailIdentityService(db=object(), oci_gateway=gateway)
    with pytest.raises(ValueError, match="승인 발신자"):
        service._assert_outbound_ready(cursor, "company-a", "alias@sinsan.kr")
    gateway.snapshot = lambda domain: SimpleNamespace(email_domains=({"name": domain, "status": "ACTIVE"},), approved_senders=({"email": "alias@sinsan.kr", "status": "ACTIVE"},))
    service._assert_outbound_ready(cursor, "company-a", "alias@sinsan.kr")


def test_queue_time_oci_policy_never_fetches_remote_snapshot():
    cursor = IdentityCursor()
    gateway = SimpleNamespace(snapshot=lambda _domain: (_ for _ in ()).throw(AssertionError("remote OCI lookup during send")))
    service = MailIdentityService(db=object(), oci_gateway=gateway)
    for _ in range(2):
        service._assert_outbound_policy_local(cursor, "company-a", "alias@sinsan.kr")


@pytest.mark.parametrize("domain_status,address_active", [("pending", True), ("active", False)])
def test_web_send_rejects_unavailable_owned_domain_recipient_before_external_queue(domain_status, address_active):
    class Cursor:
        def __init__(self):
            self.rows = []
            self.provider_queried = False

        def execute(self, query, _params):
            if "SELECT domain FROM mail_managed_domains" in query:
                self.rows = [{"domain": "pending.test"}] if domain_status == "active" or "status='active'" not in query else []
            elif "SELECT a.address AS email" in query:
                self.rows = [{"email": "local@pending.test", "id": "local"}] if domain_status == "active" and address_active else []
            else:
                self.provider_queried = True
                raise AssertionError("mail storage or external provider must not be reached")

        def fetchall(self):
            return self.rows

    class Connection:
        def __init__(self): self.test_cursor = Cursor()
        @contextmanager
        def cursor(self): yield self.test_cursor

    class Database:
        def ensure_migrations_applied(self): pass

    connection = Connection()
    service = object.__new__(MailMessengerService)
    service.db = Database()
    service.attachment_storage = SimpleNamespace()
    service._now = lambda: __import__('datetime').datetime.now(__import__('datetime').UTC)
    service._new_id = lambda prefix: prefix
    service._fetch_mail_account = lambda _cursor, _user: {"id": "account", "email": "writer@example.test"}
    service._attachment_transaction = lambda: _attachment_transaction(connection)
    actor = SimpleNamespace(companyId="company-a", userId="writer", userName="Writer")
    with pytest.raises(ValueError, match="등록되지 않은 사내 주소"):
        service._save_mail(actor, MailSendRequest(to=["local@pending.test"], subject="test", bodyText="hello"), status_value="sent")
    assert not connection.test_cursor.provider_queried


@contextmanager
def _attachment_transaction(connection):
    yield connection, {}


def test_additional_self_hosted_domain_fails_closed_without_matching_dkim():
    cursor = IdentityCursor(provider={"provider_type": "self_hosted", "dkim_domain": "moaworks.sinsan.kr", "encrypted_dkim_private_key": "present"})
    service = MailIdentityService(db=object(), oci_gateway=object())
    with pytest.raises(ValueError, match="DKIM"):
        service._assert_outbound_ready(cursor, "company-a", "alias@sinsan.kr")
    service._assert_outbound_ready(cursor, "company-a", "alias@moaworks.sinsan.kr")


def test_selected_sender_survives_provider_override_in_both_adapters():
    envelope = {"sender_email": "alias@sinsan.kr", "sender_identity_selected": True, "recipient_email": "remote@example.net", "subject": "test", "body_text": "hello", "attachments": [], "queue_id": "queue-a"}
    provider = {"provider_type": "oci_email_delivery", "from_address": "old@moaworks.sinsan.kr", "relay_host": "smtp.example.net", "relay_port": 587, "username": "u", "password": "p"}
    legacy = SmtpRelayAdapter().build_message(envelope, provider)
    assert legacy["From"] == "alias@sinsan.kr"
    routed = MailProviderRoutingAdapter(self_hosted_transport=object(), oci_transport=object()).prepare(envelope, provider)
    assert routed.message["From"] == "alias@sinsan.kr"
    assert routed.envelope_from == "alias@sinsan.kr"
    envelope["sender_identity_selected"] = False
    assert SmtpRelayAdapter().build_message(envelope, provider)["From"] == "old@moaworks.sinsan.kr"


def test_disabled_selected_sender_is_blocked_before_adapter_call():
    class UnexpectedAdapter:
        def prepare(self, *_args):
            raise AssertionError("adapter must not run")
    result = MailDeliveryWorker("worker-a", UnexpectedAdapter()).deliver_claimed(
        {"sender_identity_selected": True, "sender_identity_active": False},
        {"delivery_enabled": True, "last_test_status": "success"},
    )
    assert result.status == "blocked"


def test_selected_sender_stays_blocked_after_provider_changes_to_wrong_dkim_domain():
    class UnexpectedAdapter:
        def prepare(self, *_args):
            raise AssertionError("adapter must not run")
    result = MailDeliveryWorker("worker-a", UnexpectedAdapter()).deliver_claimed(
        {"sender_identity_selected": True, "sender_identity_active": True, "sender_email": "alias@sinsan.kr"},
        {"provider_type": "self_hosted", "delivery_enabled": True, "last_test_status": "success",
         "dkim_domain": "moaworks.sinsan.kr", "dkim_private_key": "old-key"},
    )
    assert result.status == "blocked" and "DKIM" in result.error_message


def test_postfix_sender_login_map_keeps_existing_authenticated_ownership_guard():
    gateway = Path(__file__).resolve().parents[1] / "deploy" / "mail-gateway"
    master = (gateway / "master.cf").read_text()
    mapping = (gateway / "pgsql-sender-login.cf.template").read_text()
    assert "reject_authenticated_sender_login_mismatch" in master
    assert "SELECT c.username" in mapping and "ma.user_id=u.id" in mapping
    assert "ma.address=LOWER('%s')" in mapping and "ma.send_enabled=TRUE" in mapping


def test_oci_sync_includes_requested_alias_but_skips_receive_only_alias():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = lambda cursor, row: dict(zip([column[0] for column in cursor.description], row))
    connection.create_function('split_part', 3, lambda value, separator, index: value.split(separator)[index - 1])
    connection.executescript('''
        CREATE TABLE users(id TEXT,company_id TEXT,email TEXT,status TEXT);
        CREATE TABLE mail_addresses(user_id TEXT,company_id TEXT,address TEXT,active BOOLEAN,send_requested BOOLEAN,is_primary BOOLEAN);
        CREATE TABLE mail_managed_domains(company_id TEXT,domain TEXT,status TEXT,is_primary BOOLEAN);
        CREATE TABLE mail_provider_configs(company_id TEXT,provider_type TEXT,active BOOLEAN,from_address TEXT);
        INSERT INTO users VALUES ('user-a','company-a','alice@moaworks.sinsan.kr','active');
        INSERT INTO mail_managed_domains VALUES ('company-a','moaworks.sinsan.kr','active',TRUE),('company-a','sinsan.kr','active',FALSE);
        INSERT INTO mail_addresses VALUES ('user-a','company-a','receive@sinsan.kr',TRUE,FALSE,FALSE),('user-a','company-a','send@sinsan.kr',TRUE,TRUE,FALSE);
    ''')

    class Cursor:
        def __init__(self): self.value = None
        def __enter__(self): return self
        def __exit__(self, *_): return None
        def execute(self, query, params): self.value = connection.execute(query.replace('%s', '?'), params)
        def fetchall(self): return self.value.fetchall()

    class Database:
        def connect(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return None
        def cursor(self): return Cursor()

    calls = []
    class Gateway:
        def reconcile_senders(self, domain, desired, protected, **options):
            calls.append((domain, desired, options))
            return {'created': len(desired), 'deleted': 0, 'unchanged': 0}

    result = OciEmailOperations(Gateway()).reconcile_company(db=Database(), company_id='company-a', mail_domain='moaworks.sinsan.kr')
    assert result['created'] == 2
    assert ('sinsan.kr', {'send@sinsan.kr'}, {'delete_stale': False}) in calls
    assert all('receive@sinsan.kr' not in desired for _, desired, _ in calls)
    connection.close()


def test_admin_address_registration_reports_actual_domain_state_and_duplicate():
    class Database:
        duplicate = False
        def ensure_migrations_applied(self): return None
        def connect(self): return self
        def cursor(self): return self
        def __enter__(self): return self
        def __exit__(self, *_): return None
        def commit(self): return None
        def execute(self, query, params):
            if 'SELECT id,status FROM users' in query: self.row = {'id': 'user-a', 'status': 'active'}
            elif 'SELECT status FROM mail_managed_domains' in query: self.row = {'status': 'active'}
            elif 'INSERT INTO mail_addresses' in query:
                self.row = None if self.duplicate else {'address': params[3], 'user_id': params[2], 'is_primary': False, 'active': False, 'send_requested': False, 'send_enabled': False}
            else: self.row = None
        def fetchone(self): return self.row

    db = Database()
    actor = SimpleNamespace(companyId='company-a', userId='admin', userName='Admin')
    service = MailIdentityService(db=db, oci_gateway=object())
    created = service.add_address(actor, 'user-a', 'alias@sinsan.kr')
    assert created['domainStatus'] == 'active' and created['sendRequested'] is False
    db.duplicate = True
    with pytest.raises(ValueError, match='이미 사용 중'):
        service.add_address(actor, 'user-a', 'alias@sinsan.kr')
