from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.schemas.mail_messenger import (
    MailAttachmentMeta,
    MailDraftRequest,
    MailSendRequest,
)
from app.services import mail_html_sanitizer as sanitizer_module
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
        '<span style="background:url(https://tracker.example/x)">본문</span>',
        '<span style="background-image:u/**/rl(https://tracker.example/x)">본문</span>',
        '<span style="color:var(--mail-color)">본문</span>',
        '<a href="javascript:alert(1)">링크</a>',
        '<a href="java&#x0a;script:alert(1)">링크</a>',
    ],
)
def test_active_or_unsafe_content_is_rejected(html: str) -> None:
    """Allowing active elements, handlers, CSS, or links must fail this test."""
    with pytest.raises(ValueError):
        sanitize_mail_html(html, set())


@pytest.mark.parametrize(
    "html",
    [
        "<!--><script>alert(1)</script>-->",
        "<!--><img src=x onerror=alert(1)>-->",
        '<!--><span style="background:url(https://tracker.example/x)">본문</span>-->',
        '<!--><a href="javascript:alert(1)">링크</a>-->',
    ],
)
def test_malformed_comment_cannot_hide_active_content(html: str) -> None:
    """Parser disagreement accepting hidden active content must fail this test."""
    with pytest.raises(ValueError):
        sanitize_mail_html(html, set())


@pytest.mark.parametrize(
    "html",
    [
        "<![CDATA[<script>alert(1)</script>]]>",
        "<![CDATA[<img src=x onerror=alert(1)>]]>",
        '<![CDATA[<span style="background:url(https://tracker.example/x)">본문</span>]]>',
        '<![CDATA[<a href="javascript:alert(1)">링크</a>]]>',
    ],
)
def test_marked_section_cannot_hide_active_content(html: str) -> None:
    """Accepting declarations that expose active markup in nh3 must fail."""
    with pytest.raises(ValueError):
        sanitize_mail_html(html, set())


def test_declaration_is_rejected() -> None:
    """Accepting declarations outside the supported fragment grammar must fail."""
    with pytest.raises(ValueError):
        sanitize_mail_html("<!DOCTYPE html><p>본문</p>", set())


