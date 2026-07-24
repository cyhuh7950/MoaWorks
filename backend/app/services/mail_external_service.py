from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
import ipaddress
import os
import re
import socket
import ssl
import poplib
import uuid
from psycopg import Error as PsycopgError

from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService


class ExternalMailError(RuntimeError): pass
class ExternalMailInvalidEndpointError(ValueError): pass
class ExternalMailSecretRequiredError(ValueError): pass
class ExternalMailRateLimitedError(ExternalMailError): pass
class ExternalMailConflictError(ExternalMailError): pass
class ExternalMailLimitError(ExternalMailError): pass
class ExternalMailTestRequiredError(ExternalMailError): pass
class ExternalMailCollectionBusyError(ExternalMailError): pass
class ExternalMailNotFoundError(FileNotFoundError): pass
class ExternalMailForbiddenError(PermissionError): pass
class ExternalLeaseLostError(ExternalMailError): pass


@dataclass(frozen=True)
class RemoteDeleteState:
    @staticmethod
    def after_quit(uidls: list[str], quit_ok: bool) -> dict[str, tuple[str, str | None]]:
        state = ("deleted", None) if quit_ok else ("failed", "MAIL_EXTERNAL_QUIT_FAILED")
        return {uidl: state for uidl in uidls}


class ExternalCollectionSafety:
    def __init__(self, *, job_seconds: int = 300, command_seconds: int = 20, raw_limit: int = 25 * 1024 * 1024):
        self.job_seconds = job_seconds; self.command_seconds = command_seconds; self.raw_limit = raw_limit
    @staticmethod
    def uidl_action(status: str | None, delete_enabled: bool) -> str:
        if status in {"pending", "failed"}: return "delete_only" if delete_enabled else "duplicate"
        return "duplicate" if status else "import"
    @staticmethod
    def assert_lease(heartbeat) -> None:
        if not heartbeat(): raise ExternalLeaseLostError("MAIL_EXTERNAL_LEASE_LOST")
    def assert_deadline(self, elapsed_seconds: float) -> None:
        if elapsed_seconds > self.job_seconds: raise TimeoutError("MAIL_EXTERNAL_JOB_TIMEOUT")
    def assert_retr_size(self, size_bytes: int) -> None:
        if size_bytes > self.raw_limit: raise ValueError("MAIL_EXTERNAL_MESSAGE_TOO_LARGE")


class MailExternalEndpointValidator:
    def __init__(self, resolver=None):
        self.resolver = resolver or self._resolve

    @staticmethod
    def _resolve(host: str) -> list[str]:
        return sorted({item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)})

    def validate_syntax(self, host: str, port: int, tls_mode: str) -> str:
        value = str(host).strip().lower().rstrip(".")
        if not value or len(value) > 253 or "://" in value or any(ord(c) < 33 for c in value):
            raise ExternalMailInvalidEndpointError("외부메일 서버 주소를 확인해 주세요.")
        if value == "localhost" or value.endswith(".local"):
            raise ExternalMailInvalidEndpointError("외부메일 서버 주소를 확인해 주세요.")
        try:
            ipaddress.ip_address(value)
            raise ExternalMailInvalidEndpointError("IP 주소는 사용할 수 없습니다.")
        except ValueError as exc:
            if isinstance(exc, ExternalMailInvalidEndpointError): raise
        if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", value):
            raise ExternalMailInvalidEndpointError("외부메일 서버 주소를 확인해 주세요.")
        if (tls_mode, int(port)) not in {("ssl", 995), ("starttls", 110)}:
            raise ExternalMailInvalidEndpointError("허용된 보안 연결과 포트를 선택해 주세요.")
        return value

    def validate(self, host: str, port: int, tls_mode: str) -> str:
        value, _ = self.validate_target(host, port, tls_mode)
        return value

    def validate_target(self, host: str, port: int, tls_mode: str) -> tuple[str, tuple[str, ...]]:
        value = self.validate_syntax(host, port, tls_mode)
        try: addresses = self.resolver(value)
        except Exception as exc: raise ExternalMailInvalidEndpointError("외부메일 서버를 확인할 수 없습니다.") from exc
        if not addresses:
            raise ExternalMailInvalidEndpointError("외부메일 서버를 확인할 수 없습니다.")
        for address in addresses:
            try: parsed = ipaddress.ip_address(address)
            except ValueError as exc: raise ExternalMailInvalidEndpointError("외부메일 서버 주소를 확인해 주세요.") from exc
            if not parsed.is_global:
                raise ExternalMailInvalidEndpointError("공용 외부메일 서버만 사용할 수 있습니다.")
        return value, tuple(sorted(addresses))


