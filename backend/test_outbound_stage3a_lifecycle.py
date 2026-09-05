"""로컬 SQLite SQL 동작 회귀. PostgreSQL row lock/실제 migration은 Main 검증."""
import sqlite3
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.mail_delivery_service import DeliveryResult


class Db:
    def __init__(self):
        self.sql = sqlite3.connect(':memory:', check_same_thread=False)
        self.sql.row_factory = sqlite3.Row
        self.sql.create_function('clock_timestamp', 0, lambda: datetime.now(UTC).isoformat())
        self.commits = 0
        self.statements = []
        self.sql.executescript('''
        CREATE TABLE mail_delivery_queue(id PRIMARY KEY,company_id,provider_config_id,mail_id,recipient_id,
          status,attempt_count,next_attempt_at,lease_expires_at,worker_id,last_error,accepted_at,sent_at,created_at,updated_at,
          delivery_kind,sender_email_override,sender_display_name_override,reply_to_email_override,claim_token,claimed_at,send_started_at);
        CREATE TABLE mail_messages(id PRIMARY KEY,raw_storage_key,raw_sha256,raw_size,sender_user_id,sender_email,
          sender_display_name,reply_to_email,message_encoding,subject,body_text,body_html);
        CREATE TABLE mail_recipients(id PRIMARY KEY,recipient_email);
        CREATE TABLE mail_oci_suppressions(company_id,recipient_email,active);
        CREATE TABLE mail_attachments(message_id,file_name,content_type,size_bytes,storage_key,content_disposition,content_id,created_at);
        CREATE TABLE mail_provider_configs(id,company_id,username,encrypted_password,encrypted_dkim_private_key,
          delivery_enabled,last_test_status,provider_type);
        CREATE TABLE mail_delivery_attempts(id,queue_id,attempt_number,result,error_message,relay_response,started_at NOT NULL,finished_at NOT NULL);
        CREATE TABLE mail_auto_forward_deliveries(delivery_queue_id,status,reason_code,updated_at,completed_at,origin_recipient_id);
        CREATE TABLE mail_out_of_office_deliveries(delivery_queue_id,status,reason_code,updated_at,completed_at);
        CREATE TABLE audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at);
        CREATE TABLE mail_delivery_worker_heartbeats(worker_id PRIMARY KEY,status,last_heartbeat_at,last_success_at,last_error,updated_at);
        ''')
        self.sql.execute("INSERT INTO mail_provider_configs VALUES ('pin','a','','','',1,'success','smtp')")

    def add(self, identifier, status='queued', token=None, expired=False):
        now = datetime.now(UTC)
        self.sql.execute('INSERT INTO mail_messages VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (identifier,None,None,None,'user','sender@example.test','','','utf-8','original','body',None))
        self.sql.execute('INSERT INTO mail_recipients VALUES (?,?)', (identifier,'recipient@example.test'))
        self.sql.execute('INSERT INTO mail_delivery_queue VALUES ('+','.join('?' for _ in range(22))+')',
            (identifier,'a','pin',identifier,identifier,status,0,None,
             (now+timedelta(minutes=-1 if expired else 2)).isoformat(),'worker',None,None,None,
             now.isoformat(),now.isoformat(),'direct',None,None,None,token,now.isoformat(),None))
        self.sql.commit()
    def row(self, identifier): return dict(self.sql.execute('SELECT * FROM mail_delivery_queue WHERE id=?',(identifier,)).fetchone())
    def ensure_migrations_applied(self): pass
    def connect(self): return self
    def __enter__(self): return self
    def __exit__(self, kind, *args):
        if kind: self.sql.rollback()
    def cursor(self): return Cursor(self)
    def commit(self): self.sql.commit(); self.commits += 1
    def rollback(self): self.sql.rollback()


class Cursor:
    def __init__(self, db): self.db=db
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params=()):
        self.db.statements.append(sql)
        sql=sql.replace('FOR UPDATE OF q SKIP LOCKED','').replace('FOR UPDATE SKIP LOCKED','').replace('FOR UPDATE','').replace('%s','?')
        sql=sql.replace("clock_timestamp() + INTERVAL '2 minutes'", "datetime(clock_timestamp(), '+2 minutes')")
        sql=sql.replace('UPDATE mail_recipients origin SET','UPDATE mail_recipients AS origin SET')
        self.result=self.db.sql.execute(sql, tuple(x.isoformat() if isinstance(x,datetime) else x for x in params))
    def fetchone(self):
        row=self.result.fetchone()
        return dict(row) if row else None
    def fetchall(self): return [dict(row) for row in self.result.fetchall()]


def operations(db):
    op=MailDeliveryOperations(db=db, adapter=Mock(), quota=Mock())
    op.quota=None
    return op


