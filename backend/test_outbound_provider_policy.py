import unittest
import inspect
from datetime import UTC, datetime
from pathlib import Path

from app.services.outbound_provider_resolver import OutboundProviderResolver
from app.services.mail_operations_service import MailOperationsService
from app.services.mail_operations_policy import build_mail_domain_contract, plan_provider_switch
from app.services.directory_store import DirectoryStore
from app.services.org_import_service import OrgImportService
from test_stage01_mail_operations_persistence import RecordingCursor
from test_stage01_mail_admin_operations import FakeDb, RecordingCursor as ContextCursor
from app.services.mail_messenger_service import MailMessengerService


class ProviderCursor:
    def __init__(self, rows):
        self.rows = rows

    def execute(self, sql, params):
        assert 'company_id = %s' in sql
        assert 'active = TRUE' in sql
        assert 'updated_at' not in sql
        self.company_id = params[0]

    def fetchall(self):
        return [row for row in self.rows if row['company_id'] == self.company_id and row['active']]


class OutboundProviderPolicyTest(unittest.TestCase):
    def test_only_explicit_company_active_provider_is_selected(self):
        rows = [
            dict(id='oci', company_id='a', active=True, delivery_enabled=False, last_test_status='untested'),
            dict(id='recent-self', company_id='a', active=False),
            dict(id='other-company', company_id='b', active=True),
        ]
        provider = OutboundProviderResolver.resolve(ProviderCursor(rows), 'a')
        self.assertEqual(provider['id'], 'oci')
        self.assertFalse(provider['delivery_enabled'])

    def test_missing_or_duplicate_active_provider_fails_closed(self):
        for rows in ([], [dict(id=str(i), company_id='a', active=True) for i in range(2)]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                OutboundProviderResolver.resolve(ProviderCursor(rows), 'a')

    def test_domain_setup_without_active_provider_and_first_switch(self):
        cursor = RecordingCursor()
        MailOperationsService().save_domain_contract(
            cursor=cursor, company_id='a', active_provider=None,
            contract=build_mail_domain_contract(registered_domain='example.test', mail_domain='mail.example.test', admin_access_mode='public'),
        )
        self.assertIsNone(cursor.statements[0][1][9])
        plan = plan_provider_switch(current_provider=None, target_provider='oci_email_delivery', queued_items=[])
        self.assertIsNone(plan.previous_provider)

    def test_account_creation_has_no_provider_dependency(self):
        for method in (DirectoryStore.initialize_installation, DirectoryStore.create_user, OrgImportService):
            source = inspect.getsource(method)
            self.assertNotIn('provider_config_id', source)
            if method is not DirectoryStore.initialize_installation:
                self.assertNotIn('provider["id"]', source)

    def test_migration_keeps_old_pins_queue_and_audit_and_removes_runtime_requirement(self):
        sql = (Path(__file__).parent / 'migrations/070_company_outbound_provider_policy.sql').read_text(encoding='utf-8')
        self.assertIn('ALTER COLUMN provider_config_id DROP NOT NULL', sql)
        self.assertIn('ON DELETE RESTRICT', sql)
        self.assertIn('CREATE UNIQUE INDEX', sql)
        self.assertNotIn('DELETE FROM', sql)
        self.assertNotIn('DROP COLUMN', sql)

    def test_new_users_and_unrelated_updates_cannot_change_selection(self):
        rows = [dict(id='oci', company_id='a', active=True), dict(id='self', company_id='a', active=False)]
        for stamp in ('2000-01-01', '2099-01-01'):
            rows[1]['updated_at'] = stamp
            self.assertEqual(OutboundProviderResolver.resolve(ProviderCursor(rows), 'a')['id'], 'oci')

    def test_settings_with_missing_or_duplicate_active_stay_locked(self):
        for rows in ([], [dict(id=str(i), company_id='a', active=True) for i in range(2)]):
            self.assertIsNone(OutboundProviderResolver.readiness(ProviderCursor(rows), 'a'))

    def test_scheduled_dispatch_resolves_company_policy_at_dispatch_time(self):
        class ScheduledCursor(ContextCursor):
            def execute(self, query, params=None):
                super().execute(query, params)
                self.query = ' '.join(query.split())

            def fetchall(self):
                if 'FROM mail_messages WHERE status' in self.query:
                    return [dict(id='scheduled', company_id='a', sender_user_id='sender')]
                if 'SELECT * FROM mail_provider_configs' in self.query:
                    self.testcase.assertEqual(self.statements[-1][1], ('a',))
                    return [dict(id='current-oci', company_id='a', active=True)]
                return []

            def fetchone(self):
                return {'id': 'external'} if 'recipient_user_id IS NULL LIMIT 1' in self.query else None

        cursor = ScheduledCursor()
        cursor.testcase = self
        service = object.__new__(MailMessengerService)
        service.db = FakeDb(cursor)
        service._now = lambda: datetime(2026, 9, 5, tzinfo=UTC)
        service._new_id = lambda prefix: prefix
        service._upsert_recent_recipients = lambda *args, **kwargs: None
        service._write_mail_event_audit = lambda *args, **kwargs: None
        self.assertEqual(service.dispatch_scheduled_mail(), 1)
        sql, params = next((sql, params) for sql, params in cursor.statements if sql.startswith('INSERT INTO mail_delivery_queue'))
        self.assertEqual(params[-2], 'current-oci')
        self.assertNotIn('a.provider_config_id', sql)
