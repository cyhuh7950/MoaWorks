from __future__ import annotations

import pytest

from app.schemas.mail_messenger import MailAttachmentMeta, MailDraftRequest
from app.services.mail_html_sanitizer import (
    extract_cid_references,
    sanitize_mail_html,
)
from app.services.mail_messenger_service import MailMessengerService


@pytest.mark.parametrize(
    "html",
    [
        "<script>alert(1)</script>",
        '<iframe src="https://tracker.example/frame"></iframe>',
        '<p onclick="alert(1)">본문</p>',
        '<img src="https://tracker.example/x">',
        '<img src="data:image/png;base64,AAAA">',
        '<span style="background:url(https://tracker.example/x)">본문</span>',
        '<span style="background-image:u/**/rl(https://tracker.example/x)">본문</span>',
        '<span style="color:var(--mail-color)">본문</span>',
        '<a href="javascript:alert(1)">링크</a>',
        '<a href="java&#x0a;script:alert(1)">링크</a>',
    ],
)
def test_active_or_remote_content_is_rejected(html: str) -> None:
    """Allowing active or remotely loaded content must fail this test."""
    with pytest.raises(ValueError):
        sanitize_mail_html(html, set())


def test_known_cid_and_safe_format_are_kept_deterministically() -> None:
    """Dropping approved formatting or changing output between runs must fail."""
    html = (
        '<p style="text-align:center;color:#112233;position:fixed">'
        '<strong>안녕</strong>'
        '<img src="cid:mw-1@example.invalid" alt="사진" width="320" height="200">'
        "</p>"
    )
    allowed = {"mw-1@example.invalid"}

    first = sanitize_mail_html(html, allowed)
    second = sanitize_mail_html(html, allowed)

    assert first == second
    assert first == (
        '<p style="color:#112233;text-align:center"><strong>안녕</strong>'
        '<img src="cid:mw-1@example.invalid" alt="사진" width="320" height="200"></p>'
    )
    assert extract_cid_references(first) == allowed


def test_safe_links_are_kept_with_required_rel() -> None:
    """Dropping safe links or omitting the anti-opener rel must fail this test."""
    cleaned = sanitize_mail_html(
        '<p><a href="https://example.test/path">안전 링크</a></p>',
        set(),
    )

    assert cleaned == (
        '<p><a href="https://example.test/path" rel="noopener noreferrer">'
        "안전 링크</a></p>"
    )


def test_external_image_candidate_attributes_are_removed() -> None:
    """Keeping remote srcset candidates beside an approved CID must fail."""
    cleaned = sanitize_mail_html(
        '<img src="cid:image@example.invalid" '
        'srcset="https://tracker.example/x 2x" alt="사진">',
        {"image@example.invalid"},
    )

    assert cleaned == '<img src="cid:image@example.invalid" alt="사진">'


@pytest.mark.parametrize(
    ("html", "allowed_content_ids"),
    [
        ('<img src="cid:unknown@example.invalid">', set()),
        ("<p>본문</p>", {"unused@example.invalid"}),
        (
            '<img src="cid:known@example.invalid">',
            {"known@example.invalid", "unused@example.invalid"},
        ),
    ],
)
def test_cid_references_must_exactly_match_allowed_set(
    html: str,
    allowed_content_ids: set[str],
) -> None:
    """Accepting unknown or unreferenced inline content IDs must fail this test."""
    with pytest.raises(ValueError):
        sanitize_mail_html(html, allowed_content_ids)


def test_extract_cid_references_reads_only_image_sources() -> None:
    """Treating visible text or link href values as inline images must fail."""
    html = (
        '<p>cid:visible@example.invalid</p>'
        '<a href="cid:link@example.invalid">링크</a>'
        '<img alt="첫째" src="CID:first@example.invalid">'
        '<img src="cid:second@example.invalid">'
        '<img src="cid:first@example.invalid">'
    )

    assert extract_cid_references(None) == set()
    assert extract_cid_references(html) == {
        "first@example.invalid",
        "second@example.invalid",
    }


def test_service_boundary_trusts_only_canonical_resolved_inline_ids() -> None:
    """Trusting a request-only CID instead of resolved metadata must fail this test."""
    html = '<p><img src="cid:canonical@example.invalid" alt="사진"></p>'
    resolved = [
        {
            "content_disposition": "inline",
            "content_id": "canonical@example.invalid",
        }
    ]

    cleaned = MailMessengerService._sanitize_resolved_body_html(html, resolved)

    assert extract_cid_references(cleaned) == {"canonical@example.invalid"}
    with pytest.raises(ValueError):
        MailMessengerService._sanitize_resolved_body_html(html, [])
    with pytest.raises(ValueError):
        MailMessengerService._sanitize_resolved_body_html(
            html,
            [
                {
                    "content_disposition": "attachment",
                    "content_id": "canonical@example.invalid",
                }
            ],
        )


class _NoDatabaseAccess:
    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self):
        raise AssertionError("unsafe HTML reached the database boundary")


class _AttachmentStorageWithoutCanonicalCid:
    def resolve(self, actor, attachment: MailAttachmentMeta) -> dict:
        return {
            "upload_id": attachment.uploadId,
            "file_name": attachment.fileName,
            "content_type": attachment.contentType,
            "size_bytes": attachment.sizeBytes,
            "storage_key": f"mail/uploads/{attachment.uploadId}.bin",
        }


def test_save_boundary_rejects_request_only_cid_before_database_access() -> None:
    """Using the request CID when storage has not resolved it must fail this test."""
    service = MailMessengerService.__new__(MailMessengerService)
    service.db = _NoDatabaseAccess()
    service.attachment_storage = _AttachmentStorageWithoutCanonicalCid()
    payload = MailDraftRequest(
        subject="초안",
        bodyText="사진",
        bodyHtml='<p><img src="cid:request-only@example.invalid" alt="사진"></p>',
        attachments=[
            MailAttachmentMeta(
                uploadId="a" * 32,
                fileName="photo.png",
                contentType="image/png",
                sizeBytes=4,
                disposition="inline",
                contentId="request-only@example.invalid",
            )
        ],
    )

    with pytest.raises(ValueError):
        service._save_mail(service, payload, status_value="draft")


def test_scheduled_update_rejects_unsafe_html_before_database_access() -> None:
    """Persisting unsafe HTML from scheduled-mail updates must fail this test."""
    service = MailMessengerService.__new__(MailMessengerService)
    service.db = _NoDatabaseAccess()
    payload = type(
        "ScheduledPayload",
        (),
        {
            "to": ["to@example.invalid"],
            "cc": [],
            "bcc": [],
            "bodyHtml": '<a href="javascript:alert(1)">위험</a>',
        },
    )()

    with pytest.raises(ValueError):
        service.update_scheduled_mail(service, "mail-1", payload)


def test_none_and_plain_text_only_html_keep_existing_contract() -> None:
    """Breaking optional HTML or stripping safe text must fail this test."""
    assert sanitize_mail_html(None, set()) is None
    assert sanitize_mail_html("<div>기존 본문</div>", set()) == "기존 본문"
