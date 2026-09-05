"""SMTP submission 계약. 네트워크/DB는 fixture, 원문과 transport는 실제 구현."""
from email.message import EmailMessage
from email.policy import SMTP
from hashlib import sha256
import importlib
import io
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.services.mail_delivery_service import MailDeliveryWorker
from app.services.mail_transports import MailProviderRoutingAdapter, OciEmailDeliveryTransport, SelfHostedSmtpTransport


def raw_mail():
    msg = EmailMessage(policy=SMTP)
    msg['From'] = '작성자 <writer@example.test>'
    msg['To'] = 'visible@example.net'
    msg['Cc'] = 'copy@example.net'
    msg['Bcc'] = 'hidden@example.net'
    msg['Message-ID'] = '<submission-stable@example.test>'
    msg['Subject'] = '첨부 원문'
    msg.set_content('본문')
    msg.add_alternative('<img src="cid:logo">', subtype='html')
    msg.get_payload()[1].add_related(b'inline-bytes', maintype='image', subtype='png', cid='<logo>')
    msg.add_attachment(b'attachment-bytes\x00\xff', maintype='application', subtype='octet-stream', filename='자료.bin')
    return msg.as_bytes()


def submission_module():
    spec = importlib.util.find_spec('app.services.mail_submission_operations')
    assert spec is not None, 'SMTP submission 검증/접수 구현 필요'
    return importlib.import_module('app.services.mail_submission_operations')


def test_raw_preserves_every_byte_except_bcc_header():
    module = submission_module()
    raw = raw_mail()
    clean = module.validate_submission(raw, 'writer@example.test', 'hidden@example.net', 'LongQueue123')
    assert clean == raw.replace(b'Bcc: hidden@example.net\r\n', b'')


@pytest.mark.parametrize('mutation', [
    lambda raw: raw.replace(b'writer@example.test', b'forged@example.test'),
    lambda raw: b'From: writer@example.test\r\n' + raw,
    lambda raw: b'Sender: forged@example.test\r\n' + raw,
    lambda raw: b'Resent-From: forged@example.test\r\n' + raw,
    lambda raw: raw.replace(b'writer@example.test', b'writer@example.test, forged@example.test'),
])
def test_rejects_spoofed_identity(mutation):
    with pytest.raises(ValueError):
        submission_module().validate_submission(mutation(raw_mail()), 'writer@example.test', 'hidden@example.net', 'LongQueue123')


@pytest.mark.parametrize('sender,recipient,queue', [('', 'a@example.net', 'Long123'), ('writer@example.test', 'a@example.net\r\nX: yes', 'Long123'), ('writer@example.test', 'a@example.net,b@example.net', 'Long123'), ('writer@example.test', 'a@example.net', '../queue')])
def test_rejects_bad_envelope(sender, recipient, queue):
    with pytest.raises(ValueError):
        submission_module().validate_submission(raw_mail(), sender, recipient, queue)


class Smtp:
    def __init__(self): self.deliveries = []
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def ehlo(self, *args): pass
    def has_extn(self, name): return True
    def starttls(self, **kwargs): pass
    def login(self, *args): pass
    def sendmail(self, sender, recipients, raw):
        self.deliveries.append((sender, recipients, raw))
        return {}
    def send_message(self, message, *, from_addr, to_addrs):
        self.deliveries.append((from_addr, to_addrs, message.as_bytes(policy=SMTP)))
        return {}


