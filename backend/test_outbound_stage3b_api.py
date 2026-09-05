"""실제 mounted admin route + Stage3A 실제 SQL 메서드/로컬 SQLite. 실PG/SMTP 아님."""
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import admin
from test_outbound_stage3a_lifecycle import Db, operations
import pytest


@pytest.mark.parametrize('locked,suppressed', [(True, False), (False, True)])
def test_blocked_has_distinct_worker_causes_without_transport(locked, suppressed):
    from app.services.mail_delivery_service import MailDeliveryWorker
    from unittest.mock import Mock
    adapter = Mock()
    result = MailDeliveryWorker('synthetic', adapter).deliver_claimed(
        {'recipient_suppressed': suppressed},
        {'delivery_enabled': not locked, 'last_test_status': 'success', 'provider_type': 'oci_email_delivery'})
    assert result.status == 'blocked'
    assert ('suppression' in result.error_message) is suppressed
    assert adapter.mock_calls == []


def test_mounted_queue_detail_retry_company_and_strict_confirmation(monkeypatch):
    db = Db()
    try:
        db.add('unknown', 'result_unknown')
        db.add('failed', 'failed')
        db.add('foreign', 'failed')
        db.sql.execute("UPDATE mail_delivery_queue SET company_id='b' WHERE id='foreign'")
        db.sql.commit()
        service = operations(db)
        monkeypatch.setattr(admin, '_delivery_service', lambda: service)
        app = FastAPI()
        app.include_router(admin.router, prefix='/api/v1/admin')
        app.dependency_overrides[admin.require_admin] = lambda: SimpleNamespace(companyId='a', userId='u', userName='합성관리자')
        with TestClient(app) as client:
            base = '/api/v1/admin/mail-delivery/queue'
            listing = client.get(base)
            assert listing.status_code == 200
            assert set(listing.json()) == {'items', 'total'}
            assert listing.json()['total'] == 2
            assert {row['queueId'] for row in listing.json()['items']} == {'unknown', 'failed'}
            for body in [None, {}, {'confirmDuplicateRisk': False}]:
                response = client.post(base+'/unknown/retry') if body is None else client.post(base+'/unknown/retry', json=body)
                assert response.status_code == 400
                assert db.row('unknown')['status'] == 'result_unknown'
            for value in ['true', 1, None]:
                assert client.post(base+'/unknown/retry', json={'confirmDuplicateRisk': value}).status_code == 422
            accepted = client.post(base+'/unknown/retry', json={'confirmDuplicateRisk': True})
            assert accepted.status_code == 200
            detail = accepted.json()
            assert set(detail) == {'item', 'attempts', 'audits'}
            assert detail['item']['status'] == 'queued'
            assert detail['audits'][0]['event'] == 'mail.delivery.retry.duplicate_risk_confirmed'
            assert db.row('unknown')['provider_config_id'] == 'pin'
            assert client.get(base+'/unknown').json() == detail
            assert client.post(base+'/failed/retry').status_code == 200
            assert client.post(base+'/foreign/retry').status_code == 400
            assert db.row('foreign')['status'] == 'failed'
    finally:
        db.sql.close()
