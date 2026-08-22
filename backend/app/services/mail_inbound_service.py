from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass
from email import policy
from email.message import Message
from email.parser import BytesParser
from email.utils import parseaddr
from hashlib import sha256
import re


@dataclass(frozen=True, slots=True)
class InboundAttachment:
    file_name: str
    content_type: str
    content: bytes


@dataclass(frozen=True, slots=True)
class ParsedInboundMessage:
    message_id: str
    content_sha256: str
    sender_email: str
    subject: str
    body_text: str
    body_html: str | None
    authentication_results: tuple[str, ...]
    spam_header: str
    spam_result: str
    virus_status: str
    attachments: tuple[InboundAttachment, ...]


@dataclass(frozen=True, slots=True)
class InboundSecurityDecision:
    disposition: str
    reason: str


def parse_inbound_message(raw_message: bytes) -> ParsedInboundMessage:
    if not raw_message:
        raise ValueError("빈 SMTP 메시지는 처리할 수 없습니다.")
    message = BytesParser(policy=policy.default).parsebytes(raw_message)
    body_text = _body_content(message, "plain")
    body_html = _embed_inline_images(message, _body_content(message, "html")) or None
    attachments: list[InboundAttachment] = []
    for part in message.iter_attachments():
        content = part.get_payload(decode=True) or b""
        attachments.append(
            InboundAttachment(
                file_name=(part.get_filename() or "attachment.bin")[:255],
                content_type=part.get_content_type(),
                content=content,
            )
        )
    sender_email = parseaddr(str(message.get("From") or ""))[1].strip().lower()
    digest = sha256(raw_message).hexdigest()
    return ParsedInboundMessage(
        message_id=str(message.get("Message-ID") or f"<{digest}@inbound.local>"),
        content_sha256=digest,
        sender_email=sender_email,
        subject=str(message.get("Subject") or ""),
        body_text=body_text,
        body_html=body_html,
        authentication_results=tuple(str(value) for value in message.get_all("Authentication-Results", [])),
        spam_header=str(message.get("X-Spam") or ""),
        spam_result=str(message.get("X-Spamd-Result") or ""),
        virus_status=str(message.get("X-Virus-Status") or ""),
        attachments=tuple(attachments),
    )


def classify_inbound_security(message: ParsedInboundMessage) -> InboundSecurityDecision:
    virus_status = message.virus_status.strip().lower()
    if virus_status and not virus_status.startswith("clean"):
        return InboundSecurityDecision("quarantine", "malware_detected")
    spam_header = message.spam_header.strip().lower()
    spam_result = message.spam_result.lower()
    if spam_header in {"yes", "true", "1"} or "default: true" in spam_result:
        return InboundSecurityDecision("spam", "rspamd_spam")
    return InboundSecurityDecision("inbox", "security_checks_passed")


def _embed_inline_images(message: Message, body_html: str) -> str:
    if not body_html:
        return body_html
    allowed_types = {"image/png", "image/gif", "image/jpeg", "image/webp"}
    result = body_html
    for part in message.walk():
        content_id = str(part.get("Content-ID") or "").strip().strip("<>")
        content_type = part.get_content_type().lower()
        if not content_id or content_type not in allowed_types:
            continue
        content = part.get_payload(decode=True) or b""
        if not content or len(content) > 5 * 1024 * 1024:
            continue
        data_uri = f"data:{content_type};base64,{b64encode(content).decode('ascii')}"
        result = re.sub(r"cid:" + re.escape(content_id), data_uri, result, flags=re.IGNORECASE)
    return result

def _body_content(message: Message, subtype: str) -> str:
    selected = message.get_body(preferencelist=(subtype,))
    if selected is None or selected.get_content_disposition() == "attachment":
        return ""
    content = selected.get_content()
    return content if isinstance(content, str) else content.decode("utf-8", errors="replace")