@pytest.mark.parametrize('kind', ['oci_email_delivery', 'self_hosted'])
def test_worker_preserves_raw_mime_and_uses_single_envelope_and_quota(tmp_path, monkeypatch, kind):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'storage_local_path', str(tmp_path))
    raw = raw_mail().replace(b'Bcc: hidden@example.net\r\n', b'')
    digest = sha256(raw).hexdigest()
    key = f'mail/submission/{digest[:2]}/{digest}/raw.eml'
    path = tmp_path / key
    path.parent.mkdir(parents=True)
    path.write_bytes(raw)
    smtp = Smtp()
    adapter = MailProviderRoutingAdapter(self_hosted_transport=SelfHostedSmtpTransport(mx_resolver=lambda _: ['mx.example.net'], smtp_factory=lambda **_: smtp), oci_transport=OciEmailDeliveryTransport(smtp_factory=lambda **_: smtp))
    class Quota:
        calls = 0
        def reserve_attempt(self): self.calls += 1
    quota = Quota()
    job = dict(queue_id='delivery_1', delivery_kind='submission', sender_email='writer@example.test', recipient_email='hidden@example.net', raw_storage_key=key, raw_sha256=digest, raw_size=len(raw))
    provider = dict(provider_type=kind, from_address='system@example.test', password='fixture', username='fixture', delivery_enabled=True, last_test_status='success')
    result = MailDeliveryWorker('fixture', adapter, quota=quota).deliver_claimed(job, provider)
    assert result.status == 'sent'
    assert quota.calls == 1
    assert smtp.deliveries[0][1:] == (['hidden@example.net'], raw)
    assert smtp.deliveries[0][0] == ('writer@example.test' if kind == 'oci_email_delivery' else 'bounce+delivery_1@example.test')


def test_submission_route_exists_and_rejects_unauthenticated():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes.mail_internal import router
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post('/submission', content=raw_mail())
    assert response.status_code == 401


