from __future__ import annotations
from datetime import UTC, datetime, timedelta
import logging
import time
import uuid

from app.schemas.directory import AuthUserSummary
from app.services.mail_attachment_storage import MailAttachmentStorage
from app.services.mail_external_service import ExternalCollectionSafety, ExternalLeaseLostError, MailExternalEndpointValidator, MailExternalPop3Client, RemoteDeleteState, parse_external_message
from app.services.mail_messenger_service import MailMessengerService
from app.services.postgres_service import PostgresService
from app.services.security_service import SecurityService

logger = logging.getLogger(__name__)
WORKER = "mail-external-worker"

def _id(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex}"

def _enqueue_scheduled(service: PostgresService) -> None:
    now=datetime.now(UTC)
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("UPDATE mail_external_collection_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=%s,updated_at=%s WHERE status='running' AND lease_expires_at<%s AND attempt_count<3",(now,now,now))
        cursor.execute("UPDATE mail_external_collection_jobs SET status='failed',error_code='MAIL_EXTERNAL_LEASE_EXHAUSTED',completed_at=%s,lease_owner=NULL,lease_expires_at=NULL,updated_at=%s WHERE status='running' AND lease_expires_at<%s AND attempt_count>=3",(now,now,now))
        cursor.execute("SELECT id,company_id,user_id FROM mail_external_accounts WHERE deleted_at IS NULL AND enabled=TRUE AND connection_status='success' AND COALESCE(next_collect_at,%s)<=%s",(now,now))
        for account in cursor.fetchall():
            cursor.execute("INSERT INTO mail_external_collection_jobs(id,account_id,company_id,user_id,trigger,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES(%s,%s,%s,%s,'scheduled','queued',0,%s,%s,%s) ON CONFLICT DO NOTHING",(_id("externaljob"),account["id"],account["company_id"],account["user_id"],now,now,now))
        connection.commit()

def _claim(service: PostgresService):
    service.ensure_migrations_applied()
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT id FROM mail_external_collection_jobs WHERE status='queued' AND next_attempt_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")
        job = cursor.fetchone()
        if not job: return None
        cursor.execute("UPDATE mail_external_collection_jobs SET status='running',lease_owner=%s,lease_expires_at=NOW()+INTERVAL '5 minutes',attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=%s AND status='queued' RETURNING *", (WORKER, job["id"]))
        claimed = cursor.fetchone(); connection.commit()
    return claimed

def _context(service: PostgresService, job):
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT a.*,u.email owner_email,u.name owner_name,u.role_id,u.user_type,u.status,r.name role_name,r.permissions FROM mail_external_accounts a JOIN users u ON u.id=a.user_id JOIN roles r ON r.id=u.role_id WHERE a.id=%s AND a.company_id=%s AND a.user_id=%s AND a.deleted_at IS NULL",(job["account_id"],job["company_id"],job["user_id"]))
        return cursor.fetchone()

def _heartbeat(service, job) -> bool:
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("UPDATE mail_external_collection_jobs SET lease_expires_at=NOW()+INTERVAL '5 minutes',updated_at=NOW() WHERE id=%s AND status='running' AND lease_owner=%s RETURNING id",(job["id"],WORKER)); owned=bool(cursor.fetchone()); connection.commit(); return owned

def _import_state(service, account_id, uidl):
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT remote_delete_status FROM mail_external_imports WHERE account_id=%s AND uidl=%s",(account_id,uidl)); row=cursor.fetchone(); return None if not row else row["remote_delete_status"]

def _set_remote_states(service, account_id, states):
    with service.connect() as connection, connection.cursor() as cursor:
        for uidl,(status,code) in states.items():
            cursor.execute("UPDATE mail_external_imports SET remote_delete_status=%s,remote_delete_code=%s,remote_deleted_at=CASE WHEN %s='deleted' THEN NOW() ELSE remote_deleted_at END,updated_at=NOW() WHERE account_id=%s AND uidl=%s",(status,code,status,account_id,uidl))
        connection.commit()

