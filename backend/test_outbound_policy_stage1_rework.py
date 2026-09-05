from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from app.services.directory_store import DirectoryStore
from app.services.mail_messenger_service import MailMessengerService
from app.services.relay_service import RelayService
from app.api.routes import admin
from app.schemas.directory import RelayTestRequest
from test_stage01_mail_admin_operations import FakeDb, RecordingCursor


NOW = datetime(2026, 9, 5, tzinfo=UTC)


def provider(identifier, company='a', active=True, updated=NOW):
    return dict(id=identifier, company_id=company, provider_type='smtp', relay_host='mail-layer',
                relay_port=25, username='', encrypted_password='', active=active,
                last_test_status='untested', last_test_message='', updated_at=updated)


class DirectoryCursor(RecordingCursor):
    def __init__(self, providers):
        super().__init__()
        self.providers = providers

    def execute(self, query, params=None):
        super().execute(query, params)
        query = self.statements[-1][0]
        self.rows = []
        if 'FROM companies' in query:
            self.rows = [dict(id=params[0] if params else 'a', name='Company', domain='example.test', status='active', created_at=NOW)]
        elif 'FROM mail_provider_configs' in query:
            self.rows = list(self.providers)
            if 'company_id = %s' in query:
                self.rows = [p for p in self.rows if p['company_id'] == params[-1]]
            if 'WHERE id = %s' in query:
                self.rows = [p for p in self.rows if p['id'] == params[0]]
            if 'active = TRUE' in query:
                self.rows = [p for p in self.rows if p['active']]
            if 'ORDER BY updated_at DESC' in query:
                self.rows = sorted(self.rows, key=lambda p: p['updated_at'], reverse=True)[:1]

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


def directory(providers):
    store = object.__new__(DirectoryStore)
    store.db = FakeDb(DirectoryCursor(providers))
    return store


def test_directory_overview_ignores_newer_inactive_and_other_company_provider():
    rows = [provider('active'), provider('inactive', active=False, updated=datetime(2098, 1, 1, tzinfo=UTC)),
            provider('other', company='b', updated=datetime(2099, 1, 1, tzinfo=UTC))]
    assert directory(rows).get_overview().mailProvider.id == 'active'


@pytest.mark.parametrize('rows', [[], [provider('inactive', active=False)], [provider('one'), provider('two')]])
def test_directory_missing_or_duplicate_active_has_null_provider(rows):
    assert directory(rows).get_overview().model_dump(mode='json')['mailProvider'] is None


def test_default_and_explicit_provider_queries_are_scoped_and_explicit_inactive_is_allowed():
    rows = [provider('active'), provider('inactive', active=False), provider('other', company='b')]
    assert directory(rows).get_provider(company_id='a').id == 'active'
    assert directory(rows).get_provider('inactive', company_id='a').id == 'inactive'
    with pytest.raises(ValueError):
        directory(rows).get_provider('other', company_id='a')
    with pytest.raises(ValueError):
        directory([]).get_provider(company_id='a')
    assert directory(rows).get_overview(company_id='b').mailProvider.id == 'other'


def test_relay_rejects_missing_policy_as_client_error_without_test_write():
    actor = SimpleNamespace(companyId='tenant-a')
    with patch.object(admin, 'RelayService') as relay:
        relay.return_value.test.side_effect = ValueError('활성 발송 Provider가 정확히 하나여야 합니다.')
        with pytest.raises(admin.HTTPException) as error:
            admin.test_relay(RelayTestRequest(testRecipient='qa@example.test'), actor)
        assert error.value.status_code == 400


def test_admin_routes_forward_actor_company_for_overview_and_relay():
    actor = SimpleNamespace(companyId='tenant-a')
    with patch.object(admin, 'DirectoryStore') as store, patch.object(admin, 'RelayService') as relay:
        admin.get_directory(actor)
        store.return_value.get_overview.assert_called_once_with(company_id='tenant-a')
        admin.test_relay(RelayTestRequest(providerConfigId='inactive', testRecipient='qa@example.test'), actor)
        relay.return_value.test.assert_called_once_with('inactive', 'qa@example.test', company_id='tenant-a')


