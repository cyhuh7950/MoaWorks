"""선택 SQL은 SQLite에서 실행; PostgreSQL 잠금/실행계획은 Main 검증 경계."""
import sqlite3
from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.services.mail_messenger_service import MailMessengerService
from test_outbound_policy_stage1_rework import NOW, ScheduledCursor
from test_stage01_mail_admin_operations import FakeDb


class FairCursor(ScheduledCursor):
    def __init__(self, scheduled_at):
        super().__init__([f'bad-{i:03}' for i in range(100)] + ['good'])
        for identifier, message in self.messages.items():
            message.update(company_id='b' if identifier == 'good' else 'a',
                           scheduled_at=scheduled_at.isoformat(), sender_deleted_at=None,
                           subject='original', body_text='original body', attachment_count=0,
                           is_auto_generated=False)
        self.original = self.snapshot()
        self.audit_rows = []
        self.recovered = set()
        self.batch_sizes = []

    def execute(self, query, params=None):
        super().execute(query, params)
        sql = self.statements[-1][0]
        if 'FROM mail_messages WHERE status' in sql:
            assert 'FOR UPDATE SKIP LOCKED' in sql
            assert 'LIMIT %s' in sql
            # 실제 제품 SELECT/ORDER/LIMIT을 사용하며 PG 잠금절만 제거한다.
            with sqlite3.connect(':memory:') as db:
                db.row_factory = sqlite3.Row
                db.create_function('GREATEST', -1, lambda *xs: max(x for x in xs if x is not None))
                columns = list(next(iter(self.messages.values())))
                db.execute('CREATE TABLE mail_messages (' + ','.join(columns) + ')')
                db.executemany('INSERT INTO mail_messages VALUES (' + ','.join('?' for _ in columns) + ')',
                               [tuple(m[c].isoformat() if hasattr(m[c], 'isoformat') else m[c]
                                      for c in columns) for m in self.messages.values()])
                db.execute('CREATE TABLE audit_logs (company_id, target_id, target_type, event, created_at)')
                db.executemany('INSERT INTO audit_logs VALUES (?,?,?,?,?)', self.audit_rows)
                translated = query.replace('FOR UPDATE SKIP LOCKED', '').replace('%s', '?')
                self.rows = [dict(row) for row in db.execute(translated, (params[0].isoformat(), params[1]))]
            self.batch_sizes.append(len(self.rows))
        elif sql.startswith('SELECT id FROM mail_recipients'):
            self.rows = [{'id': 'external'}] if params[0].startswith('bad') and params[0] not in self.recovered else []
        elif sql.startswith('INSERT INTO audit_logs') and 'VALUES' in sql:
            self.audit_rows.append((params[1], params[4], 'mail', params[5], params[9].isoformat()))


def service_for(cursor):
    service = object.__new__(MailMessengerService)
    service.db = FakeDb(cursor)
    connection = service.db.connections[0]
    service.db.connect = lambda: connection
    service._now = lambda: NOW
    service._new_id = lambda prefix: prefix
    service._evaluate_recipient_spam_for_company = lambda *args: SimpleNamespace(decision='normal')
    for name in ('_upsert_recent_recipients', '_write_spam_classification_audit_for_actor',
                 '_apply_auto_classification', '_apply_auto_forwarding', '_apply_out_of_office'):
        setattr(service, name, lambda *args, **kwargs: None)
    return service


@pytest.mark.parametrize('scheduled_at', [NOW - timedelta(days=1), NOW])
def test_100_blocked_then_one_good_progresses_at_fixed_now(scheduled_at):
    cursor = FairCursor(scheduled_at)
    service = service_for(cursor)
    assert [service.dispatch_scheduled_mail(), service.dispatch_scheduled_mail()] == [0, 1]
    assert cursor.batch_sizes == [100, 100]
    assert cursor.messages['good']['status'] == 'sent'
    for identifier in cursor.order[:-1]:
        assert cursor.messages[identifier] == cursor.original[0][identifier]
        assert cursor.recipients[identifier] == cursor.original[1][identifier]
    assert cursor.attachments == cursor.original[2]


def test_previously_blocked_mail_is_retryable_when_policy_recovers_at_same_now():
    cursor = FairCursor(NOW)
    cursor.messages['good']['status'] = 'sent'
    service = service_for(cursor)
    assert service.dispatch_scheduled_mail(limit=1) == 0
    cursor.recovered.add('bad-000')
    # 동일 시각 재실패도 count tie-break로 순환; 과거 감사가 영구 제외하지 않는다.
    assert sum(service.dispatch_scheduled_mail(limit=1) for _ in range(100)) == 1
    assert cursor.messages['bad-000']['status'] == 'sent'
    assert max(cursor.batch_sizes) == 1


def test_other_company_target_type_and_event_do_not_affect_selection():
    cursor = FairCursor(NOW)
    future = (NOW + timedelta(days=1)).isoformat()
    cursor.audit_rows.extend([
        ('other-company', 'bad-000', 'mail', 'mail.scheduled.blocked', future),
        ('a', 'bad-000', 'other-target', 'mail.scheduled.blocked', future),
        ('a', 'bad-000', 'mail', 'other-event', future),
        ('a', 'other-id', 'mail', 'mail.scheduled.blocked', future),
    ])
    assert service_for(cursor).dispatch_scheduled_mail(limit=1) == 0
    assert cursor.events[0]['mail_id'] == 'bad-000'
