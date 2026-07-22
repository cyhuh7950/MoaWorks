from __future__ import annotations
from datetime import UTC, datetime, timedelta
import smtplib
import ssl
from uuid import uuid4

from app.services.mail_delivery_service import MailDeliveryWorker, SmtpRelayAdapter, mask_delivery_error
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService

class MailDeliveryOperations:
    def __init__(self, db=None):
        self.db = db or PostgresService()
        self.security = SecurityService()

    @staticmethod
    def _id(prefix): return f"{prefix}_{uuid4().hex}"

    def get_status(self, actor):
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider = self._provider(cursor, actor.companyId)
                cursor.execute("SELECT status, COUNT(*) AS count FROM mail_delivery_queue WHERE company_id=%s GROUP BY status",(actor.companyId,))
                summary={row["status"]:int(row["count"]) for row in cursor.fetchall()}
                cursor.execute("SELECT worker_id,status,last_heartbeat_at,last_success_at,last_error FROM mail_delivery_worker_heartbeats ORDER BY last_heartbeat_at DESC LIMIT 1")
                worker=cursor.fetchone() or {}
        return {"provider":self._provider_view(provider),"worker":dict(worker),"summary":summary}

    def list_queue(self, actor, status=None, limit=100, offset=0):
        self.db.ensure_migrations_applied()
        clauses=["q.company_id=%s"]; params=[actor.companyId]
        if status: clauses.append("q.status=%s"); params.append(status)
        params.extend([limit,offset])
        sql=f"""SELECT q.id AS queue_id,q.mail_id,r.recipient_email,m.subject,q.status,q.attempt_count,q.next_attempt_at,q.lease_expires_at,q.created_at,
        COUNT(*) OVER() AS total FROM mail_delivery_queue q JOIN mail_messages m ON m.id=q.mail_id JOIN mail_recipients r ON r.id=q.recipient_id
        WHERE {' AND '.join(clauses)} ORDER BY q.created_at DESC LIMIT %s OFFSET %s"""
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql,tuple(params)); rows=cursor.fetchall()
        return {"items":[self._queue_view(row) for row in rows],"total":int(rows[0]["total"]) if rows else 0}

    def queue_detail(self, actor, queue_id):
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""SELECT q.id AS queue_id,q.mail_id,r.recipient_email,m.subject,q.status,q.attempt_count,q.next_attempt_at,q.lease_expires_at,q.created_at
                FROM mail_delivery_queue q JOIN mail_messages m ON m.id=q.mail_id JOIN mail_recipients r ON r.id=q.recipient_id
                WHERE q.id=%s AND q.company_id=%s""",(queue_id,actor.companyId)); row=cursor.fetchone()
                if row is None: raise PermissionError("외부 전달 큐에 접근할 권한이 없습니다.")
                cursor.execute("SELECT attempt_number,result,error_message,relay_response,started_at,finished_at FROM mail_delivery_attempts WHERE queue_id=%s ORDER BY attempt_number DESC",(queue_id,)); attempts=cursor.fetchall()
                cursor.execute("SELECT event,status_before,status_after,reason,created_at FROM audit_logs WHERE company_id=%s AND target_type='mail_delivery_queue' AND target_id=%s ORDER BY created_at DESC LIMIT 50",(actor.companyId,queue_id)); audits=cursor.fetchall()
        return {"item":self._queue_view(row),"attempts":[{"attemptNumber":x["attempt_number"],"result":x["result"],"errorMessage":x["error_message"],"relayResponse":x["relay_response"],"startedAt":x["started_at"],"finishedAt":x["finished_at"]} for x in attempts],"audits":[dict(x) for x in audits]}

    def retry(self, actor, queue_id):
        now=datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("UPDATE mail_delivery_queue SET status='queued',next_attempt_at=%s,lease_expires_at=NULL,worker_id=NULL,updated_at=%s WHERE id=%s AND company_id=%s AND status IN ('failed','blocked','retry_pending') RETURNING id",(now,now,queue_id,actor.companyId))
                if cursor.fetchone() is None: raise ValueError("재시도할 수 없는 큐 상태입니다.")
                self._audit(cursor,actor.companyId,actor.userId,actor.userName,queue_id,"mail.delivery.retry.requested",None,"queued",now)
            connection.commit()
        return self.queue_detail(actor,queue_id)

    def update_provider(self, actor, payload):
        values=payload.model_dump(exclude_none=True)
        mapping={"deliveryEnabled":"delivery_enabled","providerType":"provider_type","relayHost":"relay_host","relayPort":"relay_port","tlsMode":"tls_mode","fromAddress":"from_address"}
        if not values: return self.get_status(actor)["provider"]
        assignments=[]; params=[]
        for key,value in values.items(): assignments.append(f"{mapping[key]}=%s"); params.append(value)
        params.extend([datetime.now(UTC),actor.companyId])
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                current = self._provider(cursor, actor.companyId)
                if values.get("deliveryEnabled") is True and current["last_test_status"] != "success":
                    raise ValueError("실제 연결 테스트 성공 후 외부 발송 잠금을 해제할 수 있습니다.")
                cursor.execute(f"UPDATE mail_provider_configs SET {','.join(assignments)},updated_at=%s WHERE company_id=%s RETURNING *",tuple(params)); provider=cursor.fetchone()
                if provider is None: raise ValueError("메일 provider를 찾을 수 없습니다.")
                self._audit(cursor,actor.companyId,actor.userId,actor.userName,provider["id"],"mail.delivery.provider.updated",None,"locked" if not provider["delivery_enabled"] else "enabled",datetime.now(UTC))
            connection.commit()
        return self._provider_view(provider)

    def test_provider(self, actor, timeout_seconds=10):
        now=datetime.now(UTC); error=None
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                provider=self._provider(cursor,actor.companyId)
                try:
                    host,port=provider["relay_host"],int(provider["relay_port"]); mode=provider["tls_mode"]
                    if mode=="tls":
                        with smtplib.SMTP_SSL(host,port,timeout=timeout_seconds,context=ssl.create_default_context()) as client: client.ehlo()
                    else:
                        with smtplib.SMTP(host,port,timeout=timeout_seconds) as client:
                            client.ehlo()
                            if mode=="starttls": client.starttls(context=ssl.create_default_context()); client.ehlo()
                            if provider["username"]: client.login(provider["username"],self.security.decrypt_secret(provider["encrypted_password"]))
                    status="success"
                except Exception as exc:
                    status="failed"; error=mask_delivery_error(str(exc))
                cursor.execute("UPDATE mail_provider_configs SET last_test_status=%s,last_test_message=%s,last_connection_at=%s,last_connection_error=%s,updated_at=%s WHERE id=%s",(status,"TCP/EHLO/TLS/auth 연결 검증 완료" if status=="success" else "연결 검증 실패",now,error,now,provider["id"]))
                self._audit(cursor,actor.companyId,actor.userId,actor.userName,provider["id"],"mail.delivery.provider.tested",None,status,now)
            connection.commit()
        return self.get_status(actor)["provider"]

    def run_once(self, worker_id):
        self.db.ensure_migrations_applied(); now=datetime.now(UTC)
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                self.heartbeat(cursor,worker_id,"working",now)
                cursor.execute("""SELECT q.id AS queue_id,q.attempt_count,q.company_id,q.provider_config_id,q.mail_id,q.recipient_id,
                r.recipient_email,m.sender_email,m.subject,m.body_text,m.body_html
                FROM mail_delivery_queue q JOIN mail_messages m ON m.id=q.mail_id JOIN mail_recipients r ON r.id=q.recipient_id
                WHERE (q.status IN ('queued','retry_pending') AND COALESCE(q.next_attempt_at,q.created_at)<=%s)
                   OR (q.status='processing' AND q.lease_expires_at<%s)
                ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT 1""",(now,now)); job=cursor.fetchone()
                if job is None:
                    self.heartbeat(cursor,worker_id,"idle",now); connection.commit(); return False
                cursor.execute("UPDATE mail_delivery_queue SET status='processing',worker_id=%s,lease_expires_at=%s,updated_at=%s WHERE id=%s",(worker_id,now+timedelta(minutes=2),now,job["queue_id"]))
                cursor.execute("SELECT file_name,content_type,storage_key FROM mail_attachments WHERE message_id=%s AND storage_key IS NOT NULL",(job["mail_id"],))
                storage=MailAttachmentStorage(); job=dict(job); job["attachments"]=[{"file_name":a["file_name"],"content_type":a["content_type"],"path":str(storage.stored_path(a["storage_key"]))} for a in cursor.fetchall()]
                provider=self._provider_by_id(cursor,job["provider_config_id"],job["company_id"])
                provider["password"]=self.security.decrypt_secret(provider["encrypted_password"]) if provider["username"] else ""
                result=MailDeliveryWorker(worker_id,SmtpRelayAdapter()).deliver_claimed(job,provider)
                attempt=int(job["attempt_count"])+1
                cursor.execute("""UPDATE mail_delivery_queue SET status=%s,attempt_count=%s,next_attempt_at=%s,lease_expires_at=NULL,
                last_error=%s,accepted_at=CASE WHEN %s='sent' THEN %s ELSE accepted_at END,sent_at=CASE WHEN %s='sent' THEN %s ELSE sent_at END,updated_at=%s WHERE id=%s""",
                (result.status,attempt,result.next_attempt_at,result.error_message,result.status,now,result.status,now,now,job["queue_id"]))
                cursor.execute("INSERT INTO mail_delivery_attempts(id,queue_id,attempt_number,result,error_message,relay_response,started_at,finished_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",(self._id("attempt"),job["queue_id"],attempt,result.status,result.error_message,result.relay_response,now,datetime.now(UTC)))
                self._audit(cursor,job["company_id"],None,"mail-worker",job["queue_id"],f"mail.delivery.{result.status}","processing",result.status,now)
                self.heartbeat(cursor,worker_id,"idle",datetime.now(UTC),last_success=result.status=="sent",error=result.error_message)
            connection.commit()
        return True

    def heartbeat(self,cursor,worker_id,status,now,last_success=False,error=None):
        cursor.execute("""INSERT INTO mail_delivery_worker_heartbeats(worker_id,status,last_heartbeat_at,last_success_at,last_error,updated_at)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(worker_id) DO UPDATE SET status=EXCLUDED.status,last_heartbeat_at=EXCLUDED.last_heartbeat_at,
        last_success_at=COALESCE(EXCLUDED.last_success_at,mail_delivery_worker_heartbeats.last_success_at),last_error=EXCLUDED.last_error,updated_at=EXCLUDED.updated_at""",
        (worker_id,status,now,now if last_success else None,error,now))

    def _provider(self,cursor,company_id):
        cursor.execute("SELECT * FROM mail_provider_configs WHERE company_id=%s ORDER BY active DESC,updated_at DESC LIMIT 1",(company_id,)); row=cursor.fetchone()
        if row is None: raise ValueError("메일 provider를 찾을 수 없습니다.")
        return dict(row)
    def _provider_by_id(self,cursor,provider_id,company_id):
        cursor.execute("SELECT * FROM mail_provider_configs WHERE id=%s AND company_id=%s",(provider_id,company_id)); row=cursor.fetchone()
        if row is None: raise ValueError("메일 provider를 찾을 수 없습니다.")
        return dict(row)
    @staticmethod
    def _provider_view(p): return {"providerId":p["id"],"providerType":p["provider_type"],"relayHost":p["relay_host"],"relayPort":p["relay_port"],"tlsMode":p.get("tls_mode","starttls"),"fromAddress":p.get("from_address"),"deliveryEnabled":p.get("delivery_enabled",False),"lastTestStatus":p["last_test_status"],"lastConnectionAt":p.get("last_connection_at"),"lastConnectionError":p.get("last_connection_error")}
    @staticmethod
    def _queue_view(r): return {"queueId":r["queue_id"],"mailId":r["mail_id"],"recipientEmail":r["recipient_email"],"subject":r["subject"],"status":r["status"],"attemptCount":r["attempt_count"],"nextAttemptAt":r["next_attempt_at"],"leaseExpiresAt":r["lease_expires_at"],"createdAt":r["created_at"]}
    def _audit(self,cursor,company_id,user_id,user_name,target_id,event,before,after,now):
        cursor.execute("INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,'mail_delivery_queue',%s,%s,%s,%s,%s,%s)",(self._id("audit"),company_id,user_id,user_name,target_id,event,before,after,"UI-021 mail delivery lifecycle",now))