def pipe_module():
    path = Path(__file__).resolve().parents[1] / 'deploy/mail-gateway/moaworks-submission.py'
    assert path.exists(), 'submission pipe 필요'
    spec = importlib.util.spec_from_file_location('submission_pipe', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('http_status,expected', [(202,0),(401,75),(403,75),(404,75),(429,75),(503,75),(422,65),(413,65)])
def test_pipe_http_result_preserves_queue_or_returns_explicit_dsn(http_status, expected, capsys):
    from urllib.error import HTTPError
    requests = []
    def open_request(request, **kwargs):
        requests.append(request)
        if http_status != 202:
            raise HTTPError(request.full_url, http_status, 'fixture', {}, None)
        class Response:
            status = 202
            def __enter__(self): return self
            def __exit__(self, *args): pass
        return Response()
    code = pipe_module().run(['LongQueue123','writer@example.test','hidden@example.net'],
        environ={'MAIL_INGEST_URL':'http://server:8000/api/v1/internal/mail/ingest','MAIL_INGEST_TOKEN':'synthetic-token'},
        stream=io.BytesIO(raw_mail()), opener=open_request)
    assert code == expected
    assert requests[0].full_url.endswith('/submission')
    assert requests[0].get_header('X-moaworks-envelope-to') == 'hidden@example.net'
    output = capsys.readouterr()
    assert 'synthetic-token' not in output.out + output.err
    assert 'example.' not in output.out + output.err
    if expected == 65: assert '5.7.1' in output.out


def test_pipe_network_failure_is_tempfail(capsys):
    def fail(*args, **kwargs): raise OSError('synthetic-token hidden@example.net')
    assert pipe_module().run(['LongQueue123','writer@example.test','hidden@example.net'],
        environ={'MAIL_INGEST_URL':'http://server/ingest','MAIL_INGEST_TOKEN':'synthetic-token'},
        stream=io.BytesIO(raw_mail()), opener=fail) == 75
    assert 'synthetic-token' not in capsys.readouterr().out


def test_gateway_submission_auth_and_filter_config_contract():
    root = Path(__file__).resolve().parents[1] / 'deploy/mail-gateway'
    master = (root / 'master.cf').read_text()
    submission = master.split('submission inet', 1)[1].split('pickup', 1)[0]
    assert '-o content_filter=moaworks-submission:' in submission
    assert 'reject_authenticated_sender_login_mismatch' in submission
    main = (root / 'main.cf').read_text()
    assert 'enable_long_queue_ids = yes' in main
    assert 'moaworks-submission_destination_recipient_limit = 1' in main
    assert 'smtpd_relay_restrictions = reject_unauth_destination' in main
    assert 'smtpd_sasl_auth_enable = no' in main
    sql = (root / 'dovecot-sql.conf.ext').read_text()
    assert "u.status='active'" in sql and "a.status='active'" in sql
    assert 'u.company_id=c.company_id' in sql
    pipe = master.split('moaworks-submission unix', 1)[1]
    assert r'eol=\r\n' in pipe


def test_bare_lf_is_rejected_instead_of_silently_reserializing_mime():
    with pytest.raises(ValueError, match='CRLF'):
        submission_module().validate_submission(raw_mail().replace(b'\r\n', b'\n'), 'writer@example.test', 'hidden@example.net', 'LongQueue123')


class FixtureDatabase:
    """SQLite transaction fixture. PostgreSQL migration/locking 실제 증거는 아니다."""
    def __init__(self):
        self.sql = sqlite3.connect(':memory:')
        self.sql.row_factory = lambda cursor, row: dict(zip([d[0] for d in cursor.description], row))
        self.statements = []
        self.fail_queue = False
        self.fail_receipt = False
        self.sql.executescript('''
            CREATE TABLE users(id TEXT PRIMARY KEY,company_id TEXT,email TEXT,status TEXT);
            CREATE TABLE mail_accounts(id TEXT,user_id TEXT,email TEXT,status TEXT);
            CREATE TABLE mail_domain_settings(company_id TEXT,mail_domain TEXT);
            CREATE TABLE mail_submission_credentials(user_id TEXT,company_id TEXT,username TEXT,active BOOLEAN,revoked_at TEXT);
            CREATE TABLE mail_provider_configs(id TEXT,company_id TEXT,active BOOLEAN,provider_type TEXT,delivery_enabled BOOLEAN,last_test_status TEXT);
            CREATE TABLE mail_submission_messages(company_id TEXT,gateway_queue_id TEXT,original_sha256 TEXT,raw_sha256 TEXT,mail_message_id TEXT,stored_at TEXT,created_at TEXT,PRIMARY KEY(company_id,gateway_queue_id));
            CREATE TABLE mail_submission_recipients(company_id TEXT,gateway_queue_id TEXT,recipient_email TEXT,disposition TEXT,created_at TEXT,PRIMARY KEY(company_id,gateway_queue_id,recipient_email));
            CREATE TABLE mail_messages(id TEXT PRIMARY KEY,company_id TEXT,sender_user_id TEXT,sender_account_id TEXT,sender_email TEXT,subject TEXT,body_text TEXT,body_html TEXT,status TEXT,sent_at TEXT,created_at TEXT,updated_at TEXT,retention_expires_at TEXT,attachment_count INTEGER,sender_display_name TEXT,raw_storage_key TEXT,raw_sha256 TEXT,raw_size INTEGER);
            CREATE TABLE mail_attachments(id TEXT,message_id TEXT,file_name TEXT,content_type TEXT,size_bytes INTEGER,storage_key TEXT,created_at TEXT,content_disposition TEXT DEFAULT 'attachment',content_id TEXT);
            CREATE TABLE mail_recipients(id TEXT,message_id TEXT,recipient_user_id TEXT,recipient_email TEXT,recipient_kind TEXT,is_read BOOLEAN,is_starred BOOLEAN,received_at TEXT,delivery_source TEXT,is_spam BOOLEAN DEFAULT FALSE,spam_marked_at TEXT);
            CREATE TABLE mail_delivery_queue(id TEXT,company_id TEXT,provider_config_id TEXT,mail_id TEXT,recipient_id TEXT,status TEXT,delivery_kind TEXT,created_at TEXT,updated_at TEXT);
            CREATE TABLE mail_inbound_messages(id TEXT PRIMARY KEY,company_id TEXT,internet_message_id TEXT,content_sha256 TEXT,raw_storage_key TEXT,envelope_from TEXT,header_from TEXT,authentication_results TEXT,spam_result TEXT,virus_status TEXT,security_disposition TEXT,processing_status TEXT,received_at TEXT,created_at TEXT,updated_at TEXT,mail_message_id TEXT,processed_at TEXT,last_error TEXT,submission_queue_id TEXT,FOREIGN KEY(company_id,submission_queue_id) REFERENCES mail_submission_messages(company_id,gateway_queue_id));
            CREATE UNIQUE INDEX mail_inbound_25_content_unique ON mail_inbound_messages(company_id,content_sha256) WHERE submission_queue_id IS NULL;
            CREATE UNIQUE INDEX mail_inbound_submission_queue_unique ON mail_inbound_messages(company_id,submission_queue_id) WHERE submission_queue_id IS NOT NULL;
            CREATE TABLE mail_inbound_recipients(id TEXT,inbound_message_id TEXT,recipient_user_id TEXT,recipient_email TEXT,disposition TEXT,mail_recipient_id TEXT,created_at TEXT);
            CREATE TABLE audit_logs(id TEXT,company_id TEXT,actor_user_id TEXT,actor_user_name TEXT,target_type TEXT,target_id TEXT,event TEXT,status_before TEXT,status_after TEXT,reason TEXT,created_at TEXT);
            INSERT INTO users VALUES ('writer','company-a','writer@example.test','active'),('local','company-a','local@example.test','active'),('other','company-b','other@other.test','active');
            INSERT INTO mail_accounts VALUES ('account','writer','writer@example.test','active'),('local-account','local','local@example.test','active'),('other-account','other','other@other.test','active');
            INSERT INTO mail_domain_settings VALUES ('company-a','example.test'),('company-b','other.test');
            INSERT INTO mail_submission_credentials VALUES ('writer','company-a','writer@example.test',TRUE,NULL);
            INSERT INTO mail_provider_configs VALUES ('oci-a','company-a',TRUE,'oci_email_delivery',TRUE,'success');
        ''')
        self.sql.create_function('split_part', 3, lambda s, sep, n: s.split(sep)[n-1])

    @contextmanager
    def connect(self):
        try:
            yield self
        except Exception:
            self.sql.rollback()
            raise
        finally:
            self.sql.rollback()

    @contextmanager
    def cursor(self):
        database = self
        class Cursor:
            def execute(self, query, params=()):
                database.statements.append((' '.join(query.split()), params))
                if database.fail_queue and 'INSERT INTO mail_delivery_queue' in query:
                    raise RuntimeError('synthetic queue failure')
                if database.fail_receipt and 'INSERT INTO mail_submission_recipients' in query:
                    raise RuntimeError('synthetic receipt failure')
                query = query.replace(' FOR UPDATE', '').replace(' FOR SHARE OF c,u,a,d', '').replace('%s', '?').replace('::jsonb','')
                self.value = database.sql.execute(query, tuple(str(v) if hasattr(v, 'isoformat') else v for v in params))
            def fetchone(self): return self.value.fetchone()
            def fetchall(self): return self.value.fetchall()
        yield Cursor()

    def commit(self): self.sql.commit()
    def ensure_migrations_applied(self): self.migrations_ready = True


@pytest.fixture
def submission_db(tmp_path):
    module = submission_module()
    db = FixtureDatabase()
    try:
        yield db, module.MailSubmissionOperations(db=db, storage=module.MailSubmissionStorage(tmp_path))
    finally:
        db.sql.close()


def submit(service, raw, recipient='hidden@example.net', queue='LongQueue123'):
    return service.submit(envelope_from='writer@example.test', recipient_email=recipient, queue_id=queue, raw_message=raw)


def test_crosscompany_recipient_uses_external_queue_without_reading_other_tenant(submission_db):
    db, service = submission_db
    assert submit(service, raw_mail(), 'other@other.test')['disposition'] == 'queued'
    assert db.sql.execute('SELECT company_id,provider_config_id FROM mail_delivery_queue').fetchone() == {'company_id':'company-a','provider_config_id':'oci-a'}
    assert db.sql.execute('SELECT recipient_user_id FROM mail_recipients').fetchone()['recipient_user_id'] is None
    lookups = [(query, params) for query, params in db.statements if query.startswith('SELECT') and 'FROM users u' in query and 'other@other.test' in params]
    assert lookups and all('u.company_id=' in query and 'company-a' in params for query, params in lookups)


def test_inline_metadata_and_attachment_api_records_are_preserved(submission_db):
    db, service = submission_db
    submit(service, raw_mail())
    rows = db.sql.execute('SELECT content_type,content_disposition,content_id,size_bytes FROM mail_attachments ORDER BY content_type').fetchall()
    assert rows == [dict(content_type='application/octet-stream',content_disposition='attachment',content_id=None,size_bytes=18),dict(content_type='image/png',content_disposition='inline',content_id='logo',size_bytes=12)]
    assert db.sql.execute('SELECT attachment_count FROM mail_messages').fetchone()['attachment_count'] == 2


def test_duplicate_after_policy_change_never_creates_second_queue(submission_db):
    db, service = submission_db
    raw = raw_mail()
    assert submit(service, raw)['duplicate'] is False
    db.sql.execute("UPDATE mail_provider_configs SET active=FALSE")
    db.commit()
    assert submit(service, raw)['duplicate'] is True
    assert db.sql.execute('SELECT count(*) AS n FROM mail_delivery_queue').fetchone()['n'] == 1


def test_conflicting_raw_same_queue_different_recipient_is_rejected(submission_db):
    db, service = submission_db
    raw = raw_mail()
    submit(service, raw)
    with pytest.raises(ValueError, match='충돌'):
        submit(service, raw.replace(b'<submission-stable@example.test>', b'<different-message@example.test>'), 'second@example.net')
    assert db.sql.execute('SELECT count(*) AS n FROM mail_delivery_queue').fetchone()['n'] == 1


def test_queue_failure_rolls_back_message_recipient_and_idempotency(submission_db):
    db, service = submission_db
    db.fail_queue = True
    raw = raw_mail()
    with pytest.raises(RuntimeError): submit(service, raw)
    for table in ('mail_messages','mail_recipients','mail_attachments','mail_submission_messages','mail_submission_recipients','mail_delivery_queue'):
        assert db.sql.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'] == 0
    db.fail_queue = False
    assert submit(service, raw)['duplicate'] is False


@pytest.mark.parametrize('mutation', [
    "UPDATE users SET status='inactive' WHERE id='writer'",
    "DELETE FROM users WHERE id='writer'",
    "UPDATE mail_accounts SET status='inactive' WHERE user_id='writer'",
    "UPDATE mail_submission_credentials SET active=FALSE",
    "UPDATE mail_submission_credentials SET company_id='company-b'",
    "UPDATE mail_accounts SET email='other@other.test' WHERE user_id='writer'",
])
def test_sender_auth_inactive_deleted_or_crosscompany_forgery_rejected(submission_db, mutation):
    db, service = submission_db
    db.sql.execute(mutation)
    db.commit()
    with pytest.raises(ValueError, match='발신'): submit(service, raw_mail())
    assert db.sql.execute('SELECT count(*) AS n FROM mail_messages').fetchone()['n'] == 0


def test_same_company_internal_delivery_needs_no_provider_and_never_queues(submission_db):
    db, service = submission_db
    db.sql.execute('UPDATE mail_provider_configs SET active=FALSE')
    db.commit()
    assert submit(service, raw_mail(), 'local@example.test')['disposition'] == 'internal'
    assert db.sql.execute('SELECT recipient_user_id,received_at FROM mail_recipients').fetchone()['recipient_user_id'] == 'local'
    assert db.sql.execute('SELECT count(*) AS n FROM mail_delivery_queue').fetchone()['n'] == 0


def test_disabled_policy_is_temporary_and_rolls_back(submission_db):
    db, service = submission_db
    db.sql.execute('UPDATE mail_provider_configs SET delivery_enabled=FALSE')
    db.commit()
    with pytest.raises(submission_module().SubmissionUnavailable): submit(service, raw_mail())
    assert db.sql.execute('SELECT count(*) AS n FROM mail_submission_messages').fetchone()['n'] == 0


@pytest.mark.parametrize('recipient,kind', [('hidden@example.net','bcc'),('copy@example.net','cc'),('visible@example.net','to')])
def test_recipient_kind_preserves_bcc_privacy(submission_db, recipient, kind):
    db, service = submission_db
    submit(service, raw_mail(), recipient)
    assert db.sql.execute('SELECT recipient_kind FROM mail_recipients').fetchone()['recipient_kind'] == kind


def test_submission_attachment_storage_does_not_collide_with_inbound_indexes(submission_db):
    db, service = submission_db
    submit(service, raw_mail())
    keys = db.sql.execute('SELECT storage_key FROM mail_attachments').fetchall()
    assert keys and all(row['storage_key'].startswith('mail/submission/') for row in keys)


@pytest.mark.parametrize('change', ['digest','path','size','missing','bcc'])
def test_corrupt_or_untrusted_raw_is_rejected_before_smtp_or_quota(tmp_path, monkeypatch, change):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'storage_local_path', str(tmp_path))
    raw = raw_mail()
    if change != 'bcc': raw = raw.replace(b'Bcc: hidden@example.net\r\n', b'')
    digest = sha256(raw).hexdigest()
    key = submission_module().MailSubmissionStorage(tmp_path).store_raw(digest, raw)
    job = dict(queue_id='delivery_1',delivery_kind='submission',sender_email='writer@example.test',recipient_email='hidden@example.net',raw_storage_key=key,raw_sha256=digest,raw_size=len(raw))
    if change == 'digest': job['raw_sha256'] = '0'*64
    if change == 'path': job['raw_storage_key'] = '../outside.eml'
    if change == 'size': job['raw_size'] += 1
    if change == 'missing': (tmp_path / key).unlink()
    def forbidden(*args, **kwargs): pytest.fail('손상 원문이 네트워크/quota까지 도달')
    class Quota:
        reserve_attempt = forbidden
    adapter = MailProviderRoutingAdapter(self_hosted_transport=SelfHostedSmtpTransport(mx_resolver=forbidden),oci_transport=OciEmailDeliveryTransport(smtp_factory=forbidden))
    result = MailDeliveryWorker('fixture',adapter,quota=Quota()).deliver_claimed(job,dict(provider_type='oci_email_delivery',password='fixture',delivery_enabled=True,last_test_status='success'))
    assert result.status == 'failed'


