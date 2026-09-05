from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from app.services.mail_admin_operations import MailAdminOperations
from app.services.relay_service import RelayService
from app.schemas.mail_operations import MailOperationsProviderUpdateRequest


def record(key='provider-1', company='company-1', **values):
    return dict(id=key, company_id=company, provider_type='oci_email_delivery', relay_host='smtp.invalid',
        relay_port=587, tls_mode='starttls', username='synthetic-user', encrypted_password='synthetic-cipher', active=True,
        delivery_enabled=False, last_test_status='untested', **values)


class Db:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []
        self.commits = 0

    def ensure_migrations_applied(self):
        pass

    @contextmanager
    def connect(self):
        yield self

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        self.result = []
        if 'SELECT' in sql and 'mail_provider_configs' in sql:
            company, selector = params
            self.result = [r.copy() for r in self.rows if r['company_id'] == company and
                (r['provider_type'] in selector if isinstance(selector, list) else r['id'] == selector)]
        elif sql.startswith('UPDATE mail_provider_configs'):
            # UPDATE 연결검증 전용 계약을 실제 저장상태에 적용한다.
            columns = sql.split(' SET ', 1)[1].split(' WHERE ', 1)[0].split(',')
            row = next(r for r in self.rows if r['id'] == params[-2] and r['company_id'] == params[-1])
            for column, value in zip(columns, params):
                name = column.strip().split('=')[0]
                row[name] = value
            self.result = [row.copy()]
        elif 'mail_domain_settings' in sql:
            self.result = [{'mail_domain': 'example.invalid', 'mail_host': 'mail.invalid'}]

    def fetchone(self):
        return self.result.pop(0) if self.result else None

    def fetchall(self):
        return self.result

    def commit(self):
        self.commits += 1


def actor():
    return SimpleNamespace(companyId='company-1', userId='admin-1', userName='관리자')


class SMTP:
    calls = []
    def __init__(self, *args, **kwargs):
        self.calls.append(('connect', args))
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def ehlo(self): self.calls.append(('ehlo',)); return 250, b'ok'
    def starttls(self, **kwargs): self.calls.append(('tls',)); return 220, b'ok'
    def login(self, *args): self.calls.append(('auth',)); return 235, b'ok'


@pytest.fixture(autouse=True)
def prevent_network(monkeypatch):
    SMTP.calls = []
    monkeypatch.setattr('smtplib.SMTP', SMTP)
    monkeypatch.setattr('smtplib.SMTP_SSL', SMTP)
    monkeypatch.setattr('app.services.security_service.SecurityService.decrypt_secret', lambda *_: 'synthetic-password')


def test_type_ambiguity_rejected_without_choosing_latest():
    db = Db([record(), record('provider-2'), record('other', 'company-2')])
    with pytest.raises(ValueError, match='명시|중복'):
        MailAdminOperations._find_provider(db, 'company-1', 'oci_email_delivery')


def test_explicit_id_company_scope():
    db = Db([record(), record('provider-2'), record('other', 'company-2')])
    assert MailAdminOperations._find_provider(db, 'company-1', 'provider-2')['id'] == 'provider-2'
    with pytest.raises(ValueError):
        MailAdminOperations._find_provider(db, 'company-1', 'other')


@pytest.mark.parametrize('enabled', [False, True])
def test_connection_test_does_not_send_data_or_change_lock(enabled):
    row = record(); row['delivery_enabled'] = enabled
    db = Db([row])
    service = MailAdminOperations(db=db, delivery_adapter=SimpleNamespace())
    result = service.test_provider(actor(), 'oci_email_delivery', 'unused@example.invalid')
    assert result['lastTestStatus'] == 'success'
    assert result['deliveryEnabled'] is enabled
    assert [call[0] for call in SMTP.calls] == ['connect', 'ehlo', 'tls', 'ehlo', 'auth']
    assert row['active'] is True


def test_legacy_mail_layer_string_is_not_success(monkeypatch):
    provider = SimpleNamespace(id='p1', providerType='smtp', relayHost='mail-layer')
    store = SimpleNamespace(get_provider=lambda *a, **kw: provider,
        update_relay_test_status=lambda *a, **kw: provider)
    service = RelayService(store)
    monkeypatch.setattr(service, '_emit_relay_event', lambda **kw: None)
    result = service.test(None, 'person@example.invalid', company_id='company-1')
    assert result.status == 'untested'
    assert '미검증' in result.message
    assert SMTP.calls == []


