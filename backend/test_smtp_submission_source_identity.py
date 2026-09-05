"""S2-PRE-I1: 25 hash 정체성과 인증 submission queue 정체성 분리."""
import pytest
import sqlite3

from app.services.mail_inbound_operations import MailInboundOperations, MailInboundStorage
from test_smtp_submission_stage2 import FixtureDatabase, raw_mail, submit, submission_module


@pytest.fixture
def source_db(tmp_path):
    db = FixtureDatabase()
    # 25 ingest의 기존 message INSERT에 필요한 축소 fixture 필드.
    for column in ('reply_to_email TEXT','message_encoding TEXT','sender_copy_saved BOOLEAN','read_receipt_requested BOOLEAN'):
        db.sql.execute(f'ALTER TABLE mail_messages ADD COLUMN {column}')
    db.commit()
    db.sql.execute('PRAGMA foreign_keys=ON')
    module = submission_module()
    service = module.MailSubmissionOperations(db=db,storage=module.MailSubmissionStorage(tmp_path))
    inbound = MailInboundOperations(db=db,storage=MailInboundStorage(tmp_path))
    try:
        yield db, service, inbound
    finally:
        db.sql.close()


CASES = [(b'','internal'),(b'X-Spam: Yes\r\n','spam'),(b'X-Virus-Status: Infected\r\n','quarantine')]


def scalar(db, query):
    return next(iter(db.sql.execute(query).fetchone().values()))


@pytest.mark.parametrize('header,disposition',CASES)
def test_distinct_submission_queues_each_deliver_and_same_queue_retry_deduplicates(source_db,header,disposition):
    db, service, _ = source_db
    raw = header + raw_mail()
    for queue in ('FirstQueue123','SecondQueue123'):
        assert submit(service,raw,'local@example.test',queue) == dict(status='accepted',duplicate=False,disposition=disposition)
        assert submit(service,raw,'local@example.test',queue)['duplicate'] is True
    assert scalar(db,'SELECT count(*) FROM mail_submission_recipients') == 2
    assert scalar(db,'SELECT count(*) FROM mail_messages') == 2
    assert scalar(db,'SELECT count(*) FROM mail_inbound_recipients') == 2
    assert scalar(db,'SELECT count(*) FROM mail_inbound_messages') == 2
    assert scalar(db,'SELECT count(DISTINCT content_sha256) FROM mail_inbound_messages') == 1
    assert scalar(db,'SELECT count(*) FROM mail_recipients') == (0 if disposition == 'quarantine' else 2)
    if disposition != 'quarantine':
        assert scalar(db,'SELECT count(DISTINCT mail_message_id) FROM mail_inbound_messages') == 2


@pytest.mark.parametrize('header,disposition',CASES)
@pytest.mark.parametrize('inbound_first',[True,False])
def test_port25_hash_dedup_is_independent_from_submission_source(source_db,header,disposition,inbound_first):
    db,service,inbound = source_db
    raw = header + raw_mail().replace(b'Bcc: hidden@example.net\r\n',b'')
    def receive():
        return inbound.ingest(envelope_from='writer@example.test',recipient_email='local@example.test',raw_message=raw)
    if inbound_first: assert receive().duplicate is False
    for queue in ('FirstQueue123','SecondQueue123'):
        assert submit(service,raw,'local@example.test',queue)['duplicate'] is False
    if not inbound_first: assert receive().duplicate is False
    assert receive().duplicate is True
    assert scalar(db,'SELECT count(*) FROM mail_inbound_recipients') == 3
    assert scalar(db,'SELECT count(*) FROM mail_inbound_messages') == 3
    assert scalar(db,'SELECT count(DISTINCT content_sha256) FROM mail_inbound_messages') == 1
    if disposition != 'quarantine':
        assert scalar(db,'SELECT count(DISTINCT mail_message_id) FROM mail_inbound_messages') == 3


