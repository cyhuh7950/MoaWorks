from __future__ import annotations
import os
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4
from app.services.mail_delivery_operations import MailDeliveryOperations
from app.services.oci_email_operations import OciEmailOperations
from app.services.postgres_service import PostgresService


def run_oci_sender_sync_once(db=None, operations=None) -> int:
    service = db or PostgresService()
    sync = operations or OciEmailOperations()
    service.ensure_migrations_applied()
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT d.company_id,d.mail_domain
               FROM mail_domain_settings d
               WHERE d.mail_domain IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM mail_provider_configs p
                   WHERE p.company_id=d.company_id
                     AND p.provider_type IN ('oci_email_delivery','oci_smtp')
                     AND p.active=TRUE
                 )"""
        )
        companies = cursor.fetchall()
    completed = 0
    for company in companies:
        try:
            sync.reconcile_company(db=service, company_id=company["company_id"], mail_domain=company["mail_domain"])
            completed += 1
        except Exception:
            # 다음 worker 주기에 재시도하며, 메일 큐 처리를 중단하지 않는다.
            continue
    return completed

def run_oci_sender_outbox_once(db=None, operations=None, limit: int = 50) -> int:
    service = db or PostgresService()
    sync = operations or OciEmailOperations()
    now = datetime.now(UTC)
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """SELECT o.id,o.company_id,o.attempt_count,d.mail_domain
               FROM mail_oci_sender_sync_outbox o
               JOIN mail_domain_settings d ON d.company_id=o.company_id
              WHERE o.status IN ('pending','failed') AND o.next_attempt_at <= %s
              ORDER BY o.next_attempt_at,o.created_at
              LIMIT %s FOR UPDATE SKIP LOCKED""", (now, limit)
        )
        rows = cursor.fetchall()
        for row in rows:
            cursor.execute("UPDATE mail_oci_sender_sync_outbox SET status='processing',updated_at=%s WHERE id=%s", (now, row['id']))
        connection.commit()
    completed = 0
    for row in rows:
        try:
            sync.reconcile_company(db=service, company_id=row['company_id'], mail_domain=row['mail_domain'])
            with service.connect() as connection, connection.cursor() as cursor:
                cursor.execute("UPDATE mail_oci_sender_sync_outbox SET status='succeeded',updated_at=%s,last_error=NULL WHERE id=%s", (now, row['id']))
                connection.commit()
            completed += 1
        except Exception as exc:
            attempt = int(row.get('attempt_count') or 0) + 1
            delay = min(3600, 30 * (2 ** min(attempt - 1, 6)))
            with service.connect() as connection, connection.cursor() as cursor:
                cursor.execute("UPDATE mail_oci_sender_sync_outbox SET status='failed',attempt_count=%s,next_attempt_at=%s,last_error=%s,updated_at=%s WHERE id=%s", (attempt, now + timedelta(seconds=delay), str(exc)[:1000], now, row['id']))
                connection.commit()
    return completed

def run_worker_iteration(operations, worker_id: str) -> bool:
    try:
        return bool(operations.run_once(worker_id))
    except Exception as exc:
        try:
            operations.record_degraded(worker_id, exc)
        except Exception:
            pass
        return False

def main():
    worker_id=os.getenv("MAIL_DELIVERY_WORKER_ID") or f"mail-worker-{uuid4().hex[:8]}"
    interval=max(1,int(os.getenv("MAIL_DELIVERY_POLL_SECONDS","5")))
    sender_sync_interval=max(30,int(os.getenv("OCI_SENDER_SYNC_SECONDS","300")))
    next_sender_sync=0.0
    operations=MailDeliveryOperations()
    while True:
        now=time.monotonic()
        if now >= next_sender_sync:
            run_oci_sender_sync_once(db=operations.db)
            run_oci_sender_outbox_once(db=operations.db)
            next_sender_sync=now+sender_sync_interval
        worked=run_worker_iteration(operations,worker_id)
        if not worked: time.sleep(interval)

if __name__=="__main__":
    main()
