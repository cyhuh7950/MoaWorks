"""Main Stage4 전용: 명시된 격리 DB에서 transaction schema를 만들고 항상 rollback한다."""
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
import pytest

from app.services.mail_operations_service import MailOperationsService


@pytest.fixture
def policy_db():
    dsn = os.environ.get('MOAWORKS_STAGE1_TEST_DSN')
    if not dsn:
        pytest.skip('Main Stage4 격리 DB DSN 명시 필요')
    with psycopg.connect(dsn, row_factory=dict_row) as connection:
        try:
            with connection.cursor() as cursor:
                schema = 'stage1_' + uuid4().hex
                cursor.execute(psycopg.sql.SQL('CREATE SCHEMA {}').format(psycopg.sql.Identifier(schema)))
                cursor.execute(psycopg.sql.SQL('SET LOCAL search_path TO {}').format(psycopg.sql.Identifier(schema)))
                cursor.execute('''
                    CREATE TABLE mail_provider_configs(id text PRIMARY KEY, company_id text NOT NULL, provider_type text,
                        active boolean NOT NULL DEFAULT TRUE, delivery_enabled boolean DEFAULT TRUE, last_test_status text DEFAULT 'success', updated_at timestamptz DEFAULT now());
                    CREATE TABLE mail_accounts(id text PRIMARY KEY, provider_config_id text NOT NULL REFERENCES mail_provider_configs(id));
                    CREATE TABLE mail_delivery_queue(id text PRIMARY KEY,company_id text,provider_config_id text NOT NULL REFERENCES mail_provider_configs(id) ON DELETE CASCADE,status text,created_at timestamptz DEFAULT now());
                    CREATE TABLE mail_domain_settings(company_id text PRIMARY KEY, active_outbound_provider_key text NOT NULL, previous_outbound_provider_key text,provider_switched_at timestamptz,updated_at timestamptz);
                    CREATE TABLE audit_logs(id text,company_id text,actor_user_id text,actor_user_name text,target_type text,target_id text,event text,status_before text,status_after text,reason text,created_at timestamptz);
                    INSERT INTO mail_provider_configs(id,company_id,provider_type,active) VALUES ('oci','a','oci_email_delivery',TRUE),('self','a','self_hosted',FALSE);
                    INSERT INTO mail_accounts VALUES ('old-account','oci');
                    INSERT INTO mail_delivery_queue(id,company_id,provider_config_id,status) VALUES ('old-queue','a','oci','queued');
                    INSERT INTO mail_domain_settings(company_id,active_outbound_provider_key) VALUES ('a','oci_email_delivery'),('empty','self_hosted');
                    INSERT INTO audit_logs(id,event) VALUES ('old-audit','historical');
                ''')
                yield cursor
        finally:
            connection.rollback()


def migrate(cursor):
    cursor.execute((Path(__file__).parent / 'migrations/070_company_outbound_provider_policy.sql').read_text(encoding='utf-8'))


def test_real_trigger_switch_rollback_and_history_preservation(policy_db):
    cursor = policy_db
    migrate(cursor)
    cursor.execute("SELECT active_outbound_provider_key FROM mail_domain_settings WHERE company_id='empty'")
    assert cursor.fetchone()['active_outbound_provider_key'] is None
    cursor.execute("INSERT INTO mail_accounts(id) VALUES ('new-account')")
    cursor.execute("INSERT INTO mail_provider_configs(id,company_id,provider_type) VALUES ('setup-provider','new-company','smtp')")
    cursor.execute("INSERT INTO mail_domain_settings(company_id,active_outbound_provider_key) VALUES ('new-company','oci_email_delivery')")
    cursor.execute("SELECT active_outbound_provider_key FROM mail_domain_settings WHERE company_id='new-company'")
    assert cursor.fetchone()['active_outbound_provider_key'] == 'self_hosted'
    service = MailOperationsService()
    service.switch_outbound_provider(cursor=cursor,company_id='a',actor_user_id='admin',current_provider='oci_email_delivery',target_provider='self_hosted')
    cursor.execute("SELECT * FROM mail_domain_settings WHERE company_id='a'")
    state = cursor.fetchone()
    assert state['previous_outbound_provider_key'] == 'oci_email_delivery'
    assert state['active_outbound_provider_key'] == 'self_hosted'
    service.rollback_outbound_provider(cursor=cursor,company_id='a',actor_user_id='admin')
    cursor.execute("SELECT active_outbound_provider_key FROM mail_domain_settings WHERE company_id='a'")
    assert cursor.fetchone()['active_outbound_provider_key'] == 'oci_email_delivery'
    cursor.execute("SELECT provider_config_id FROM mail_delivery_queue WHERE id='old-queue'")
    assert cursor.fetchone()['provider_config_id'] == 'oci'
    cursor.execute("SELECT provider_config_id FROM mail_accounts WHERE id='old-account'")
    assert cursor.fetchone()['provider_config_id'] == 'oci'
    cursor.execute("SELECT event FROM audit_logs WHERE id='old-audit'")
    assert cursor.fetchone()['event'] == 'historical'
    with pytest.raises(psycopg.errors.UniqueViolation), cursor.connection.transaction():
        cursor.execute("INSERT INTO mail_provider_configs(id,company_id,provider_type) VALUES ('duplicate','a','smtp')")
    cursor.execute("UPDATE mail_provider_configs SET active=FALSE WHERE id='oci'")
    cursor.execute("UPDATE mail_accounts SET provider_config_id=NULL WHERE id='old-account'")
    with pytest.raises(psycopg.errors.ForeignKeyViolation), cursor.connection.transaction():
        cursor.execute("DELETE FROM mail_provider_configs WHERE id='oci'")
    cursor.execute("SELECT count(*) AS count FROM mail_delivery_queue")
    assert cursor.fetchone()['count'] == 1


def test_duplicate_active_aborts_migration_without_rewriting_data(policy_db):
    cursor = policy_db
    cursor.execute("UPDATE mail_provider_configs SET active=TRUE WHERE id='self'")
    with pytest.raises(psycopg.errors.RaiseException), cursor.connection.transaction():
        migrate(cursor)
    cursor.execute("SELECT count(*) AS count FROM mail_provider_configs WHERE active")
    assert cursor.fetchone()['count'] == 2