@pytest.mark.parametrize('case,want', [('token',401),('duplicate',422),('length',413),('badlength',422),('type',415),('validation',422),('temporary',503),('db',503),('success',202)])
def test_submission_http_contract_with_fixture_backend(monkeypatch, case, want):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes.mail_internal import router
    from app.core.config import settings
    module = submission_module()
    monkeypatch.setattr(settings,'mail_ingest_token','synthetic-token')
    headers = [('X-MoaWorks-Ingest-Token','synthetic-token'),('X-MoaWorks-Envelope-From','writer@example.test'),('X-MoaWorks-Envelope-To','hidden@example.net'),('X-MoaWorks-Queue-Id','LongQueue123'),('content-type','message/rfc822')]
    if case == 'token': headers[0] = (headers[0][0],'wrong')
    if case == 'duplicate': headers.append(headers[1])
    if case == 'length': headers.append(('content-length','99999999'))
    if case == 'badlength': headers.append(('content-length','invalid'))
    if case == 'type': headers[-1] = ('content-type','text/plain')
    def service(self, **kwargs):
        if case == 'validation': raise ValueError('private@example.test')
        if case == 'temporary': raise module.SubmissionUnavailable('private@example.test')
        if case == 'db': raise RuntimeError('private@example.test')
        assert kwargs['queue_id'] == 'LongQueue123'
        return {'status':'accepted','disposition':'queued','duplicate':False}
    monkeypatch.setattr(module.MailSubmissionOperations,'submit',service)
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post('/submission',headers=headers,content=raw_mail())
    assert response.status_code == want
    assert 'private@example.test' not in response.text