@pytest.mark.parametrize('enabled', [False, True])
@pytest.mark.parametrize('kind', ['oci_email_delivery', 'oci_smtp', 'self_hosted', 'self_hosted_smtp', 'smtp'])
def test_explicit_lock_request_preserves_inactive_and_does_not_probe(enabled, kind):
    row = record(); row.update(active=False, last_test_status='success', delivery_enabled=not enabled)
    row['provider_type'] = kind
    db = Db([row])
    result = MailAdminOperations(db=db).update_provider(actor(), 'provider-1',
        MailOperationsProviderUpdateRequest(deliveryEnabled=enabled))
    assert result['deliveryEnabled'] is enabled
    assert row['active'] is False
    assert row['provider_type'] == kind and row['last_test_status'] == 'success'
    assert SMTP.calls == []
    assert db.commits == 1


def test_unlock_before_connection_success_is_rejected():
    db = Db([record()])
    with pytest.raises(ValueError, match='테스트 성공'):
        MailAdminOperations(db=db).update_provider(actor(), 'provider-1',
            MailOperationsProviderUpdateRequest(deliveryEnabled=True))
    assert db.commits == 0
    assert db.rows[0]['delivery_enabled'] is False


def test_probe_failure_preserves_lock_and_hides_exception(monkeypatch):
    row = record(); row['delivery_enabled'] = True
    def broken(*args, **kwargs): raise RuntimeError('synthetic-private-token@example.invalid')
    monkeypatch.setattr('smtplib.SMTP', broken)
    result = MailAdminOperations(db=Db([row])).test_provider(actor(), 'provider-1', 'unused@example.invalid')
    assert result['lastTestStatus'] == 'failed'
    assert result['deliveryEnabled'] is True
    assert 'synthetic-private' not in str(result)


def test_company_type_lock_precedes_lookup_and_creation(monkeypatch):
    db = Db([])
    service = MailAdminOperations(db=db)
    def create(cursor, company, key, values):
        assert company == 'company-1' and key == 'oci_email_delivery'
        assert 'pg_advisory_xact_lock' in db.statements[0][0]
        assert db.statements[0][1] == ('company-1', 'oci_email_delivery')
        assert 'FOR UPDATE' in db.statements[1][0]
        row = record(); db.rows.append(row); return row
    monkeypatch.setattr(service, '_create_locked_provider', create)
    service.update_provider(actor(), 'oci_email_delivery', MailOperationsProviderUpdateRequest())
    assert len(db.rows) == 1 and db.commits == 1


def test_two_creators_serialize_before_missing_row_lookup():
    # 실제 메서드 두 호출 + transaction lock 경계 double. PostgreSQL 경합 증거는 아니다.
    import threading
    gate = threading.Lock()
    first_creating, second_waiting, release = threading.Event(), threading.Event(), threading.Event()
    rows, results, errors = [], [], []
    class TransactionDb(Db):
        @contextmanager
        def connect(self):
            self.locked = False
            try: yield self
            finally:
                if self.locked: gate.release()
        def execute(self, sql, params=()):
            if 'pg_advisory_xact_lock' in sql:
                if threading.current_thread().name == 'second': second_waiting.set()
                gate.acquire(); self.locked = True
            super().execute(sql, params)
    def run():
        db = TransactionDb(rows)
        service = MailAdminOperations(db=db)
        def create(*args):
            first_creating.set()
            assert release.wait(3)
            row = record(); rows.append(row); return row
        service._create_locked_provider = create
        try: results.append(service.update_provider(actor(), 'oci_email_delivery', MailOperationsProviderUpdateRequest()))
        except Exception as exc: errors.append(exc)
    first = threading.Thread(target=run, name='first')
    second = threading.Thread(target=run, name='second')
    first.start()
    try:
        assert first_creating.wait(3)
        second.start()
        assert second_waiting.wait(3)
    finally:
        release.set(); first.join(3)
        if second.ident: second.join(3)
    assert not first.is_alive() and not second.is_alive()
    assert errors == [] and len(rows) == 1 and len(results) == 2
    assert {result['providerId'] for result in results} == {'provider-1'}


@pytest.mark.parametrize('kind,username,cipher,decrypted', [
    ('oci_email_delivery', '', '', ''),
    ('oci_email_delivery', ' ', 'synthetic-cipher', 'pw'),
    ('oci_email_delivery', 'user', '', ''),
    ('oci_email_delivery', 'user', 'synthetic-cipher', ''),
    ('oci_email_delivery', 'user', 'synthetic-cipher', '   '),
    ('self_hosted', 'user', '', ''),
    ('self_hosted', '', 'synthetic-cipher', 'pw'),
    ('self_hosted', 'user', 'synthetic-cipher', ''),
])
def test_incomplete_auth_cannot_be_success_or_unlock(monkeypatch, kind, username, cipher, decrypted):
    row = record(); row.update(provider_type=kind, username=username, encrypted_password=cipher)
    service = MailAdminOperations(db=Db([row]))
    monkeypatch.setattr(service.security, 'decrypt_secret', lambda *_: decrypted)
    result = service.test_provider(actor(), 'provider-1', 'unused@example.invalid')
    assert result['lastTestStatus'] == 'failed'
    assert result['deliveryEnabled'] is False
    assert SMTP.calls == []