@pytest.mark.parametrize('header,disposition',CASES)
def test_multiple_internal_recipients_are_distinct_per_queue(source_db,header,disposition):
    db,service,_ = source_db
    raw = header + raw_mail()
    for queue in ('FirstQueue123','SecondQueue123'):
        for recipient in ('local@example.test','writer@example.test'):
            assert submit(service,raw,recipient,queue)['duplicate'] is False
            assert submit(service,raw,recipient,queue)['duplicate'] is True
    assert scalar(db,'SELECT count(*) FROM mail_inbound_messages') == 2
    assert scalar(db,'SELECT count(*) FROM mail_inbound_recipients') == 4
    assert scalar(db,'SELECT count(*) FROM mail_submission_recipients') == 4
    assert scalar(db,'SELECT count(*) FROM mail_messages') == 2


@pytest.mark.parametrize('header,disposition',CASES)
def test_deleted_submission_tombstone_does_not_suppress_different_queue(source_db,header,disposition):
    db,service,_ = source_db
    raw = header + raw_mail()
    submit(service,raw,'local@example.test','FirstQueue123')
    # 실제071 ON DELETE SET NULL 이후 상태를 fixture에 명시한다.
    db.sql.execute('UPDATE mail_submission_messages SET mail_message_id=NULL')
    db.sql.execute('UPDATE mail_inbound_messages SET mail_message_id=NULL')
    db.sql.execute('DELETE FROM mail_recipients')
    db.sql.execute('DELETE FROM mail_messages')
    db.commit()
    assert submit(service,raw,'local@example.test','FirstQueue123')['duplicate'] is True
    assert scalar(db,'SELECT count(*) FROM mail_messages') == 0
    assert submit(service,raw,'local@example.test','SecondQueue123')['duplicate'] is False
    assert scalar(db,'SELECT count(*) FROM mail_recipients') == (0 if disposition == 'quarantine' else 1)
    assert scalar(db,'SELECT count(*) FROM mail_inbound_recipients') == 2


def test_inbound_source_fk_binds_tenant_and_durable_submission(source_db):
    db,service,_ = source_db
    submit(service,raw_mail(),'local@example.test','FirstQueue123')
    for query in (
        "UPDATE mail_inbound_messages SET company_id='company-b'",
        "UPDATE mail_inbound_messages SET submission_queue_id='UnknownQueue123'",
        "DELETE FROM mail_submission_messages",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            db.sql.execute(query)
        db.sql.rollback()
    row = db.sql.execute('SELECT company_id,submission_queue_id FROM mail_inbound_messages').fetchone()
    assert row == dict(company_id='company-a',submission_queue_id='FirstQueue123')


def test_partial_uniques_preserve_25_hash_and_submission_queue_contract(source_db):
    db,service,inbound = source_db
    raw = raw_mail().replace(b'Bcc: hidden@example.net\r\n',b'')
    inbound.ingest(envelope_from='writer@example.test',recipient_email='local@example.test',raw_message=raw)
    for queue in ('FirstQueue123','SecondQueue123'):
        submit(service,raw,'local@example.test',queue)
    assert scalar(db,'SELECT count(*) FROM mail_inbound_messages WHERE submission_queue_id IS NULL') == 1
    assert scalar(db,'SELECT count(*) FROM mail_inbound_messages WHERE submission_queue_id IS NOT NULL') == 2
    for source in (None,'FirstQueue123'):
        with pytest.raises(sqlite3.IntegrityError):
            db.sql.execute('''INSERT INTO mail_inbound_messages(id,company_id,content_sha256,submission_queue_id)
                SELECT 'duplicate',company_id,content_sha256,submission_queue_id FROM mail_inbound_messages
                WHERE submission_queue_id IS ?''',(source,))
        db.sql.rollback()
    # 다른 queue들이 같은 mail_message_id를 공유하거나 25 copy를 덮어쓰지 않는다.
    rows = db.sql.execute('''SELECT i.mail_message_id AS inbound_mail,s.mail_message_id AS source_mail
        FROM mail_inbound_messages i JOIN mail_submission_messages s
        ON s.company_id=i.company_id AND s.gateway_queue_id=i.submission_queue_id''').fetchall()
    assert len(rows) == 2 and all(row['inbound_mail'] == row['source_mail'] for row in rows)
    assert scalar(db,'SELECT count(DISTINCT mail_message_id) FROM mail_inbound_messages') == 3