class MailExternalPop3Client:
    def __init__(self, factory=None, validator=None):
        self.factory = factory
        self.validator = validator or MailExternalEndpointValidator()

    def _connect(self, host: str, port: int, tls_mode: str, addresses: tuple[str, ...] | None = None):
        context = ssl.create_default_context()
        target = (addresses or (host,))[0]
        if self.factory: return self.factory(host, port, tls_mode, tuple(addresses or (host,)), host)
        if tls_mode == "ssl":
            class BoundPOP3SSL(poplib.POP3_SSL):
                def _create_socket(self, timeout):
                    raw = socket.create_connection((target, port), timeout)
                    return context.wrap_socket(raw, server_hostname=host)
            return BoundPOP3SSL(host, port, timeout=10, context=context)
        client = poplib.POP3(target, port, timeout=10); client.host = host; client.stls(context=context); return client

    def test(self, host: str, port: int, tls_mode: str, username: str, password: str) -> str:
        host, addresses = self.validator.validate_target(host, port, tls_mode)
        client = self._connect(host, port, tls_mode, addresses)
        try:
            client.user(username); client.pass_(password); client.uidl()
        finally:
            client.quit()
        return "success"


@dataclass
class ParsedExternalMessage:
    subject: str
    sender_email: str
    sender_display_name: str
    body_text: str
    body_html: str
    attachments: list
    read_receipt_requested: bool = False
    sender_copy_saved: bool = False

@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes


def parse_external_message(raw: bytes) -> ParsedExternalMessage:
    if len(raw) > 25 * 1024 * 1024: raise ValueError("MAIL_EXTERNAL_MESSAGE_TOO_LARGE")
    message = BytesParser(policy=policy.default).parsebytes(raw)
    display, address = parseaddr(str(message.get("From", "")))
    plain = ""; html = ""; attachments = []
    for part in message.walk():
        filename = part.get_filename()
        if filename:
            data = part.get_payload(decode=True) or b""
            if len(data) > 10 * 1024 * 1024: raise ValueError("MAIL_EXTERNAL_ATTACHMENT_TOO_LARGE")
            attachments.append(ParsedAttachment(os.path.basename(filename.replace("\\", "/"))[:255], part.get_content_type(), data))
            continue
        if part.get_content_maintype() == "multipart": continue
        try: content = part.get_content()
        except Exception: content = ""
        if part.get_content_type() == "text/plain" and not plain: plain = str(content)
        elif part.get_content_type() == "text/html" and not html: html = str(content)
    if len(attachments) > 20 or sum(len(a.data) for a in attachments) > 25 * 1024 * 1024:
        raise ValueError("MAIL_EXTERNAL_ATTACHMENT_LIMIT")
    return ParsedExternalMessage(str(message.get("Subject", ""))[:500], address[:254], display[:200], plain[:1000000], html[:1000000], attachments)


