from __future__ import annotations

from app.services.outbound_provider_resolver import OutboundProviderResolver

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from secrets import compare_digest
import smtplib
import ssl
from uuid import uuid4

from app.core.config import settings
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.mail_daily_send_quota import MailDailySendQuota
from app.services.mail_delivery_service import MailDeliveryWorker, SmtpRelayAdapter, mask_delivery_error
from app.services.mail_transports import (
    MailProviderRoutingAdapter,
    OciEmailDeliveryTransport,
    SelfHostedSmtpTransport,
    resolve_mx_hosts,
)
from app.services.postgres_service import PostgresService
from app.services.resource_policy import ResourceNotFoundError
from app.services.security_service import SecurityService

_CONNECTION_FIELDS = {
    "providerType": "provider_type", "relayHost": "relay_host", "relayPort": "relay_port",
    "tlsMode": "tls_mode", "fromAddress": "from_address", "username": "username",
}


def deterministic_quota_jitter(queue_id: str, maximum_seconds: int = 300) -> int:
    digest = sha256(queue_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % (maximum_seconds + 1)

def prepare_provider_update(current: dict, values: dict, encrypt_secret) -> dict:
    connection_changed = False
    updates: dict = {}
    for api_name, column in _CONNECTION_FIELDS.items():
        if api_name not in values:
            continue
        value = values[api_name]
        updates[column] = value
        if value != current.get(column):
            connection_changed = True
    if "password" in values and values["password"]:
        updates["encrypted_password"] = encrypt_secret(values["password"])
        connection_changed = True
    if connection_changed and values.get("deliveryEnabled") is True:
        raise ValueError("연결 설정 변경과 외부 발송 잠금 해제를 같은 요청에서 수행할 수 없습니다.")
    if values.get("deliveryEnabled") is True and current.get("last_test_status") != "success":
        raise ValueError("실제 연결 테스트 성공 후 외부 발송 잠금을 해제할 수 있습니다.")
    if connection_changed:
        updates.update({
            "delivery_enabled": False, "last_test_status": "untested",
            "last_test_message": "연결 설정 변경 후 재검증이 필요합니다.",
            "last_connection_at": None, "last_connection_error": None,
        })
    elif "deliveryEnabled" in values:
        updates["delivery_enabled"] = values["deliveryEnabled"]
    return updates

class MailDeliveryOperations:
    def __init__(self, db=None, adapter=None, storage=None, quota=None):
        self.db = db or PostgresService()
        self.adapter = adapter or MailProviderRoutingAdapter(
            self_hosted_transport=SelfHostedSmtpTransport(mx_resolver=resolve_mx_hosts),
            oci_transport=OciEmailDeliveryTransport(),
            legacy_relay_adapter=SmtpRelayAdapter(),
        )
        self.storage = storage or MailAttachmentStorage()
        self.security = SecurityService()
        self.quota = quota or MailDailySendQuota(
            self.db,
            limit=settings.mail_engine_daily_send_limit,
        )

    @staticmethod
    def _id(prefix): return f"{prefix}_{uuid4().hex}"

    def get_status(self, actor):
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._provider(cursor, actor.companyId)
                cursor.execute("SELECT status,COUNT(*) AS count FROM mail_delivery_queue WHERE company_id=%s GROUP BY status", (actor.companyId,))
                summary = {row["status"]: int(row["count"]) for row in cursor.fetchall()}
                cursor.execute("SELECT worker_id,status,last_heartbeat_at,last_success_at,last_error FROM mail_delivery_worker_heartbeats ORDER BY last_heartbeat_at DESC LIMIT 1")
                worker = cursor.fetchone() or {}
        return {"provider": self._provider_view(provider), "worker": dict(worker), "summary": summary}

    def get_user_status(self, actor):
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = OutboundProviderResolver.readiness(cursor, actor.companyId)
        if provider is None:
            provider = {"delivery_enabled": False, "last_test_status": "untested"}
        return {
            "provider": {
                "enabled": bool(provider["delivery_enabled"]),
                "lastTestStatus": provider["last_test_status"],
            }
        }

    def list_queue(self, actor, status=None, limit=100, offset=0):
        clauses, params = ["q.company_id=%s"], [actor.companyId]
        if status:
            clauses.append("q.status=%s"); params.append(status)
        params.extend([limit, offset])
        sql = f"""SELECT q.id AS queue_id,q.mail_id,r.recipient_email,m.subject,q.status,q.attempt_count,
        q.next_attempt_at,q.lease_expires_at,q.created_at,COUNT(*) OVER() AS total
        FROM mail_delivery_queue q JOIN mail_messages m ON m.id=q.mail_id
        JOIN mail_recipients r ON r.id=q.recipient_id WHERE {' AND '.join(clauses)}
        ORDER BY q.created_at DESC LIMIT %s OFFSET %s"""
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, tuple(params)); rows = cursor.fetchall()
        return {"items": [self._queue_view(row) for row in rows], "total": int(rows[0]["total"]) if rows else 0}

    def queue_detail(self, actor, queue_id):
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""SELECT q.id AS queue_id,q.mail_id,r.recipient_email,m.subject,q.status,q.attempt_count,
                q.next_attempt_at,q.lease_expires_at,q.created_at FROM mail_delivery_queue q
                JOIN mail_messages m ON m.id=q.mail_id JOIN mail_recipients r ON r.id=q.recipient_id
                WHERE q.id=%s AND q.company_id=%s""", (queue_id, actor.companyId))
                row = cursor.fetchone()
                if row is None: raise ResourceNotFoundError("외부 전달 큐를 찾을 수 없습니다.")
                cursor.execute("SELECT attempt_number,result,error_message,relay_response,started_at,finished_at FROM mail_delivery_attempts WHERE queue_id=%s ORDER BY attempt_number DESC", (queue_id,))
                attempts = cursor.fetchall()
                cursor.execute("SELECT event,status_before,status_after,reason,created_at FROM audit_logs WHERE company_id=%s AND target_type='mail_delivery_queue' AND target_id=%s ORDER BY created_at DESC LIMIT 50", (actor.companyId, queue_id))
                audits = cursor.fetchall()
        return {
            "item": self._queue_view(row),
            "attempts": [{"attemptNumber": x["attempt_number"], "result": x["result"], "errorMessage": x["error_message"],
                          "relayResponse": x["relay_response"], "startedAt": x["started_at"], "finishedAt": x["finished_at"]} for x in attempts],
            "audits": [dict(x) for x in audits],
        }

    def retry(self, actor, queue_id):
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""UPDATE mail_delivery_queue SET status='queued',next_attempt_at=%s,lease_expires_at=NULL,
                worker_id=NULL,updated_at=%s WHERE id=%s AND company_id=%s
                AND status IN ('failed','blocked','retry_pending') RETURNING id""", (now, now, queue_id, actor.companyId))
                if cursor.fetchone() is None: raise ValueError("재시도할 수 없는 큐 상태입니다.")
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "mail_delivery_queue", queue_id,
                            "mail.delivery.retry.requested", None, "queued", now)
            connection.commit()
        return self.queue_detail(actor, queue_id)

    def update_provider(self, actor, payload):
        values = payload.model_dump(exclude_none=True)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                current = self._provider(cursor, actor.companyId)
                updates = prepare_provider_update(current, values, self.security.encrypt_secret)
                if not updates:
                    return self._provider_view(current)
                assignments, params = [], []
                for column, value in updates.items():
                    assignments.append(f"{column}=%s"); params.append(value)
                params.extend([datetime.now(UTC), current["id"], actor.companyId])
                cursor.execute(f"UPDATE mail_provider_configs SET {','.join(assignments)},updated_at=%s WHERE id=%s AND company_id=%s RETURNING *", tuple(params))
                provider = cursor.fetchone()
                if provider is None: raise ValueError("메일 provider를 찾을 수 없습니다.")
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "mail_provider_config", provider["id"],
                            "mail.delivery.provider.updated", None, "locked" if not provider["delivery_enabled"] else "enabled", datetime.now(UTC))
            connection.commit()
        return self._provider_view(provider)

    def test_provider(self, actor, timeout_seconds=10):
        now, error = datetime.now(UTC), None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._provider(cursor, actor.companyId)
                try:
                    host, port, mode = provider["relay_host"], int(provider["relay_port"]), provider["tls_mode"]
                    password = self.security.decrypt_secret(provider["encrypted_password"]) if provider["username"] else ""
                    client_class = smtplib.SMTP_SSL if mode == "tls" else smtplib.SMTP
                    if mode == "tls":
                        client = client_class(host, port, timeout=timeout_seconds, context=ssl.create_default_context())
                    else:
                        client = client_class(host, port, timeout=timeout_seconds)
                    with client:
                        client.ehlo()
                        if mode == "starttls":
                            client.starttls(context=ssl.create_default_context()); client.ehlo()
                        if provider["username"]: client.login(provider["username"], password)
                    test_status = "success"
                except Exception as exc:
                    test_status, error = "failed", mask_delivery_error(str(exc))
                cursor.execute("""UPDATE mail_provider_configs SET last_test_status=%s,last_test_message=%s,
                last_connection_at=%s,last_connection_error=%s,updated_at=%s WHERE id=%s""",
                (test_status, "TCP/EHLO/TLS/auth 연결 검증 완료" if test_status == "success" else "연결 검증 실패", now, error, now, provider["id"]))
                self._audit(cursor, actor.companyId, actor.userId, actor.userName, "mail_provider_config", provider["id"],
                            "mail.delivery.provider.tested", None, test_status, now)
            connection.commit()
        return self.get_status(actor)["provider"]

    def claim_next(self, worker_id):
        self.db.ensure_migrations_applied()
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self.heartbeat(cursor, worker_id, "working", now)
                cursor.execute("""SELECT q.id AS queue_id,q.attempt_count,q.company_id,q.provider_config_id,q.mail_id,q.recipient_id,
                q.delivery_kind,q.sender_email_override,q.sender_display_name_override,q.reply_to_email_override,
                m.raw_storage_key,m.raw_sha256,m.raw_size,
                r.recipient_email,m.sender_user_id,m.sender_email,m.sender_display_name,m.reply_to_email,m.message_encoding,m.subject,m.body_text,m.body_html,
                EXISTS(SELECT 1 FROM mail_oci_suppressions s WHERE s.company_id=q.company_id
                    AND LOWER(s.recipient_email)=LOWER(r.recipient_email) AND s.active=TRUE) AS recipient_suppressed
                FROM mail_delivery_queue q JOIN mail_messages m ON m.id=q.mail_id
                JOIN mail_recipients r ON r.id=q.recipient_id
                WHERE (q.status IN ('queued','retry_pending') AND COALESCE(q.next_attempt_at,q.created_at)<=%s)
                   OR (q.status='processing' AND q.lease_expires_at<%s)
                ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT 1""", (now, now))
                job = cursor.fetchone()
                if job is None:
                    self.heartbeat(cursor, worker_id, "idle", now)
                    connection.commit()
                    return None
                cursor.execute("""UPDATE mail_delivery_queue SET status='processing',worker_id=%s,lease_expires_at=%s,updated_at=%s
                WHERE id=%s RETURNING id""", (worker_id, now + timedelta(minutes=2), now, job["queue_id"]))
                cursor.fetchone()
                cursor.execute(
                    """SELECT file_name,content_type,size_bytes,storage_key,content_disposition,content_id
                    FROM mail_attachments
                    WHERE message_id=%s AND storage_key IS NOT NULL
                    ORDER BY created_at ASC""",
                    (job["mail_id"],),
                )
                job = dict(job)
                job["attachments"] = [
                    self._queue_attachment(
                        row,
                        expected_company_id=job["company_id"],
                        expected_user_id=job["sender_user_id"],
                    )
                    for row in cursor.fetchall() if job.get('delivery_kind') != 'submission'
                ]
                provider = self._provider_by_id(cursor, job["provider_config_id"], job["company_id"])
                provider["password"] = self.security.decrypt_secret(provider["encrypted_password"]) if provider["username"] else ""
                provider["dkim_private_key"] = self.security.decrypt_secret(provider["encrypted_dkim_private_key"]) if provider.get("encrypted_dkim_private_key") else ""
            connection.commit()
        return job, provider

    def _queue_attachment(
        self,
        row: dict,
        *,
        expected_company_id: str,
        expected_user_id: str,
    ) -> dict:
        path = self.storage.stored_path(row["storage_key"])
        digest = sha256()
        with path.open("rb") as attachment_file:
            for chunk in iter(lambda: attachment_file.read(1024 * 1024), b""):
                digest.update(chunk)
        content_sha256 = digest.hexdigest()
        actual_size = path.stat().st_size
        if actual_size != int(row["size_bytes"]):
            raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.")

        disposition = row.get("content_disposition") or "attachment"
        content_id = row.get("content_id")
        if disposition not in {"attachment", "inline"}:
            raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.")
        if (disposition == "attachment" and content_id is not None) or (
            disposition == "inline" and (not isinstance(content_id, str) or not content_id)
        ):
            raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.")

        try:
            upload_id = self.storage._upload_id_from_storage_key(row["storage_key"])
        except ValueError:
            if disposition != "attachment":
                raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.")
            return {
                "file_name": row["file_name"],
                "content_type": row["content_type"],
                "path": str(path),
                "size_bytes": actual_size,
                "content_disposition": "attachment",
                "content_id": None,
                "sha256": content_sha256,
            }

        try:
            metadata = self.storage._load_metadata(upload_id)
            canonical_content_type = metadata.get("normalized_content_type", metadata["contentType"])
            canonical_size = int(metadata.get("normalized_size_bytes", metadata["sizeBytes"]))
            canonical_disposition = metadata.get("content_disposition", "attachment")
            expected_sha256 = metadata.get("sha256")
            canonical = (
                metadata["fileName"],
                canonical_content_type,
                canonical_size,
                metadata["storageKey"],
                canonical_disposition,
                metadata.get("content_id"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.") from exc
        persisted = (
            row["file_name"],
            row["content_type"],
            int(row["size_bytes"]),
            row["storage_key"],
            disposition,
            content_id,
        )
        if (
            canonical != persisted
            or metadata.get("ownerCompanyId") != expected_company_id
            or metadata.get("ownerUserId") != expected_user_id
            or metadata.get("attached") is not True
            or (
                canonical_disposition == "inline"
                and not isinstance(expected_sha256, str)
            )
            or (
                expected_sha256 is not None
                and (
                    not isinstance(expected_sha256, str)
                    or not compare_digest(expected_sha256, content_sha256)
                )
            )
        ):
            raise ValueError("메일 첨부 저장 상태가 올바르지 않습니다.")
        return {
            "file_name": metadata["fileName"],
            "content_type": canonical_content_type,
            "path": str(path),
            "size_bytes": canonical_size,
            "content_disposition": canonical_disposition,
            "content_id": metadata.get("content_id"),
            "sha256": content_sha256,
        }

    def finalize_claim(self, worker_id, job, result):
        now, attempt = datetime.now(UTC), int(job["attempt_count"]) + 1
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""UPDATE mail_delivery_queue SET status=%s,attempt_count=%s,next_attempt_at=%s,
                lease_expires_at=NULL,last_error=%s,accepted_at=CASE WHEN %s='sent' THEN %s ELSE accepted_at END,
                sent_at=CASE WHEN %s='sent' THEN %s ELSE sent_at END,updated_at=%s
                WHERE id=%s AND worker_id=%s AND status='processing' RETURNING id""",
                (result.status, attempt, result.next_attempt_at, result.error_message, result.status, now,
                 result.status, now, now, job["queue_id"], worker_id))
                if cursor.fetchone() is None:
                    connection.rollback()
                    return False
                cursor.execute("""INSERT INTO mail_delivery_attempts(
                    id,queue_id,attempt_number,result,error_message,relay_response,started_at,finished_at
                ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                (self._id("attempt"), job["queue_id"], attempt, result.status, result.error_message,
                 result.relay_response, now, datetime.now(UTC)))
                cursor.execute("""UPDATE mail_auto_forward_deliveries SET status=%s,reason_code=%s,updated_at=%s,
                    completed_at=CASE WHEN %s='sent' THEN %s ELSE completed_at END
                    WHERE delivery_queue_id=%s RETURNING origin_recipient_id""",
                    (result.status, f"WORKER_{result.status.upper()}", now, result.status, now, job["queue_id"]))
                forwarded = cursor.fetchone()
                if forwarded:
                    from app.services.mail_auto_forwarding_service import MailAutoForwardingService
                    MailAutoForwardingService.reconcile_original_retention(cursor, forwarded["origin_recipient_id"], now)
                cursor.execute("""UPDATE mail_out_of_office_deliveries SET status=%s,reason_code=%s,updated_at=%s,
                    completed_at=CASE WHEN %s='sent' THEN %s ELSE completed_at END
                    WHERE delivery_queue_id=%s""",
                    (result.status, f"WORKER_{result.status.upper()}", now, result.status, now, job["queue_id"]))
                self._audit(cursor, job["company_id"], None, "mail-worker", "mail_delivery_queue", job["queue_id"],
                            f"mail.delivery.{result.status}", "processing", result.status, now)
                self.heartbeat(cursor, worker_id, "idle", datetime.now(UTC), last_success=result.status == "sent", error=result.error_message)
            connection.commit()
        return True

    def defer_claim_for_quota(self, worker_id, job, code, reset_at):
        now = datetime.now(UTC)
        next_attempt_at = reset_at + timedelta(
            seconds=deterministic_quota_jitter(str(job["queue_id"]))
        )
        event = (
            "mail.delivery.daily_limit_deferred"
            if code == "MAIL_DAILY_SEND_LIMIT_EXCEEDED"
            else "mail.delivery.daily_quota_unavailable"
        )
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE mail_delivery_queue
                    SET status='retry_pending',next_attempt_at=%s,lease_expires_at=NULL,
                        worker_id=NULL,last_error=%s,updated_at=%s
                    WHERE id=%s AND worker_id=%s AND status='processing'
                    RETURNING id""",
                    (next_attempt_at, code, now, job["queue_id"], worker_id),
                )
                if cursor.fetchone() is None:
                    return False
                self._audit(
                    cursor,
                    job["company_id"],
                    None,
                    "mail-worker",
                    "mail_delivery_queue",
                    job["queue_id"],
                    event,
                    "processing",
                    "retry_pending",
                    now,
                )
                self.heartbeat(cursor, worker_id, "idle", datetime.now(UTC), error=code)
            connection.commit()
        return True

    def run_once(self, worker_id):
        claimed = self.claim_next(worker_id)
        if claimed is None: return False
        job, provider = claimed
        try:
            result = MailDeliveryWorker(
                worker_id,
                self.adapter,
                quota=getattr(self, "quota", None),
            ).deliver_claimed(job, provider)
        except Exception as exc:
            self.record_degraded(worker_id, exc)
            return False
        if result.status == "quota_deferred":
            return self.defer_claim_for_quota(
                worker_id,
                job,
                result.error_message,
                result.next_attempt_at,
            )
        return self.finalize_claim(worker_id, job, result)

    def record_degraded(self, worker_id, error):
        now = datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self.heartbeat(cursor, worker_id, "degraded", now, error=mask_delivery_error(str(error)))
            connection.commit()

    def heartbeat(self, cursor, worker_id, status, now, last_success=False, error=None):
        cursor.execute("""INSERT INTO mail_delivery_worker_heartbeats(
            worker_id,status,last_heartbeat_at,last_success_at,last_error,updated_at
        ) VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(worker_id) DO UPDATE SET status=EXCLUDED.status,
        last_heartbeat_at=EXCLUDED.last_heartbeat_at,last_success_at=COALESCE(EXCLUDED.last_success_at,
        mail_delivery_worker_heartbeats.last_success_at),last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at""",
        (worker_id, status, now, now if last_success else None, error, now))

    def _provider(self, cursor, company_id):
        return OutboundProviderResolver.resolve(cursor, company_id)

    def _provider_by_id(self, cursor, provider_id, company_id):
        cursor.execute("SELECT * FROM mail_provider_configs WHERE id=%s AND company_id=%s", (provider_id, company_id))
        row = cursor.fetchone()
        if row is None: raise ValueError("메일 provider를 찾을 수 없습니다.")
        return dict(row)

    @staticmethod
    def _provider_view(p):
        return {"providerId": p["id"], "providerType": p["provider_type"], "relayHost": p["relay_host"],
                "relayPort": p["relay_port"], "tlsMode": p.get("tls_mode", "starttls"), "fromAddress": p.get("from_address"),
                "deliveryEnabled": p.get("delivery_enabled", False), "lastTestStatus": p["last_test_status"],
                "lastConnectionAt": p.get("last_connection_at"), "lastConnectionError": p.get("last_connection_error")}

    @staticmethod
    def _queue_view(row):
        return {"queueId": row["queue_id"], "mailId": row["mail_id"], "recipientEmail": row["recipient_email"],
                "subject": row["subject"], "status": row["status"], "attemptCount": row["attempt_count"],
                "nextAttemptAt": row["next_attempt_at"], "leaseExpiresAt": row["lease_expires_at"], "createdAt": row["created_at"]}

    def _audit(self, cursor, company_id, user_id, user_name, target_type, target_id, event, before, after, now):
        cursor.execute("""INSERT INTO audit_logs(
            id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at
        ) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (self._id("audit"), company_id, user_id, user_name, target_type, target_id, event, before, after,
         "UI-021 mail delivery lifecycle", now))