def test_persisted_attachment_download_preview_and_metadata_use_existing_api(submission_db):
    from app.services.mail_attachment_storage import MailAttachmentStorage
    from app.services.mail_messenger_service import MailMessengerService
    from types import SimpleNamespace
    db, service = submission_db
    submit(service, raw_mail())
    db.sql.execute('ALTER TABLE mail_messages ADD sender_purged_at TEXT')
    db.sql.execute('ALTER TABLE mail_recipients ADD purged_at TEXT')
    db.commit()
    store = MailAttachmentStorage(service.storage.root)
    rows = db.sql.execute('SELECT * FROM mail_attachments').fetchall()
    for row in rows:
        assert store.stored_path(row['storage_key']).stat().st_size == row['size_bytes']
    inline = next(row for row in rows if row['content_disposition'] == 'inline')
    actor = SimpleNamespace(companyId='company-a',userId='writer',userEmail='writer@example.test')
    preview = store.open_persisted_preview(actor, inline['message_id'], inline['id'], db)
    assert preview['content'] == b'inline-bytes'
    with db.cursor() as cursor:
        views = MailMessengerService._fetch_mail_attachments(None, cursor, inline['message_id'])
    assert any(view.contentId == 'logo' and view.disposition == 'inline' and view.previewPath for view in views)
    actor.companyId = 'company-b'
    with pytest.raises(PermissionError): store.open_persisted_preview(actor, inline['message_id'], inline['id'], db)