def _store(service, account, uidl, parsed, actor, storage, messenger):
    staged=[]
    for attachment in parsed.attachments:
        uploaded=storage.stage(actor,attachment.filename,attachment.content_type,attachment.data)
        staged.append(storage.resolve(actor, uploaded))
    now=datetime.now(UTC); message_id=_id("mail"); recipient_id=_id("rcpt")
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("INSERT INTO mail_external_imports(id,account_id,company_id,user_id,uidl,message_id,remote_delete_status,imported_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(account_id,uidl) DO NOTHING RETURNING id",(_id("externalimport"),account["id"],account["company_id"],account["user_id"],uidl,message_id,"pending" if account["delete_from_server"] else "kept",now,now))
        if not cursor.fetchone(): connection.rollback(); return False, []
        cursor.execute("INSERT INTO mail_messages(id,company_id,sender_user_id,sender_account_id,sender_email,subject,body_text,body_html,status,sent_at,created_at,updated_at,retention_expires_at,attachment_count,source_action,source_external_account_id,sender_display_name,message_encoding,sender_copy_saved,read_receipt_requested) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,'sent',%s,%s,%s,%s,%s,'external_pop3',%s,%s,'utf-8',FALSE,FALSE)",(message_id,account["company_id"],account["user_id"],account["owner_mail_account_id"],parsed.sender_email,parsed.subject,parsed.body_text,parsed.body_html or None,now,now,now,now+timedelta(days=30),len(staged),account["id"],parsed.sender_display_name))
        decision=messenger._evaluate_recipient_spam(cursor,actor,account["user_id"],parsed.sender_email,message_id)
        cursor.execute("INSERT INTO mail_recipients(id,message_id,recipient_user_id,recipient_email,recipient_kind,is_read,is_starred,received_at,folder_id,is_spam,spam_marked_at,delivery_source) VALUES(%s,%s,%s,%s,'to',FALSE,FALSE,%s,%s,%s,%s,'direct')",(recipient_id,message_id,account["user_id"],account["owner_email"],now,account["target_folder_id"],decision.decision=="spam",now if decision.decision=="spam" else None))
        for item in staged:
            cursor.execute("INSERT INTO mail_attachments(id,message_id,file_name,content_type,size_bytes,storage_key,created_at) VALUES(%s,%s,%s,%s,%s,%s,%s)",(_id("attach"),message_id,item["file_name"],item["content_type"],item["size_bytes"],item["storage_key"],now))
        messenger._write_spam_classification_audit(cursor,actor=actor,mail_id=message_id,recipient_user_id=account["user_id"],decision=decision,now=now)
        if decision.decision!="spam":
            messenger._apply_auto_classification(cursor,company_id=account["company_id"],recipient_user_id=account["user_id"],actor_user_id=account["user_id"],actor_user_name=account["owner_name"],mail_id=message_id,recipient_id=recipient_id,sender_email=parsed.sender_email,recipient_email=account["owner_email"],subject=parsed.subject,body=parsed.body_text,has_attachment=bool(staged),now=now)
            messenger._apply_auto_forwarding(cursor,company_id=account["company_id"],recipient_user_id=account["user_id"],actor_user_id=account["user_id"],actor_user_name=account["owner_name"],mail_id=message_id,recipient_id=recipient_id,sender_email=parsed.sender_email,recipient_email=account["owner_email"],delivery_source="direct",subject=parsed.subject,body=parsed.body_text,has_attachment=bool(staged),now=now)
            messenger._apply_out_of_office(cursor,company_id=account["company_id"],recipient_user_id=account["user_id"],actor_user_id=account["user_id"],actor_user_name=account["owner_name"],mail_id=message_id,recipient_id=recipient_id,sender_email=parsed.sender_email,delivery_source="direct",is_auto_generated=False,is_spam=False,now=now)
        connection.commit()
    for item in staged: storage.mark_attached(item["upload_id"])
    return True, staged

def _finalize(service, job, status, counts, code=None):
    now=datetime.now(UTC)
    with service.connect() as connection, connection.cursor() as cursor:
        cursor.execute("UPDATE mail_external_collection_jobs SET status=%s,seen_count=%s,imported_count=%s,duplicate_count=%s,deleted_count=%s,failed_count=%s,error_code=%s,completed_at=%s,lease_owner=NULL,lease_expires_at=NULL,updated_at=%s WHERE id=%s AND status='running' AND lease_owner=%s RETURNING id",(status,counts["seen"],counts["imported"],counts["duplicate"],counts["deleted"],counts["failed"],code,now,now,job["id"],WORKER))
        if not cursor.fetchone(): connection.rollback(); raise ExternalLeaseLostError("MAIL_EXTERNAL_LEASE_LOST")
        cursor.execute("UPDATE mail_external_accounts SET last_collect_at=%s,next_collect_at=%s,updated_at=%s WHERE id=%s",(now,now+timedelta(minutes=10),now,job["account_id"]));connection.commit()