class MailExternalService:
    CONNECTION_FIELDS = ("host", "port", "tls_mode", "username")
    def __init__(self, db=None, security=None, validator=None, pop3=None):
        self.db = db or PostgresService(); self.security = security or SecurityService()
        self.validator = validator or MailExternalEndpointValidator(); self.pop3 = pop3 or MailExternalPop3Client(validator=self.validator)

    @staticmethod
    def _id(prefix): return f"{prefix}_{uuid.uuid4().hex}"
    def _audit(self, cursor, actor, account_id, event, result, now):
        cursor.execute("INSERT INTO audit_logs(id,company_id,actor_user_id,actor_user_name,target_type,target_id,event,status_before,status_after,reason,created_at) VALUES(%s,%s,%s,%s,'mail_external_account',%s,%s,NULL,%s,NULL,%s)",(self._id("audit"),actor.companyId,actor.userId,actor.userName,account_id,event,result,now))
    def prepare_secret(self, password, existing):
        if password is None or not str(password).strip():
            if not existing: raise ExternalMailSecretRequiredError("비밀번호를 입력해 주세요.")
            return existing
        return self.security.encrypt_secret(password)
    @staticmethod
    def account_view(row):
        result = {k: v for k, v in dict(row).items() if k not in {"encrypted_password", "password"}}
        result["passwordConfigured"] = bool(row.get("encrypted_password"))
        job_status = result.pop("job_status", None)
        result["lastJob"] = None if not job_status else {
            "status": job_status, "importedCount": result.pop("job_imported_count", 0),
            "duplicateCount": result.pop("job_duplicate_count", 0), "deletedCount": result.pop("job_deleted_count", 0),
            "failedCount": result.pop("job_failed_count", 0), "errorCode": result.pop("job_error_code", None),
            "completedAt": result.pop("job_completed_at", None),
        }
        for key in ("job_imported_count","job_duplicate_count","job_deleted_count","job_failed_count","job_error_code","job_completed_at"): result.pop(key,None)
        return result
    def connection_state(self, old, new, password_changed):
        if password_changed or any(old.get(k) != new.get(k) for k in self.CONNECTION_FIELDS):
            return {"connection_status": "untested", "enabled": False}
        return {}
    @staticmethod
    def enforce_test_rate(last_test_at, now):
        if last_test_at and now - last_test_at < timedelta(seconds=30): raise ExternalMailRateLimitedError("잠시 후 다시 시도해 주세요.")
    @staticmethod
    def map_integrity_error(exc):
        constraint = getattr(getattr(exc,"diag",None),"constraint_name","") or ""
        if constraint == "uq_mail_external_active_identity": return ExternalMailConflictError("이미 등록된 외부메일 계정입니다.")
        if constraint == "uq_mail_external_active_job": return ExternalMailCollectionBusyError("이미 수집 작업이 진행 중입니다.")
        return ExternalMailConflictError("외부메일 계정 충돌이 발생했습니다.")
    @staticmethod
    def reserve_account_slot(cursor, actor):
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s),hashtext(%s))",(actor.companyId,actor.userId))
        cursor.execute("SELECT COUNT(*) total FROM mail_external_accounts WHERE company_id=%s AND user_id=%s AND deleted_at IS NULL",(actor.companyId,actor.userId))
        if int(cursor.fetchone()["total"]) >= 5: raise ExternalMailLimitError("외부메일 계정은 최대 5개입니다.")
    def reserve_test_attempt(self, actor, account_id, now):
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT id,last_test_at FROM mail_external_accounts WHERE id=%s AND company_id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE",(account_id,actor.companyId,actor.userId)); row=cur.fetchone()
            if not row: raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
            self.enforce_test_rate(row["last_test_at"],now)
            cur.execute("UPDATE mail_external_accounts SET last_test_at=%s,last_test_code='MAIL_EXTERNAL_TESTING',updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s",(now,now,account_id,actor.companyId,actor.userId)); c.commit()
    @staticmethod
    def persist_then_delete(commit_local, delete_remote, delete_enabled):
        commit_local()
        if delete_enabled: delete_remote()

    def list_accounts(self, actor):
        self.db.ensure_migrations_applied()
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT a.*,j.status job_status,j.imported_count job_imported_count,j.duplicate_count job_duplicate_count,j.deleted_count job_deleted_count,j.failed_count job_failed_count,j.error_code job_error_code,j.completed_at job_completed_at FROM mail_external_accounts a LEFT JOIN LATERAL (SELECT status,imported_count,duplicate_count,deleted_count,failed_count,error_code,completed_at FROM mail_external_collection_jobs WHERE account_id=a.id ORDER BY created_at DESC,id DESC LIMIT 1) j ON TRUE WHERE a.company_id=%s AND a.user_id=%s AND a.deleted_at IS NULL ORDER BY a.created_at,a.id", (actor.companyId, actor.userId))
            rows = cur.fetchall()
            cur.execute("SELECT COUNT(*) total FROM mail_external_collection_jobs WHERE company_id=%s AND user_id=%s AND status IN ('queued','running')",(actor.companyId,actor.userId)); active=int(cur.fetchone()["total"])
        return {"accounts": [self.account_view(r) for r in rows], "accountCount": len(rows), "activeJobCount": active}

    def create_account(self, actor, payload):
        host = self.validator.validate_syntax(payload.host, payload.port, payload.tlsMode)
        if payload.enabled: raise ExternalMailTestRequiredError("연결 테스트를 먼저 완료해 주세요.")
        encrypted = self.prepare_secret(payload.password, None); now = datetime.now(UTC); account_id = self._id("external")
        with self.db.connect() as c, c.cursor() as cur:
            self.reserve_account_slot(cur,actor)
            cur.execute("SELECT id FROM mail_accounts WHERE user_id=%s",(actor.userId,)); owner=cur.fetchone()
            if not owner: raise ExternalMailForbiddenError("메일 계정을 사용할 수 없습니다.")
            if payload.targetFolderId:
                cur.execute("SELECT id FROM mail_user_folders WHERE id=%s AND company_id=%s AND user_id=%s",(payload.targetFolderId,actor.companyId,actor.userId))
                if not cur.fetchone(): raise ExternalMailForbiddenError("저장 메일함을 사용할 수 없습니다.")
            try: cur.execute("INSERT INTO mail_external_accounts(id,company_id,user_id,owner_mail_account_id,display_name,host,port,tls_mode,username,encrypted_password,target_folder_id,delete_from_server,enabled,connection_status,version,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,FALSE,'untested',1,%s,%s)", (account_id,actor.companyId,actor.userId,owner["id"],payload.displayName.strip(),host,payload.port,payload.tlsMode,payload.username.strip(),encrypted,payload.targetFolderId,payload.deleteFromServer,now,now))
            except PsycopgError as exc: raise self.map_integrity_error(exc) from None
            self._audit(cur,actor,account_id,"mail.external.created","untested",now)
            c.commit()
        return self.get_account(actor, account_id)

    def get_account(self, actor, account_id):
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT * FROM mail_external_accounts WHERE id=%s AND company_id=%s AND user_id=%s AND deleted_at IS NULL", (account_id,actor.companyId,actor.userId)); row=cur.fetchone()
        if not row: raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
        return self.account_view(row)

    def update_account(self, actor, account_id, payload):
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT * FROM mail_external_accounts WHERE id=%s AND company_id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE", (account_id,actor.companyId,actor.userId)); old=cur.fetchone()
            if not old: raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
            if old["version"] != payload.expectedVersion: raise ExternalMailConflictError("다른 위치에서 계정이 변경되었습니다.")
            host=self.validator.validate_syntax(payload.host,payload.port,payload.tlsMode); encrypted=self.prepare_secret(payload.password,old["encrypted_password"])
            if payload.targetFolderId:
                cur.execute("SELECT id FROM mail_user_folders WHERE id=%s AND company_id=%s AND user_id=%s",(payload.targetFolderId,actor.companyId,actor.userId))
                if not cur.fetchone(): raise ExternalMailForbiddenError("저장 메일함을 사용할 수 없습니다.")
            new={"host":host,"port":payload.port,"tls_mode":payload.tlsMode,"username":payload.username.strip()}; reset=self.connection_state(old,new,bool(payload.password))
            status=reset.get("connection_status",old["connection_status"]); enabled=payload.enabled and status=="success"
            if payload.enabled and status!="success" and not reset: raise ExternalMailTestRequiredError("연결 테스트를 먼저 완료해 주세요.")
            try: cur.execute("UPDATE mail_external_accounts SET display_name=%s,host=%s,port=%s,tls_mode=%s,username=%s,encrypted_password=%s,target_folder_id=%s,delete_from_server=%s,enabled=%s,connection_status=%s,version=version+1,updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s AND version=%s",(payload.displayName.strip(),host,payload.port,payload.tlsMode,payload.username.strip(),encrypted,payload.targetFolderId,payload.deleteFromServer,enabled,status,datetime.now(UTC),account_id,actor.companyId,actor.userId,payload.expectedVersion))
            except PsycopgError as exc: raise self.map_integrity_error(exc) from None
            self._audit(cur,actor,account_id,"mail.external.updated",status,datetime.now(UTC)); c.commit()
        return self.get_account(actor, account_id)

    def delete_account(self, actor, account_id):
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT 1 FROM mail_external_collection_jobs WHERE account_id=%s AND status IN ('queued','running')",(account_id,))
            if cur.fetchone(): raise ExternalMailCollectionBusyError("수집 작업 중에는 계정을 삭제할 수 없습니다.")
            cur.execute("UPDATE mail_external_accounts SET enabled=FALSE,deleted_at=%s,updated_at=%s,version=version+1 WHERE id=%s AND company_id=%s AND user_id=%s AND deleted_at IS NULL RETURNING id",(datetime.now(UTC),datetime.now(UTC),account_id,actor.companyId,actor.userId))
            if not cur.fetchone(): raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
            self._audit(cur,actor,account_id,"mail.external.deleted","deleted",datetime.now(UTC))
            c.commit()

    def bulk_delete_accounts(self, actor, account_ids):
        ids = list(dict.fromkeys(account_ids))
        now = datetime.now(UTC)
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("SELECT id FROM mail_external_accounts WHERE id=ANY(%s) AND company_id=%s AND user_id=%s AND deleted_at IS NULL FOR UPDATE",(ids,actor.companyId,actor.userId))
            owned = {row["id"] for row in cur.fetchall()}
            if owned != set(ids): raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
            cur.execute("SELECT account_id FROM mail_external_collection_jobs WHERE account_id=ANY(%s) AND status IN ('queued','running') FOR UPDATE",(ids,))
            if cur.fetchone(): raise ExternalMailCollectionBusyError("수집 작업 중에는 계정을 삭제할 수 없습니다.")
            cur.execute("UPDATE mail_external_accounts SET enabled=FALSE,deleted_at=%s,updated_at=%s,version=version+1 WHERE id=ANY(%s) AND company_id=%s AND user_id=%s AND deleted_at IS NULL",(now,now,ids,actor.companyId,actor.userId))
            for account_id in ids: self._audit(cur,actor,account_id,"mail.external.deleted","deleted",now)
            c.commit()

    def test_account(self, actor, account_id):
        now=datetime.now(UTC); self.reserve_test_attempt(actor,account_id,now); row=self._raw_account(actor,account_id)
        host=self.validator.validate(row["host"],row["port"],row["tls_mode"])
        try:
            self.pop3.test(host,row["port"],row["tls_mode"],row["username"],self.security.decrypt_secret(row["encrypted_password"]))
        except Exception as exc:
            with self.db.connect() as c, c.cursor() as cur:
                cur.execute("UPDATE mail_external_accounts SET connection_status='failed',enabled=FALSE,last_test_at=%s,last_test_code='MAIL_EXTERNAL_CONNECTION_FAILED',updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s",(now,now,account_id,actor.companyId,actor.userId))
                self._audit(cur,actor,account_id,"mail.external.tested","failed",now); c.commit()
            raise ExternalMailError("외부메일 연결 테스트에 실패했습니다.") from None
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("UPDATE mail_external_accounts SET connection_status='success',last_test_at=%s,last_test_code='OK',updated_at=%s WHERE id=%s AND company_id=%s AND user_id=%s",(now,now,account_id,actor.companyId,actor.userId))
            self._audit(cur,actor,account_id,"mail.external.tested","success",now);c.commit()
        return self.get_account(actor,account_id)

    def queue_collect(self, actor, account_id):
        row=self._raw_account(actor,account_id)
        if row["connection_status"]!="success": raise ExternalMailTestRequiredError("연결 테스트를 먼저 완료해 주세요.")
        now=datetime.now(UTC); job=self._id("externaljob")
        with self.db.connect() as c, c.cursor() as cur:
            cur.execute("INSERT INTO mail_external_collection_jobs(id,account_id,company_id,user_id,trigger,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES(%s,%s,%s,%s,'manual','queued',0,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id",(job,account_id,actor.companyId,actor.userId,now,now,now))
            if not cur.fetchone(): raise ExternalMailCollectionBusyError("이미 수집 작업이 진행 중입니다.")
            self._audit(cur,actor,account_id,"mail.external.collection.queued","queued",now)
            c.commit()
        return {"jobId":job,"status":"queued"}

    def _raw_account(self, actor, account_id):
        with self.db.connect() as c,c.cursor() as cur:
            cur.execute("SELECT * FROM mail_external_accounts WHERE id=%s AND company_id=%s AND user_id=%s AND deleted_at IS NULL",(account_id,actor.companyId,actor.userId));row=cur.fetchone()
        if not row: raise ExternalMailNotFoundError("외부메일 계정을 찾을 수 없습니다.")
        return row