@pytest.mark.parametrize(
    "html",
    [
        '<!ENTITY x "ok"><p>tail</p>',
        '<!entity x "ok"><p>tail</p>',
        "<!foo><p>tail</p>",
        "<! foo><p>tail</p>",
        "<![if IE]><p>tail</p><![endif]>",
        "<![IF IE]><p>tail</p><![ENDIF]>",
        "<![IGNORE[<script>alert(1)</script>]]>",
        "<! [ignore[<p>tail</p>]]>",
    ],
    ids=[
        "entity",
        "entity-lowercase",
        "bogus-name",
        "bogus-name-whitespace",
        "conditional",
        "conditional-uppercase",
        "ignore-section",
        "ignore-section-whitespace",
    ],
)
def test_bogus_declaration_families_are_rejected(
    html: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Treating a non-comment declaration as a harmless comment must fail."""
    def fail_if_parser_runs(*args: object, **kwargs: object) -> None:
        raise AssertionError("bogus declaration reached a parser")

    monkeypatch.setattr(sanitizer_module, "_MailHtmlSecurityScanner", fail_if_parser_runs)
    monkeypatch.setattr(sanitizer_module.nh3, "clean", fail_if_parser_runs)

    with pytest.raises(ValueError):
        sanitize_mail_html(html, set())


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        (
            '<img src="cid:x@example.invalid" alt="<!ENTITY x>">',
            '<img src="cid:x@example.invalid" alt="<!ENTITY x>">',
        ),
        (
            "<img src='cid:x@example.invalid' alt='<!entity x>'>",
            '<img src="cid:x@example.invalid" alt="<!entity x>">',
        ),
        (
            '<img alt="left < middle <!ENTITY x> > right" '
            'src="cid:x@example.invalid">',
            '<img alt="left < middle <!ENTITY x> > right" '
            'src="cid:x@example.invalid">',
        ),
    ],
    ids=["double-quoted", "single-quoted", "quoted-less-and-greater-than"],
)
def test_declaration_like_text_in_quoted_attributes_is_preserved(
    html: str,
    expected: str,
) -> None:
    """Treating quoted attribute text as document markup must fail this test."""
    cleaned = sanitize_mail_html(html, {"x@example.invalid"})

    assert cleaned == expected
    assert extract_cid_references(cleaned) == {"x@example.invalid"}


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("<!-- 정상 주석 --><p>본문</p>", "<p>본문</p>"),
        ("<!-- <!ENTITY x 'ok'> --><p>본문</p>", "<p>본문</p>"),
        ("<p>1 < 2! 안전</p>", "<p>1 &lt; 2! 안전</p>"),
        ("<p>기호 &lt;! 는 텍스트</p>", "<p>기호 &lt;! 는 텍스트</p>"),
    ],
    ids=[
        "comment",
        "declaration-text-in-comment",
        "raw-less-than",
        "escaped-less-than",
    ],
)
def test_valid_comments_and_plain_text_symbols_are_preserved(
    html: str,
    expected: str,
) -> None:
    """Rejecting valid comments or ordinary less-than text must fail."""
    assert sanitize_mail_html(html, set()) == expected


@pytest.mark.parametrize(
    "html",
    [
        "a" * 1_048_576,
        "가" * 349_525 + "a",
    ],
    ids=["ascii", "multibyte"],
)
def test_mail_html_accepts_exactly_one_mib_in_utf8_bytes(html: str) -> None:
    """Counting characters instead of UTF-8 bytes at the inclusive limit must fail."""
    cleaned = sanitize_mail_html(html, set())

    assert cleaned is not None
    assert len(cleaned.encode("utf-8")) == 1_048_576


def test_mail_html_accepts_one_mib_ampersand_input_before_entity_expansion() -> None:
    """Reapplying the raw input budget to nh3 entity expansion must fail."""
    html = "&" * 1_048_576

    cleaned = sanitize_mail_html(html, set())

    assert cleaned == "&amp;" * 1_048_576


@pytest.mark.parametrize(
    "html",
    [
        "a" * 1_048_577,
        "가" * 349_525 + "ab",
    ],
    ids=["ascii", "multibyte"],
)
def test_mail_html_rejects_one_mib_plus_one_utf8_byte(
    html: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Allowing a body one byte above the parser budget must fail this test."""
    def fail_if_parser_runs(*args: object, **kwargs: object) -> None:
        raise AssertionError("oversized input reached a parser")

    monkeypatch.setattr(sanitizer_module, "_MailHtmlSecurityScanner", fail_if_parser_runs)
    monkeypatch.setattr(sanitizer_module.nh3, "clean", fail_if_parser_runs)

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


def test_cid_image_with_quoted_greater_than_is_preserved() -> None:
    """Treating a quoted greater-than sign as the image boundary must fail."""
    cleaned = sanitize_mail_html(
        '<img alt="x > y" src="cid:image@example.invalid">',
        {"image@example.invalid"},
    )

    assert cleaned == '<img alt="x > y" src="cid:image@example.invalid">'
    assert extract_cid_references(cleaned) == {"image@example.invalid"}


def test_non_cid_image_with_quoted_greater_than_is_removed_without_tail() -> None:
    """Leaving an attribute tail after removing a non-CID image must fail."""
    cleaned = sanitize_mail_html(
        '<p>앞<img alt="x > y" src="https://tracker.example/x.png">뒤</p>',
        set(),
    )

    assert cleaned == "<p>앞뒤</p>"


@pytest.mark.parametrize(
    "source",
    [
        "https://tracker.example/x.png",
        "data:image/png;base64,AAAA",
        "/mail/image.png",
        "images/image.png",
    ],
)
def test_non_cid_images_are_removed_without_rejecting_safe_text(source: str) -> None:
    """Rejecting the whole forwarded body or retaining a non-CID image must fail."""
    cleaned = sanitize_mail_html(
        f'<blockquote><p>전달 앞<img src="{source}" alt="추적">전달 뒤</p></blockquote>',
        set(),
    )

    assert cleaned == "<blockquote><p>전달 앞전달 뒤</p></blockquote>"


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


class _DatabaseBoundaryReached(RuntimeError):
    pass


class _DatabaseBoundaryProbe:
    def ensure_migrations_applied(self) -> None:
        return None

    def connect(self):
        raise _DatabaseBoundaryReached("safe HTML reached the database boundary")


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


def test_safe_draft_forward_and_schedule_create_reach_database_boundary() -> None:
    """Rejecting safe existing compose flows after image removal must fail this test."""
    service = MailMessengerService.__new__(MailMessengerService)
    service.db = _DatabaseBoundaryProbe()
    service.attachment_storage = _AttachmentStorageWithoutCanonicalCid()
    safe_html = (
        '<blockquote><p>전달 앞<img src="https://tracker.example/x.png" alt="추적">'
        "전달 뒤</p></blockquote>"
    )
    payloads = [
        (
            MailDraftRequest(subject="초안", bodyText="본문", bodyHtml=safe_html),
            "draft",
        ),
        (
            MailDraftRequest(
                subject="Fwd: 제목",
                bodyText="전달 본문",
                bodyHtml=safe_html,
                composeAction="forward",
                sourceMailId="mailmsg_source",
            ),
            "draft",
        ),
        (
            MailSendRequest(
                to=["to@example.invalid"],
                subject="예약",
                bodyText="본문",
                bodyHtml=safe_html,
                scheduledAt=datetime.now(UTC) + timedelta(minutes=5),
            ),
            "scheduled",
        ),
    ]

    for payload, status_value in payloads:
        with pytest.raises(_DatabaseBoundaryReached):
            service._save_mail(service, payload, status_value=status_value)


def test_safe_scheduled_update_reaches_database_boundary() -> None:
    """Rejecting a safe scheduled update after remote image removal must fail."""
    service = MailMessengerService.__new__(MailMessengerService)
    service.db = _DatabaseBoundaryProbe()
    payload = type(
        "ScheduledPayload",
        (),
        {
            "to": ["to@example.invalid"],
            "cc": [],
            "bcc": [],
            "bodyHtml": '<p>앞<img src="data:image/png;base64,AAAA" alt="제거">뒤</p>',
        },
    )()

    with pytest.raises(_DatabaseBoundaryReached):
        service.update_scheduled_mail(service, "mail-1", payload)


@pytest.mark.parametrize(
    ("payload", "status_value"),
    [
        (
            MailDraftRequest(
                subject="초안",
                bodyText="본문",
                bodyHtml="<!--><script>alert(1)</script>-->",
            ),
            "draft",
        ),
        (
            MailDraftRequest(
                subject="Fwd: 제목",
                bodyText="전달 본문",
                bodyHtml="<!--><img src=x onerror=alert(1)>-->",
                composeAction="forward",
                sourceMailId="mailmsg_source",
            ),
            "draft",
        ),
        (
            MailSendRequest(
                to=["to@example.invalid"],
                subject="예약",
                bodyText="본문",
                bodyHtml='<!--><a href="javascript:alert(1)">링크</a>-->',
                scheduledAt=datetime.now(UTC) + timedelta(minutes=5),
            ),
            "scheduled",
        ),
    ],
)
def test_active_html_is_rejected_before_draft_forward_or_schedule_storage(
    payload: MailDraftRequest | MailSendRequest,
    status_value: str,
) -> None:
    """Letting malformed active HTML reach any create storage path must fail."""
    service = MailMessengerService.__new__(MailMessengerService)
    service.db = _NoDatabaseAccess()
    service.attachment_storage = _AttachmentStorageWithoutCanonicalCid()

    with pytest.raises(ValueError):
        service._save_mail(service, payload, status_value=status_value)


def test_none_and_plain_text_only_html_keep_existing_contract() -> None:
    """Breaking optional HTML or stripping safe text must fail this test."""
    assert sanitize_mail_html(None, set()) is None
    assert sanitize_mail_html("<div>기존 본문</div>", set()) == "기존 본문"