def run_once(db=None) -> bool:
    service=db or PostgresService(); _enqueue_scheduled(service); job=_claim(service)
    if not job: return False
    counts={"seen":0,"imported":0,"duplicate":0,"deleted":0,"failed":0}; client=None; started=time.monotonic(); safety=ExternalCollectionSafety(); pending=[]
    try:
        account=_context(service,job)
        if not account: raise RuntimeError("MAIL_EXTERNAL_ACCOUNT_UNAVAILABLE")
        actor=AuthUserSummary(userId=account["user_id"],companyId=account["company_id"],userName=account["owner_name"],userEmail=account["owner_email"],roleId=account["role_id"],roleName=account["role_name"],userType=account["user_type"],status=account["status"],permissions=list(account["permissions"] or []))
        host,addresses=MailExternalEndpointValidator().validate_target(account["host"],account["port"],account["tls_mode"])
        pop=MailExternalPop3Client(); client=pop._connect(host,account["port"],account["tls_mode"],addresses)
        if getattr(client,"sock",None): client.sock.settimeout(safety.command_seconds)
        client.user(account["username"]);client.pass_(SecurityService().decrypt_secret(account["encrypted_password"]));_, lines,_=client.uidl()
        messenger=MailMessengerService(); messenger.db=service; storage=MailAttachmentStorage()
        for line in lines[:100]:
            safety.assert_deadline(time.monotonic()-started); safety.assert_lease(lambda:_heartbeat(service,job))
            number,uidl=line.decode("utf-8","replace").split(" ",1);counts["seen"]+=1
            action="import"
            try:
                action=safety.uidl_action(_import_state(service,account["id"],uidl),account["delete_from_server"])
                if action=="duplicate": counts["duplicate"]+=1;continue
                if action=="delete_only": client.dele(int(number));pending.append(uidl);counts["duplicate"]+=1;continue
                list_response=client.list(int(number)); list_line=list_response[0] if isinstance(list_response,tuple) else list_response
                size=int(list_line.decode("ascii","replace").rsplit(" ",1)[-1]); safety.assert_retr_size(size)
                _,raw_lines,octets=client.retr(int(number)); safety.assert_retr_size(int(octets)); parsed=parse_external_message(b"\r\n".join(raw_lines));stored,_=_store(service,account,uidl,parsed,actor,storage,messenger)
                if not stored: counts["duplicate"]+=1;continue
                counts["imported"]+=1
                if account["delete_from_server"]: client.dele(int(number));pending.append(uidl)
            except ExternalLeaseLostError: raise
            except Exception:
                counts["failed"]+=1
                if account["delete_from_server"] and action in {"import","delete_only"}: _set_remote_states(service,account["id"],{uidl:("failed","MAIL_EXTERNAL_DELETE_FAILED")})
        safety.assert_lease(lambda:_heartbeat(service,job))
        try: client.quit(); quit_ok=True
        except Exception: quit_ok=False
        client=None
        if pending:
            states=RemoteDeleteState.after_quit(pending,quit_ok); _set_remote_states(service,account["id"],states)
            counts["deleted"]=len(pending) if quit_ok else 0
            if not quit_ok: counts["failed"]+=len(pending)
        _finalize(service,job,"partial" if counts["failed"] else "completed",counts,"MAIL_EXTERNAL_PARTIAL" if counts["failed"] else None)
    except ExternalLeaseLostError:
        if client:
            try: client.quit()
            except Exception: pass
    except Exception:
        if client:
            try: client.quit()
            except Exception: pass
        if int(job["attempt_count"]) < 3:
            retry_at=datetime.now(UTC)+timedelta(minutes=2 ** max(0,int(job["attempt_count"])-1))
            with service.connect() as connection, connection.cursor() as cursor:
                cursor.execute("UPDATE mail_external_collection_jobs SET status='queued',next_attempt_at=%s,error_code='MAIL_EXTERNAL_RETRY_PENDING',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW() WHERE id=%s AND status='running' AND lease_owner=%s",(retry_at,job["id"],WORKER));connection.commit()
        else: _finalize(service,job,"failed",counts,"MAIL_EXTERNAL_COLLECTION_FAILED")
    return True

def main():
    while True:
        try:
            if not run_once(): time.sleep(10)
        except Exception:
            logger.exception("mail external worker degraded")
            time.sleep(10)

if __name__ == "__main__": main()