def test_relay_threads_company_to_provider_read_without_fabricating_result_write():
    store = Mock()
    store.get_provider.return_value = SimpleNamespace(id='inactive', providerType='smtp', relayHost='mail-layer')
    store.update_relay_test_status.return_value = SimpleNamespace(id='inactive')
    service = RelayService(store)
    with patch.object(service, '_emit_relay_event'):
        result = service.test('inactive', 'qa@example.test', company_id='a')
    store.get_provider.assert_called_once_with('inactive', company_id='a')
    store.update_relay_test_status.assert_not_called()
    assert result.status == 'untested'


class ScheduledCursor(RecordingCursor):
    def __init__(self, order):
        super().__init__()
        self.order = order
        self.messages = {identifier: dict(id=identifier, company_id='a' if identifier == 'bad' else 'b',
                        sender_user_id='sender', sender_email='sender@example.test', status='scheduled', sent_at=None)
                         for identifier in order}
        self.recipients = {identifier: dict(id=identifier+'-rcpt', recipient_user_id='recipient', recipient_email='recipient@example.test', received_at=None)
                           for identifier in order}
        self.attachments = {'bad': ['original-attachment']}
        self.events = []
        self.before = self.snapshot()
        self.savepoint = None

    def snapshot(self):
        return deepcopy((self.messages, self.recipients, self.attachments, self.events))

    def restore(self, snapshot):
        self.messages, self.recipients, self.attachments, self.events = deepcopy(snapshot)

    def execute(self, query, params=None):
        super().execute(query, params)
        sql = self.statements[-1][0]
        self.rows = []
        if sql.startswith('SAVEPOINT scheduled_mail'):
            self.savepoint = self.snapshot()
        elif sql.startswith('ROLLBACK TO SAVEPOINT scheduled_mail'):
            self.restore(self.savepoint)
        elif 'FROM mail_messages WHERE status' in sql:
            self.rows = [dict(self.messages[identifier]) for identifier in self.order]
        elif sql.startswith("UPDATE mail_messages SET status = 'sent'"):
            self.messages[params[-1]].update(status='sent', sent_at=params[0])
        elif sql.startswith('SELECT id, recipient_user_id, recipient_email FROM mail_recipients'):
            self.rows = [dict(self.recipients[params[0]])]
        elif sql.startswith('UPDATE mail_recipients SET received_at'):
            self.recipients[params[-2]]['received_at'] = params[0]
        elif sql.startswith('SELECT id FROM mail_recipients'):
            self.rows = [{'id': 'external'}] if params[0] == 'bad' else []
        elif sql.startswith('INSERT INTO audit_logs') and 'VALUES' in sql:
            self.events.append({'mail_id': params[4], 'event': params[5], 'after': params[7]})

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


@pytest.mark.parametrize('order', [('bad', 'good'), ('good', 'bad')])
def test_scheduled_policy_failure_isolated_and_success_preserved_in_both_orders(order):
    cursor = ScheduledCursor(order)
    db = FakeDb(cursor)
    connection = db.connections[0]
    service = object.__new__(MailMessengerService)
    service.db = db
    service._now = lambda: NOW
    service._new_id = lambda prefix: prefix
    service._evaluate_recipient_spam_for_company = lambda *args: SimpleNamespace(decision='normal')
    for name in ('_upsert_recent_recipients', '_write_spam_classification_audit_for_actor',
                 '_apply_auto_classification', '_apply_auto_forwarding', '_apply_out_of_office'):
        setattr(service, name, lambda *args, **kwargs: None)
    assert service.dispatch_scheduled_mail() == 1
    assert connection.commits == 1
    assert cursor.messages['good']['status'] == 'sent'
    assert cursor.recipients['good']['received_at'] == NOW
    assert cursor.messages['bad'] == cursor.before[0]['bad']
    assert cursor.recipients['bad'] == cursor.before[1]['bad']
    assert cursor.attachments == cursor.before[2]
    assert {'mail_id': 'bad', 'event': 'mail.scheduled.blocked', 'after': 'scheduled'} in cursor.events
    assert not any(event['mail_id'] == 'bad' and event['after'] == 'sent' for event in cursor.events)