def test_attached_message_is_preserved_in_attachment_api(submission_db):
    from email.parser import BytesParser
    db, service = submission_db
    outer = BytesParser(policy=SMTP).parsebytes(raw_mail())
    inner = EmailMessage(policy=SMTP)
    inner['From'] = 'original@example.net'
    inner['Subject'] = 'original message'
    inner.set_content('original body')
    outer.add_attachment(inner, filename='original.eml')
    submit(service, outer.as_bytes())
    row = db.sql.execute("SELECT * FROM mail_attachments WHERE file_name='original.eml'").fetchone()
    assert row is not None and row['content_type'] == 'message/rfc822' and row['size_bytes'] > 0


@pytest.mark.parametrize('provider_type', ['self_hosted','oci_email_delivery'])
def test_current_company_resolver_pins_provider_for_submission(submission_db, provider_type):
    db, service = submission_db
    db.sql.execute('UPDATE mail_provider_configs SET provider_type=?', (provider_type,))
    db.sql.execute("INSERT INTO mail_provider_configs VALUES ('other-provider','company-b',TRUE,'oci_email_delivery',TRUE,'success')")
    db.commit()
    submit(service, raw_mail())
    assert db.sql.execute('SELECT provider_config_id FROM mail_delivery_queue').fetchone()['provider_config_id'] == 'oci-a'