def test_self_hosted_plain_connection_does_not_claim_tls_or_auth():
    from app.services.mail_connection_probe import probe_smtp_connection
    row = record(); row.update(provider_type='self_hosted', tls_mode='none', username='', encrypted_password='')
    message = probe_smtp_connection(row, SimpleNamespace())
    assert 'TLS 미사용' in message and 'AUTH 미사용' in message
    assert [c[0] for c in SMTP.calls] == ['connect', 'ehlo']


def test_self_hosted_encrypted_empty_pair_matches_no_auth_transport():
    from app.services.mail_connection_probe import probe_smtp_connection
    row = record(); row.update(provider_type='self_hosted', tls_mode='none', username='', encrypted_password='synthetic-empty-cipher')
    message = probe_smtp_connection(row, SimpleNamespace(decrypt_secret=lambda *_: ''))
    assert 'AUTH 미사용' in message
    assert [c[0] for c in SMTP.calls] == ['connect', 'ehlo']


@pytest.mark.parametrize('port,mode', [(25, 'starttls'), (465, 'starttls'), (587, 'tls')])
def test_oci_probe_matches_transport_port_tls_contract(port, mode):
    from app.services.mail_connection_probe import probe_smtp_connection
    row = record(); row.update(relay_port=port, tls_mode=mode)
    with pytest.raises(ValueError):
        probe_smtp_connection(row, SimpleNamespace(decrypt_secret=lambda *_: 'synthetic-password'))
    assert SMTP.calls == []


@pytest.mark.parametrize('stage', ['starttls', 'login'])
def test_tls_and_auth_failure_are_not_success(monkeypatch, stage):
    row = record(); row.update(username='synthetic-user', encrypted_password='synthetic-cipher')
    def reject(*args, **kwargs): raise RuntimeError('synthetic-secret')
    monkeypatch.setattr(SMTP, stage, reject)
    service = MailAdminOperations(db=Db([row]))
    monkeypatch.setattr(service.security, 'decrypt_secret', lambda *_: 'synthetic-password')
    result = service.test_provider(actor(), 'provider-1', 'unused@example.invalid')
    assert result['lastTestStatus'] == 'failed' and result['deliveryEnabled'] is False
    assert 'synthetic-secret' not in str(result)


@pytest.mark.parametrize('legacy', [False, True])
@pytest.mark.parametrize('case', ['missing', 'valid', 'tls_failure', 'auth_failure', 'self_tls'])
@pytest.mark.parametrize('enabled', [False, True])
def test_both_mounted_provider_test_apis_validate_auth(monkeypatch, legacy, case, enabled):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes import admin, mail_operations_admin
    from app.services.mail_delivery_operations import MailDeliveryOperations
    row = record()
    row['delivery_enabled'] = enabled
    if case == 'self_tls': row.update(provider_type='self_hosted', tls_mode='tls', relay_port=465)
    if case == 'missing': row.update(username='', encrypted_password='')
    if case in {'tls_failure', 'auth_failure'}:
        def reject(*args, **kwargs): raise RuntimeError('synthetic-private')
        monkeypatch.setattr(SMTP, 'starttls' if case == 'tls_failure' else 'login', reject)
    class ApiDb(Db):
        def execute(self, sql, params=()):
            sql = ' '.join(sql.split())
            if sql.startswith('UPDATE mail_provider_configs') and 'company_id=%s' not in sql:
                params = (*params, 'company-1')
            super().execute(sql, params)
    db = ApiDb([row])
    app = FastAPI()
    if legacy:
        service = MailDeliveryOperations(db=db)
        monkeypatch.setattr(service, '_provider', lambda *_: row.copy())
        monkeypatch.setattr(service, 'get_status', lambda *_: {'provider': service._provider_view(row)})
        monkeypatch.setattr(admin, '_delivery_service', lambda: service)
        app.include_router(admin.router, prefix='/api/v1/admin')
        app.dependency_overrides[admin.require_admin] = actor
        url, body = '/api/v1/admin/mail-delivery/provider/test', {}
    else:
        monkeypatch.setattr(mail_operations_admin, '_service', lambda: MailAdminOperations(db=db))
        app.include_router(mail_operations_admin.router, prefix='/api/v1/admin/mail-operations')
        app.dependency_overrides[mail_operations_admin.require_admin] = actor
        url, body = '/api/v1/admin/mail-operations/providers/provider-1/test', {'recipient': 'unused@example.net'}
    with TestClient(app) as client:
        response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    assert response.json()['lastTestStatus'] == ('success' if case == 'valid' else 'failed')
    assert response.json()['deliveryEnabled'] is enabled
    assert row['delivery_enabled'] is enabled
    assert row['last_test_status'] == ('success' if case == 'valid' else 'failed')
    if case in {'missing', 'self_tls'}: assert SMTP.calls == []
    if case == 'valid': assert [c[0] for c in SMTP.calls] == ['connect', 'ehlo', 'tls', 'ehlo', 'auth']
    assert 'synthetic-private' not in response.text
    assert any('FOR UPDATE' in sql for sql, _ in db.statements)


