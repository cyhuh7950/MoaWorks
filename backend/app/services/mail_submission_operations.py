from __future__ import annotations

from datetime import UTC, datetime, timedelta
from email import policy
from email.parser import BytesParser
from hashlib import sha256
import os
from pathlib import Path
import re
from secrets import compare_digest
from uuid import uuid4

from app.core.config import settings
from app.services.mail_inbound_operations import MailInboundStorage, MailInboundOperations
from app.services.mail_inbound_service import parse_inbound_message
from app.services.outbound_provider_resolver import OutboundProviderResolver
from app.services.postgres_service import PostgresService


class SubmissionUnavailable(RuntimeError):
    """게이트웨이가 원래 큐를 보관하고 재시도해야 하는 오류."""


def mailbox(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", value) or len(value) > 254:
        raise ValueError('SMTP envelope 주소가 올바르지 않습니다.')
    return value.lower()


def validate_submission(raw: bytes, sender: str, recipient: str, queue_id: str) -> bytes:
    sender = mailbox(sender)
    mailbox(recipient)
    if not re.fullmatch(r'[A-Za-z0-9]{5,100}', queue_id):
        raise ValueError('SMTP queue 식별자가 올바르지 않습니다.')
    if not raw or len(raw) > settings.mail_inbound_max_message_bytes or b'\x00' in raw:
        raise ValueError('SMTP 원문 크기 또는 형식이 올바르지 않습니다.')
    if re.search(br'(?<!\r)\n|\r(?!\n)', raw):
        raise ValueError('SMTP 원문은 gateway CRLF 출력이어야 합니다.')
    # 헤더만 제거한다. MIME를 재직렬화하면 boundary/encoding/서명이 바뀐다.
    match = re.search(br'\r?\n\r?\n', raw)
    if match is None or match.start() > 128 * 1024:
        raise ValueError('SMTP 헤더가 올바르지 않습니다.')
    message = BytesParser(policy=policy.default).parsebytes(raw)
    if message.defects or any(part.defects for part in message.walk()):
        raise ValueError('SMTP MIME 형식이 올바르지 않습니다.')
    for name in ('From', 'Sender'):
        headers = message.get_all(name, [])
        if (name == 'From' and len(headers) != 1) or len(headers) > 1:
            raise ValueError('SMTP 발신 헤더가 올바르지 않습니다.')
        for header in headers:
            addresses = getattr(header, 'addresses', ())
            if header.defects or len(addresses) != 1 or mailbox(addresses[0].addr_spec) != sender:
                raise ValueError('SMTP 발신 헤더와 인증 발신자가 일치하지 않습니다.')
    for name, value in message.items():
        if name.lower().startswith('resent-') or getattr(value, 'defects', ()):
            raise ValueError('SMTP 헤더가 올바르지 않습니다.')
    head = raw[:match.start()]
    lines = head.splitlines(keepends=True)
    kept = []
    dropping = False
    for line in lines:
        if not line.startswith((b' ', b'\t')):
            if not re.match(br'^[!-9;-~]+:', line):
                raise ValueError('SMTP 헤더가 올바르지 않습니다.')
            dropping = line.split(b':', 1)[0].lower() == b'bcc'
        if not dropping:
            kept.append(line)
    return b''.join(kept).rstrip(b'\r\n') + raw[match.start():]


class MailSubmissionStorage(MailInboundStorage):
    def store_raw(self, content_sha256: str, content: bytes) -> str:
        if sha256(content).hexdigest() != content_sha256:
            raise ValueError('SMTP 원문 해시가 일치하지 않습니다.')
        return self._store(content_sha256, 'raw.eml', content)

    def _store(self, content_sha256: str, file_name: str, content: bytes) -> str:
        if not re.fullmatch('[0-9a-f]{64}', content_sha256) or not re.fullmatch(r'raw\.eml|attachment-[0-9]+\.bin', file_name):
            raise ValueError('SMTP 저장 식별자가 올바르지 않습니다.')
        key = f'mail/submission/{content_sha256[:2]}/{content_sha256}/{file_name}'
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError('SMTP 원문 저장 경로가 올바르지 않습니다.')
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if path.read_bytes() != content:
                raise ValueError('SMTP 원문 저장 내용이 일치하지 않습니다.')
        else:
            temporary = path.with_name(f'.{uuid4().hex}.tmp')
            try:
                temporary.write_bytes(content)
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        return key


def load_submission_raw(key: str, digest: str, size: int, *, root: Path | None = None) -> bytes:
    if not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('SMTP 원문 해시가 올바르지 않습니다.')
    if key != f'mail/submission/{digest[:2]}/{digest}/raw.eml':
        raise ValueError('SMTP 원문 저장 경로가 올바르지 않습니다.')
    root = (root or settings.storage_path).resolve()
    path = (root / key).resolve()
    if root not in path.parents or not 0 < int(size) <= settings.mail_inbound_max_message_bytes:
        raise ValueError('SMTP 원문 저장 경로 또는 크기가 올바르지 않습니다.')
    with path.open('rb') as handle:
        content = handle.read(int(size) + 1)
    if len(content) != int(size) or not compare_digest(sha256(content).hexdigest(), digest):
        raise ValueError('SMTP 원문 저장 내용이 일치하지 않습니다.')
    return content


def submission_attachments(mime) -> list[dict]:
    result, content_ids = [], set()
    def visit(part):
        cid = str(part.get('Content-ID') or '').strip().strip('<>') or None
        disposition = part.get_content_disposition()
        if cid or disposition in ('attachment', 'inline') or part.get_filename():
            disposition = 'inline' if cid and disposition != 'attachment' else 'attachment'
            cid = cid if disposition == 'inline' else None
            if cid and (cid in content_ids or not re.fullmatch(r'[^\s<>]+', cid)):
                raise ValueError('SMTP inline Content-ID가 올바르지 않습니다.')
            if cid:
                content_ids.add(cid)
            content = part.get_payload(decode=True)
            if content is None and part.is_multipart():
                content = b''.join(child.as_bytes(policy=policy.SMTP) for child in part.get_payload())
            content = content or b''
            result.append(dict(file_name=(part.get_filename() or 'attachment.bin')[:255],
                content_type=part.get_content_type(),size_bytes=len(content),content=content,
                content_disposition=disposition,content_id=cid))
        elif part.is_multipart():
            for child in part.get_payload():
                visit(child)
    visit(mime)
    return result


def verified_submission_attachment(root: Path, key: str) -> dict:
    match = re.fullmatch(r'mail/submission/([0-9a-f]{2})/([0-9a-f]{64})/attachment-([0-9]+)\.bin', key or '')
    if not match or match[1] != match[2][:2]:
        raise ValueError('SMTP 첨부 저장 경로가 올바르지 않습니다.')
    root = root.resolve()
    raw_key = f'mail/submission/{match[1]}/{match[2]}/raw.eml'
    raw_path = (root / raw_key).resolve()
    if root not in raw_path.parents:
        raise ValueError('SMTP 첨부 저장 경로가 올바르지 않습니다.')
    raw = load_submission_raw(raw_key, match[2], raw_path.stat().st_size, root=root)
    parts = submission_attachments(BytesParser(policy=policy.default).parsebytes(raw))
    index = int(match[3])
    if index >= len(parts):
        raise ValueError('SMTP 첨부 순번이 올바르지 않습니다.')
    part = parts[index]
    path = (root / key).resolve()
    if root not in path.parents:
        raise ValueError('SMTP 첨부 저장 경로가 올바르지 않습니다.')
    with path.open('rb') as handle:
        content = handle.read(part['size_bytes'] + 1)
    if content != part['content']:
        raise ValueError('SMTP 첨부와 원문이 일치하지 않습니다.')
    return dict(part, path=path)


class MailSubmissionOperations:
    def __init__(self, db=None, storage=None):
        self.db = db or PostgresService()
        self.storage = storage or MailSubmissionStorage()

    def submit(self, *, envelope_from: str, recipient_email: str, queue_id: str, raw_message: bytes) -> dict:
        clean = validate_submission(raw_message, envelope_from, recipient_email, queue_id)
        sender, recipient = mailbox(envelope_from), mailbox(recipient_email)
        original_digest, digest = sha256(raw_message).hexdigest(), sha256(clean).hexdigest()
        parsed = parse_inbound_message(clean)
        mime = BytesParser(policy=policy.default).parsebytes(clean)
        recipient_kind = 'bcc'
        for header, kind in (('Cc', 'cc'), ('To', 'to')):
            if any(address.addr_spec.lower() == recipient for value in mime.get_all(header, []) for address in value.addresses):
                recipient_kind = kind
        attachments = submission_attachments(mime)
        now = datetime.now(UTC)
        self.db.ensure_migrations_applied()
        with self.db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("""SELECT u.id AS user_id,u.company_id,a.id AS account_id
                    FROM mail_submission_credentials c
                    JOIN users u ON u.id=c.user_id AND u.company_id=c.company_id
                    JOIN mail_accounts a ON a.user_id=u.id
                    JOIN mail_domain_settings d ON d.company_id=u.company_id
                    WHERE c.active=TRUE AND c.revoked_at IS NULL AND u.status='active' AND a.status='active'
                      AND LOWER(c.username)=%s AND LOWER(u.email)=%s AND LOWER(a.email)=%s
                      AND LOWER(split_part(a.email,'@',2))=LOWER(d.mail_domain)
                    FOR SHARE OF c,u,a,d""", (sender, sender, sender))
                actor = cursor.fetchone()
                if actor is None:
                    raise ValueError('활성 SMTP 발신 계정을 찾을 수 없습니다.')
                company = actor['company_id']
                # 큐 단위 잠금은 서로 다른 recipient의 원문 충돌도 검출한다.
                cursor.execute("""INSERT INTO mail_submission_messages
                    (company_id,gateway_queue_id,original_sha256,raw_sha256,created_at)
                    VALUES (%s,%s,%s,%s,%s) ON CONFLICT (company_id,gateway_queue_id) DO NOTHING""",
                    (company, queue_id, original_digest, digest, now))
                cursor.execute("""SELECT * FROM mail_submission_messages
                    WHERE company_id=%s AND gateway_queue_id=%s FOR UPDATE""", (company, queue_id))
                source = cursor.fetchone()
                if source['original_sha256'] != original_digest or source['raw_sha256'] != digest:
                    raise ValueError('SMTP queue 원문 충돌입니다.')
                cursor.execute("""SELECT disposition FROM mail_submission_recipients
                    WHERE company_id=%s AND gateway_queue_id=%s AND recipient_email=%s""", (company, queue_id, recipient))
                duplicate = cursor.fetchone()
                if duplicate:
                    return {'status': 'accepted', 'duplicate': True, 'disposition': duplicate['disposition']}
                cursor.execute("""SELECT u.id AS user_id,u.company_id FROM users u
                    JOIN mail_accounts a ON a.user_id=u.id
                    WHERE u.company_id=%s AND LOWER(u.email)=%s AND LOWER(a.email)=%s
                      AND u.status='active' AND a.status='active'""", (company, recipient, recipient))
                local = cursor.fetchone()
                cursor.execute('SELECT company_id FROM mail_domain_settings WHERE company_id=%s AND LOWER(mail_domain)=%s', (company, recipient.rsplit('@', 1)[1]))
                local_domain = cursor.fetchone()
                if local_domain and local is None:
                    raise ValueError('활성 동일 회사 내부 수신 계정을 찾을 수 없습니다.')
                internal = local is not None and local['company_id'] == company and local_domain is not None
                provider = None
                if not internal:
                    try:
                        provider = OutboundProviderResolver.resolve(cursor, company)
                    except ValueError as exc:
                        raise SubmissionUnavailable('회사 발송 정책을 사용할 수 없습니다.') from exc
                    if not provider.get('delivery_enabled') or provider.get('last_test_status') != 'success':
                        raise SubmissionUnavailable('회사 발송 정책이 잠겨 있습니다.')
                    if provider['provider_type'] not in ('oci_email_delivery', 'self_hosted', 'self_hosted_smtp'):
                        raise SubmissionUnavailable('SMTP 원문 발송 Provider를 사용할 수 없습니다.')
                mail_id = source.get('mail_message_id')
                if mail_id is None and source.get('stored_at') is not None:
                    raise ValueError('삭제된 SMTP queue에 수신자를 추가할 수 없습니다.')
                if mail_id is None:
                    key = self.storage.store_raw(digest, clean)
                    mail_id = f'mail_{uuid4().hex}'
                    cursor.execute("""INSERT INTO mail_messages
                        (id,company_id,sender_user_id,sender_account_id,sender_email,subject,body_text,body_html,
                         status,sent_at,created_at,updated_at,retention_expires_at,attachment_count,sender_display_name,
                         raw_storage_key,raw_sha256,raw_size)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'sent',%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mail_id,company,actor['user_id'],actor['account_id'],sender,parsed.subject,parsed.body_text,
                         parsed.body_html,now,now,now,now+timedelta(days=30),len(attachments),parsed.sender_display_name,key,digest,len(clean)))
                    for index, part in enumerate(attachments):
                        content = part['content']
                        key = self.storage.store_attachment(digest,index,content)
                        cursor.execute("""INSERT INTO mail_attachments
                            (id,message_id,file_name,content_type,size_bytes,storage_key,created_at,content_disposition,content_id)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                            (f'attach_{uuid4().hex}',mail_id,part['file_name'],part['content_type'],len(content),key,now,part['content_disposition'],part['content_id']))
                    cursor.execute("""UPDATE mail_submission_messages SET mail_message_id=%s,stored_at=%s
                        WHERE company_id=%s AND gateway_queue_id=%s""", (mail_id,now,company,queue_id))
                recipient_id = f'rcpt_{uuid4().hex}'
                disposition = 'queued'
                if internal:
                    inbound = MailInboundOperations(db=self.db, storage=MailInboundStorage(self.storage.root)).ingest(
                        envelope_from=sender, recipient_email=recipient, raw_message=clean,
                        connection=connection, submission_mail_id=mail_id, recipient_kind=recipient_kind,
                        recipient_company_id=company, submission_queue_id=queue_id)
                    disposition = 'internal' if inbound.disposition == 'inbox' else inbound.disposition
                else:
                    cursor.execute("""INSERT INTO mail_recipients
                        (id,message_id,recipient_user_id,recipient_email,recipient_kind,is_read,is_starred,received_at,delivery_source)
                        VALUES (%s,%s,NULL,%s,%s,FALSE,FALSE,NULL,'direct')""",
                        (recipient_id,mail_id,recipient,recipient_kind))
                if provider:
                    cursor.execute("""INSERT INTO mail_delivery_queue
                        (id,company_id,provider_config_id,mail_id,recipient_id,status,delivery_kind,created_at,updated_at)
                        VALUES (%s,%s,%s,%s,%s,'queued','submission',%s,%s)""",
                        (f'delivery_{uuid4().hex}',company,provider['id'],mail_id,recipient_id,now,now))
                cursor.execute("""INSERT INTO mail_submission_recipients
                    (company_id,gateway_queue_id,recipient_email,disposition,created_at) VALUES (%s,%s,%s,%s,%s)""",
                    (company,queue_id,recipient,disposition,now))
            connection.commit()
        return {'status': 'accepted', 'duplicate': False, 'disposition': disposition}