@pytest.mark.parametrize('change', ['none','multiple'])
def test_resolver_never_falls_back_when_policy_ambiguous(submission_db, change):
    db, service = submission_db
    if change == 'none': db.sql.execute('UPDATE mail_provider_configs SET active=FALSE')
    else: db.sql.execute("INSERT INTO mail_provider_configs VALUES ('second','company-a',TRUE,'self_hosted',TRUE,'success')")
    db.commit()
    with pytest.raises(submission_module().SubmissionUnavailable): submit(service, raw_mail())
    assert db.sql.execute('SELECT count(*) AS n FROM mail_delivery_queue').fetchone()['n'] == 0


def test_submission_attachment_tampering_is_rejected_by_api_storage(submission_db):
    from app.services.mail_attachment_storage import MailAttachmentStorage
    db, service = submission_db
    submit(service, raw_mail())
    row = db.sql.execute("SELECT * FROM mail_attachments WHERE content_disposition='inline'").fetchone()
    store = MailAttachmentStorage(service.storage.root)
    forged = dict(row, content_id='forged')
    with pytest.raises(ValueError): store.verify_submission_attachment(forged)
    path = service.storage.root / row['storage_key']
    path.write_bytes(b'altered-data')
    with pytest.raises(ValueError): store.stored_path(row['storage_key'])