@pytest.mark.parametrize('kind', ['self_hosted', 'self_hosted_smtp', 'smtp'])
def test_self_implicit_tls_rejected_before_connection(kind):
    from app.services.mail_connection_probe import probe_smtp_connection
    row = record(); row.update(provider_type=kind, tls_mode='tls', relay_port=465)
    with pytest.raises(ValueError, match='지원하지'):
        probe_smtp_connection(row, SimpleNamespace(decrypt_secret=lambda *_: 'synthetic-password'))
    assert SMTP.calls == []


@pytest.mark.parametrize('kind,mode,port,factory,stages', [
    ('self_hosted', 'none', 25, 'plain', ['connect', 'ehlo', 'auth']),
    ('self_hosted', 'starttls', 587, 'plain', ['connect', 'ehlo', 'tls', 'ehlo', 'auth']),
    ('oci_email_delivery', 'tls', 465, 'implicit', ['connect', 'ehlo', 'auth']),
    ('oci_email_delivery', 'starttls', 587, 'plain', ['connect', 'ehlo', 'tls', 'ehlo', 'auth']),
])
def test_supported_probe_uses_transport_compatible_factory(monkeypatch, kind, mode, port, factory, stages):
    from app.services.mail_connection_probe import probe_smtp_connection
    selected = []
    def plain(*args, **kwargs):
        selected.append('plain'); assert 'context' not in kwargs
        return SMTP(*args, **kwargs)
    def implicit(*args, **kwargs):
        selected.append('implicit'); assert kwargs['context'].check_hostname
        return SMTP(*args, **kwargs)
    monkeypatch.setattr('smtplib.SMTP', plain)
    monkeypatch.setattr('smtplib.SMTP_SSL', implicit)
    row = record(); row.update(provider_type=kind, tls_mode=mode, relay_port=port)
    message = probe_smtp_connection(row, SimpleNamespace(decrypt_secret=lambda *_: 'synthetic-password'))
    assert selected == [factory]
    assert [c[0] for c in SMTP.calls] == stages
    assert 'AUTH 검증 완료' in message
    assert ('TLS 미사용' if mode == 'none' else 'TLS 검증 완료') in message
@pytest.mark.parametrize('raw', [False, True])
@pytest.mark.parametrize('relay', ['', 'relay.invalid'])
def test_self_transport_implicit_tls_rejected_before_all_side_effects(raw, relay):
    from email.message import EmailMessage
    from app.services.mail_transports import SelfHostedSmtpTransport, MailTransportFailure
    from test_outbound_stage3a_smtp import PhaseSmtp
    events = []
    def factory(**kwargs):
        events.append('network')
        return PhaseSmtp('ok')
    def mx(domain):
        events.append('mx')
        return ['mx.invalid']
    payload = b'From: sender@example.test\r\n\r\nhello\r\n' if raw else EmailMessage()
    if not raw: payload.set_content('hello')
    with pytest.raises(MailTransportFailure) as failure:
        SelfHostedSmtpTransport(mx_resolver=mx, smtp_factory=factory).send_prepared(
            payload, envelope_from='sender@example.test', recipient_email='recipient@example.test',
            helo_name='sender.invalid', timeout_sec=3, relay_host=relay, relay_port=587,
            tls_mode='tls', username='synthetic-user', password='synthetic-password',
            before_network_attempt=lambda: events.append('quota'),
            before_data=lambda: events.append('data'))
    assert failure.value.transient is False
    assert failure.value.result_unknown is False
    assert events == []