def test_claim_is_committed_without_reading_files_or_secrets():
    db=Db(); db.add('bad')
    op=operations(db)
    op.security.decrypt_secret=Mock(side_effect=AssertionError('must not prepare'))
    db.sql.execute("UPDATE mail_provider_configs SET username='synthetic'")
    job=op.claim_next('worker')
    assert isinstance(job,dict)
    assert job['claim_token'] and db.row('bad')['claim_token']==job['claim_token']
    assert db.row('bad')['status']=='processing' and db.commits==1
    assert not any('FROM mail_attachments' in sql for sql in db.statements)


def test_preparation_failure_is_terminal_and_next_job_progresses():
    db=Db(); db.add('bad'); db.add('good')
    op=operations(db)
    def prepare(job):
        assert db.row(job['queue_id'])['status']=='processing' and db.commits > 0
        if job['queue_id']=='bad': raise ValueError('sensitive body')
        return {'delivery_enabled':False}
    op.prepare_claim=prepare
    assert op.run_once('worker')
    assert op.run_once('worker')
    assert db.row('bad')['status']=='failed'
    assert db.row('good')['status']=='blocked'
    assert 'PREPARE' in db.row('bad')['last_error']
    assert 'sensitive' not in db.row('bad')['last_error']
    assert db.sql.execute('SELECT COUNT(*) FROM mail_delivery_attempts').fetchone()[0]==2


@pytest.mark.parametrize('action',['finalize','defer','renew','data'])
@pytest.mark.parametrize('expired',[False,True])
def test_stale_or_expired_owner_cannot_change_queue(action,expired):
    db=Db(); db.add('q','processing','current',expired)
    op=operations(db)
    job=dict(db.row('q'),queue_id='q',claim_token='current' if expired else 'stale')
    before=db.row('q')
    if action=='finalize': accepted=op.finalize_claim('worker',job,DeliveryResult('sent'))
    elif action=='defer': accepted=op.defer_claim_for_quota('worker',job,'LIMIT',datetime.now(UTC))
    else: accepted=op.renew_claim('worker',job,send_started=action=='data')
    assert accepted is False
    assert db.row('q')==before
    assert db.sql.execute('SELECT COUNT(*) FROM mail_delivery_attempts').fetchone()[0]==0


def test_expired_processing_is_unknown_not_reclaimed_for_send():
    db=Db(); db.add('expired','processing','old',True); db.add('good')
    op=operations(db)
    assert op.claim_next('replacement') is None
    assert db.row('expired')['status']=='result_unknown'
    assert op.claim_next('replacement')['queue_id']=='good'
    assert db.sql.execute('SELECT result FROM mail_delivery_attempts').fetchone()[0]=='result_unknown'


def test_unknown_retry_requires_confirmation_and_retains_pin():
    db=Db(); db.add('q','result_unknown','old')
    op=operations(db); op.queue_detail=lambda actor,q: db.row(q)
    actor=SimpleNamespace(companyId='a',userId='admin',userName='admin')
    with pytest.raises(ValueError): op.retry(actor,'q')
    with pytest.raises(ValueError): op.retry(SimpleNamespace(companyId='b',userId='admin',userName='admin'),'q',confirm_duplicate_risk=True)
    result=op.retry(actor,'q',confirm_duplicate_risk=True)
    assert result['status']=='queued' and result['provider_config_id']=='pin'
    assert result['claim_token'] is None
    with pytest.raises(ValueError): op.retry(actor,'q',confirm_duplicate_risk=True)
    assert db.sql.execute('SELECT COUNT(*) FROM audit_logs').fetchone()[0]==1


@pytest.mark.parametrize('status',['failed','blocked','retry_pending'])
def test_existing_retry_without_body_remains_compatible(status):
    db=Db(); db.add('q',status); op=operations(db); op.queue_detail=lambda actor,q:db.row(q)
    result=op.retry(SimpleNamespace(companyId='a',userId='admin',userName='admin'),'q')
    assert result['status']=='queued' and result['provider_config_id']=='pin'