@pytest.mark.parametrize('gate', ['quota','suppression'])
def test_raw_submission_respects_common_quota_and_suppression(tmp_path, monkeypatch, gate):
    from app.core.config import settings
    from app.services.mail_daily_send_quota import MailDailyQuotaUnavailable
    monkeypatch.setattr(settings,'storage_local_path',str(tmp_path))
    raw = raw_mail().replace(b'Bcc: hidden@example.net\r\n',b'')
    digest = sha256(raw).hexdigest()
    key = submission_module().MailSubmissionStorage(tmp_path).store_raw(digest,raw)
    job = dict(queue_id='delivery_1',delivery_kind='submission',sender_email='writer@example.test',recipient_email='hidden@example.net',raw_storage_key=key,raw_sha256=digest,raw_size=len(raw),recipient_suppressed=gate=='suppression')
    def forbidden(*args, **kwargs): pytest.fail('차단된 submission이 SMTP 연결 시도')
    class Quota:
        def reserve_attempt(self): raise MailDailyQuotaUnavailable('synthetic')
    adapter = MailProviderRoutingAdapter(self_hosted_transport=SelfHostedSmtpTransport(mx_resolver=forbidden),oci_transport=OciEmailDeliveryTransport(smtp_factory=forbidden))
    result = MailDeliveryWorker('fixture',adapter,quota=Quota()).deliver_claimed(job,dict(provider_type='oci_email_delivery',password='fixture',delivery_enabled=True,last_test_status='success'))
    assert result.status == ('quota_deferred' if gate == 'quota' else 'blocked')


@pytest.mark.parametrize('header,disposition', [(b'X-Spam: Yes\r\n','spam'),(b'X-Virus-Status: Infected\r\n','quarantine')])
def test_internal_submission_preserves_inbound_security_classification(submission_db, header, disposition):
    db, service = submission_db
    result = submit(service, header + raw_mail(), 'local@example.test')
    assert result['disposition'] == disposition
    row = db.sql.execute('SELECT security_disposition FROM mail_inbound_messages').fetchone()
    assert row['security_disposition'] == disposition
    recipients = db.sql.execute('SELECT is_spam FROM mail_recipients').fetchall()
    assert recipients == ([{'is_spam':1}] if disposition == 'spam' else [])
    assert db.sql.execute('SELECT count(*) AS n FROM mail_delivery_queue').fetchone()['n'] == 0


def test_submission_checks_migrations_before_new_table_access(submission_db):
    db, service = submission_db
    submit(service,raw_mail())
    assert getattr(db,'migrations_ready',False)


@pytest.mark.parametrize('header', [b'',b'X-Spam: Yes\r\n',b'X-Virus-Status: Infected\r\n'])
def test_internal_ingest_does_not_commit_before_submission_receipt(submission_db, header):
    db, service = submission_db
    db.fail_receipt = True
    raw = header + raw_mail()
    with pytest.raises(RuntimeError): submit(service,raw,'local@example.test')
    for table in ('mail_messages','mail_recipients','mail_inbound_messages','mail_inbound_recipients','audit_logs','mail_submission_messages','mail_submission_recipients'):
        assert db.sql.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'] == 0
    db.fail_receipt = False
    assert submit(service,raw,'local@example.test')['duplicate'] is False


def test_gateway_submission_keeps_rspamd_milter_contract():
    root = Path(__file__).resolve().parents[1] / 'deploy/mail-gateway'
    assert 'smtpd_milters = inet:rspamd:11332' in (root/'main.cf').read_text()
    assert 'milter_default_action = tempfail' in (root/'main.cf').read_text()
    assert '-o smtpd_milters=' not in (root/'master.cf').read_text()


def test_internal_reused_ingest_never_looks_up_other_company_users(submission_db):
    db, service = submission_db
    submit(service,raw_mail(),'local@example.test')
    lookups = [(query, params) for query, params in db.statements if query.startswith('SELECT') and 'FROM users u' in query and 'local@example.test' in params]
    assert len(lookups) == 2
    assert all('u.company_id=' in query and 'company-a' in params for query,params in lookups)