def test_two_confirmed_retries_recheck_locked_state_and_only_one_audit():
    import threading
    db=Db(); db.add('q','result_unknown','old')
    lock=threading.Lock()
    class Connection:
        def __init__(self): self.held=False
        def __enter__(self): return self
        def __exit__(self,kind,*args):
            if kind: db.sql.rollback()
            if self.held: lock.release()
        def cursor(self):
            connection=self
            class LockedCursor(Cursor):
                def execute(self,sql,params=()):
                    if sql.startswith('SELECT status FROM mail_delivery_queue'):
                        assert 'FOR UPDATE' in sql
                        lock.acquire(); connection.held=True
                    super().execute(sql,params)
            return LockedCursor(db)
        def commit(self): db.commit()
    db.connect=Connection
    op=operations(db); op.queue_detail=lambda actor,q:{'status':'queued'}
    actor=SimpleNamespace(companyId='a',userId='admin',userName='admin')
    barrier=threading.Barrier(2); outcomes=[]
    def retry():
        barrier.wait()
        try: op.retry(actor,'q',confirm_duplicate_risk=True); outcomes.append('queued')
        except ValueError: outcomes.append('rejected')
    threads=[threading.Thread(target=retry) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(2)
    assert all(not thread.is_alive() for thread in threads)
    assert sorted(outcomes)==['queued','rejected']
    assert db.sql.execute('SELECT COUNT(*) FROM audit_logs').fetchone()[0]==1


def test_wrong_worker_cannot_finalize_even_with_token():
    db=Db(); db.add('q','processing','token'); op=operations(db)
    assert not op.finalize_claim('wrong',dict(db.row('q'),queue_id='q'),DeliveryResult('sent'))


def test_valid_quota_defer_uses_sql_fence_without_attempt_increment():
    db=Db(); db.add('q','processing','token'); op=operations(db)
    assert op.defer_claim_for_quota('worker',dict(db.row('q'),queue_id='q'),'MAIL_DAILY_SEND_LIMIT_EXCEEDED',datetime.now(UTC))
    assert db.row('q')['status']=='retry_pending' and db.row('q')['attempt_count']==0
    assert db.row('q')['lease_expires_at'] is None
    assert db.sql.execute('SELECT count(*) FROM mail_delivery_attempts').fetchone()[0]==0


def test_worker_unknown_and_unexpected_send_failure_are_not_automatic_retry():
    from app.services.mail_delivery_service import MailDeliveryWorker
    from app.services.mail_transports import MailTransportFailure
    for error in (RuntimeError('sensitive body'),MailTransportFailure('SMTP 결과불명',transient=False,result_unknown=True)):
        class Adapter:
            def prepare(self,*args): return 'prepared'
            def send_prepared(self,*args): raise error
        result=MailDeliveryWorker('w',Adapter()).deliver_claimed({},dict(delivery_enabled=True,last_test_status='success'))
        assert result.status=='result_unknown' and result.next_attempt_at is None
        assert 'sensitive' not in result.error_message


def test_actual_attachment_prepare_failure_records_terminal_attempt():
    db=Db(); db.add('bad'); db.add('good'); op=operations(db)
    db.sql.execute("INSERT INTO mail_attachments VALUES ('bad','x','text/plain',1,'missing','attachment',NULL,'now')")
    op.storage.stored_path=Mock(side_effect=OSError('sensitive filepath'))
    db.sql.execute('UPDATE mail_provider_configs SET delivery_enabled=0')
    assert op.run_once('worker') and op.run_once('worker')
    assert db.row('bad')['status']=='failed' and db.row('good')['status']=='blocked'


def test_finalize_commit_failure_is_recovered_unknown_without_smtp_replay():
    db=Db(); db.add('q'); op=operations(db)
    calls=[]
    class Adapter:
        def prepare(self,*args): return 'prepared'
        def send_prepared(self,*args,before_data):
            before_data(); calls.append('accepted'); return 'accepted'
    op.adapter=Adapter()
    commit=db.commit
    def fail_once():
        if db.sql.execute('SELECT count(*) FROM mail_delivery_attempts').fetchone()[0]:
            db.sql.rollback(); db.commit=commit; raise OSError('synthetic DB unavailable')
        commit()
    db.commit=fail_once
    assert op.run_once('worker') is False
    assert calls==['accepted'] and db.row('q')['status']=='processing'
    db.sql.execute("UPDATE mail_delivery_queue SET lease_expires_at='2000-01-01'")
    assert op.run_once('replacement') is False
    assert calls==['accepted'] and db.row('q')['status']=='result_unknown'


def test_unknown_propagates_to_automatic_delivery_without_original_deletion():
    db=Db(); db.add('q','processing','token'); op=operations(db)
    # origin 없음은 reconcile 대상 아님; 전파 SQL은 실제 실행한다.
    db.sql.execute("INSERT INTO mail_out_of_office_deliveries VALUES ('q','queued',NULL,NULL,NULL)")
    assert op.finalize_claim('worker',dict(db.row('q'),queue_id='q'),DeliveryResult('result_unknown'))
    assert db.sql.execute('SELECT status,completed_at FROM mail_out_of_office_deliveries').fetchone()[:]==('result_unknown',None)
    assert db.sql.execute('SELECT count(*) FROM mail_messages').fetchone()[0]==1


def test_auto_forward_unknown_preserves_original_even_keep_original_false():
    db=Db(); db.add('q','processing','token'); op=operations(db)
    for column in ('deleted_at','delivery_source','message_id','recipient_user_id'):
        db.sql.execute('ALTER TABLE mail_recipients ADD COLUMN '+column)
    db.sql.execute('ALTER TABLE mail_messages ADD COLUMN company_id')
    db.sql.execute("UPDATE mail_messages SET company_id='a'")
    db.sql.execute("UPDATE mail_recipients SET delivery_source='direct',message_id='q',recipient_user_id='user'")
    db.sql.execute('CREATE TABLE mail_auto_forward_policies(company_id,user_id,keep_original)')
    db.sql.execute("INSERT INTO mail_auto_forward_policies VALUES ('a','user',0)")
    db.sql.execute("INSERT INTO mail_auto_forward_deliveries VALUES ('q','queued',NULL,NULL,NULL,'q')")
    assert op.finalize_claim('worker',dict(db.row('q'),queue_id='q'),DeliveryResult('result_unknown'))
    assert db.sql.execute('SELECT status FROM mail_auto_forward_deliveries').fetchone()[0]=='result_unknown'
    assert db.sql.execute('SELECT deleted_at FROM mail_recipients').fetchone()[0] is None


def test_background_lease_renewal_runs_during_preparation(monkeypatch):
    import threading
    import app.services.mail_delivery_operations as module
    monkeypatch.setattr(module,'LEASE_RENEW_INTERVAL_SECONDS',0.01,raising=False)
    db=Db(); db.add('q'); op=operations(db)
    renewed=threading.Event()
    original=op.renew_claim
    def renew(*args,**kwargs):
        result=original(*args,**kwargs)
        if threading.current_thread().name=='mail-lease-renew': renewed.set()
        return result
    op.renew_claim=renew
    def prepare(job):
        assert renewed.wait(1), '준비 중 lease 갱신 없음'
        return {'delivery_enabled':False}
    op.prepare_claim=prepare
    assert op.run_once('worker')
    assert renewed.is_set()
    assert not any(thread.name=='mail-lease-renew' for thread in threading.enumerate())


@pytest.mark.parametrize('tamper',[False,True])
def test_submission_inline_actual_claim_prepare_and_raw_validation(tmp_path,monkeypatch,tamper):
    from hashlib import sha256
    from email.parser import BytesParser
    from email.policy import default
    from app.core.config import settings
    from app.services.mail_submission_operations import MailSubmissionStorage,submission_attachments
    from app.services.mail_attachment_storage import MailAttachmentStorage
    from app.services.mail_transports import MailProviderRoutingAdapter,OciEmailDeliveryTransport,SelfHostedSmtpTransport
    from test_smtp_submission_stage2 import raw_mail,Smtp
    monkeypatch.setattr(settings,'storage_local_path',str(tmp_path))
    raw=raw_mail().replace(b'Bcc: hidden@example.net\r\n',b'')
    digest=sha256(raw).hexdigest(); storage=MailSubmissionStorage(tmp_path)
    key=storage.store_raw(digest,raw)
    db=Db(); db.add('q'); op=operations(db); op.storage=MailAttachmentStorage(tmp_path)
    parts=submission_attachments(BytesParser(policy=default).parsebytes(raw))
    assert any(part['content_disposition']=='inline' for part in parts)
    for index,part in enumerate(parts):
        attachment_key=storage.store_attachment(digest,index,part['content'])
        db.sql.execute('INSERT INTO mail_attachments VALUES (?,?,?,?,?,?,?,?)',
            ('q',part['file_name'],part['content_type'],part['size_bytes'],attachment_key,
             part['content_disposition'],part['content_id'],'now'))
    db.sql.execute("UPDATE mail_messages SET raw_storage_key=?,raw_sha256=?,raw_size=?,sender_email='writer@example.test'",(key,digest,len(raw)))
    db.sql.execute("UPDATE mail_delivery_queue SET delivery_kind='submission'")
    db.sql.execute("UPDATE mail_recipients SET recipient_email='hidden@example.net'")
    db.sql.execute("UPDATE mail_provider_configs SET provider_type='oci_email_delivery',username='synthetic'")
    op.security.decrypt_secret=lambda _: 'synthetic'
    smtp=Smtp()
    op.adapter=MailProviderRoutingAdapter(self_hosted_transport=SelfHostedSmtpTransport(mx_resolver=lambda _:[]),
        oci_transport=OciEmailDeliveryTransport(smtp_factory=lambda **_:smtp))
    if tamper: (tmp_path/key).write_bytes(raw.replace(b'Message-ID:',b'Message-XD:'))
    assert op.run_once('worker')
    assert db.row('q')['status']==('failed' if tamper else 'sent')
    if tamper:
        assert smtp.deliveries==[] and 'PREPARE_FAILED' in db.row('q')['last_error']
    else:
        assert smtp.deliveries==[('writer@example.test',['hidden@example.net'],raw)]
        assert db.row('q')['send_started_at'] is not None
