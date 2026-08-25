from __future__ import annotations

from html.parser import HTMLParser
import re
from urllib.parse import urlsplit

import nh3


ALLOWED_TAGS = {
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "span",
    "h1",
    "h2",
    "h3",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
}
ALLOWED_STYLES = {
    "font-family",
    "font-size",
    "line-height",
    "color",
    "background-color",
    "text-align",
}

_ACTIVE_TAGS = {
    "applet",
    "audio",
    "base",
    "button",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "math",
    "meta",
    "object",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "textarea",
    "video",
}
_ATTRIBUTES = {
    "a": {"href"},
    "img": {"src", "alt", "width", "height"},
    "p": {"style"},
    "span": {"style"},
    "h1": {"style"},
    "h2": {"style"},
    "h3": {"style"},
    "th": {"style", "colspan", "rowspan"},
    "td": {"style", "colspan", "rowspan"},
}
_STYLE_ORDER = (
    "font-family",
    "font-size",
    "line-height",
    "color",
    "background-color",
    "text-align",
)
_FONT_FAMILIES = {
    "맑은 고딕": "'맑은 고딕'",
    "arial": "Arial",
    "georgia": "Georgia",
    "times new roman": "'Times New Roman'",
    "monospace": "monospace",
}
_FONT_SIZES = {"10px", "12px", "14px", "16px", "18px", "24px", "32px"}
_LINE_HEIGHTS = {"1", "1.15", "1.5", "1.75", "2"}
_TEXT_ALIGNMENTS = {"left", "center", "right", "justify"}
_CID_SOURCE = re.compile(r"^cid:([A-Za-z0-9][A-Za-z0-9._%+@-]{0,254})$", re.IGNORECASE)
_CONTENT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._%+@-]{0,254}$")
_HEX_COLOR = re.compile(r"^#[0-9a-f]{3}(?:[0-9a-f]{3})?$", re.IGNORECASE)
_RGB_COLOR = re.compile(
    r"^rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)$",
    re.IGNORECASE,
)
_UNSAFE_STYLE = re.compile(
    r"url\(|expression\(|var\(|--|@import|behavior|binding|/\*|\*/|\\",
    re.IGNORECASE,
)
_MAX_MAIL_HTML_BYTES = 1_048_576


def _content_id_from_source(source: str | None) -> str | None:
    if not isinstance(source, str):
        return None
    matched = _CID_SOURCE.fullmatch(source.strip())
    return matched.group(1) if matched else None


class _CidReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: set[str] = set()

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.lower() != "img":
            return
        for name, value in attrs:
            if name.lower() != "src":
                continue
            content_id = _content_id_from_source(value)
            if content_id is not None:
                self.references.add(content_id)

    handle_startendtag = handle_starttag


class _MailHtmlSecurityScanner(_CidReferenceParser):
    def handle_decl(self, decl: str) -> None:
        raise ValueError("메일 HTML에 선언을 포함할 수 없습니다.")

    def unknown_decl(self, data: str) -> None:
        raise ValueError("메일 HTML에 marked section을 포함할 수 없습니다.")

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in _ACTIVE_TAGS:
            raise ValueError("메일 HTML에 실행 가능한 요소를 포함할 수 없습니다.")

        for name, value in attrs:
            normalized_name = name.lower()
            if normalized_name.startswith("on"):
                raise ValueError("메일 HTML에 이벤트 처리기를 포함할 수 없습니다.")
            if normalized_name == "style" and _contains_unsafe_style(value or ""):
                raise ValueError("메일 HTML에 위험한 스타일을 포함할 수 없습니다.")

        if normalized_tag == "img":
            sources = [value for name, value in attrs if name.lower() == "src"]
            if len(sources) > 1:
                raise ValueError("메일 본문 이미지 주소가 중복되었습니다.")
            if sources:
                source = sources[0]
                if (
                    isinstance(source, str)
                    and source.strip().lower().startswith("cid:")
                    and _content_id_from_source(source) is None
                ):
                    raise ValueError("메일 본문 이미지 CID 형식이 올바르지 않습니다.")

        if normalized_tag == "a":
            for name, value in attrs:
                if name.lower() == "href" and not _is_safe_link(value):
                    raise ValueError("메일 링크 주소 형식이 안전하지 않습니다.")

        super().handle_starttag(normalized_tag, attrs)

    handle_startendtag = handle_starttag


class _NonCidImageRemovingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.lower() == "img":
            sources = [value for name, value in attrs if name.lower() == "src"]
            if len(sources) != 1 or _content_id_from_source(sources[0]) is None:
                return
        self.parts.append(self.get_starttag_text())

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")


def _contains_unsafe_style(value: str) -> bool:
    compact = re.sub(r"[\x00-\x20]+", "", value)
    return bool(_UNSAFE_STYLE.search(compact))


def _validate_html_size(html: str) -> None:
    if len(html.encode("utf-8")) > _MAX_MAIL_HTML_BYTES:
        raise ValueError("메일 HTML 크기는 UTF-8 기준 1 MiB 이하여야 합니다.")


def _validate_html_comments(html: str) -> None:
    offset = 0
    while True:
        opening = html.find("<!--", offset)
        closing = html.find("-->", offset)
        if opening < 0:
            if closing >= 0:
                raise ValueError("메일 HTML 주석 형식이 올바르지 않습니다.")
            return
        if 0 <= closing < opening:
            raise ValueError("메일 HTML 주석 형식이 올바르지 않습니다.")

        content_start = opening + 4
        if html.startswith(">", content_start) or html.startswith("->", content_start):
            raise ValueError("메일 HTML 주석 형식이 올바르지 않습니다.")

        closing = html.find("-->", content_start)
        if closing < 0:
            raise ValueError("메일 HTML 주석 형식이 올바르지 않습니다.")
        comment = html[content_start:closing]
        if "<!--" in comment or "--" in comment:
            raise ValueError("메일 HTML 주석 형식이 올바르지 않습니다.")
        offset = closing + 3


def _validate_html_declarations(html: str) -> None:
    state = "data"
    offset = 0
    while offset < len(html):
        if state == "comment":
            if html.startswith("-->", offset):
                state = "data"
                offset += 3
                continue
            offset += 1
            continue

        if state == "single-quoted-attribute":
            if html[offset] == "'":
                state = "tag"
            offset += 1
            continue

        if state == "double-quoted-attribute":
            if html[offset] == '"':
                state = "tag"
            offset += 1
            continue

        if state == "data":
            if html.startswith("<!--", offset):
                state = "comment"
                offset += 4
                continue
            if html.startswith("<!", offset):
                raise ValueError("메일 HTML에 선언을 포함할 수 없습니다.")
            if html[offset] == "<":
                tag_name_offset = offset + 1
                is_end_tag = (
                    tag_name_offset < len(html)
                    and html[tag_name_offset] == "/"
                )
                if is_end_tag:
                    tag_name_offset += 1
                if (
                    tag_name_offset < len(html)
                    and html[tag_name_offset].isascii()
                    and html[tag_name_offset].isalpha()
                ):
                    state = "end-tag" if is_end_tag else "tag"
            offset += 1
            continue

        if html.startswith("<!", offset):
            raise ValueError("메일 HTML에 선언을 포함할 수 없습니다.")
        if html[offset] == ">":
            state = "data"
        elif state == "tag" and html[offset] == "=":
            state = "before-attribute-value"
        elif state == "before-attribute-value":
            if html[offset].isspace():
                pass
            elif html[offset] == "'":
                state = "single-quoted-attribute"
            elif html[offset] == '"':
                state = "double-quoted-attribute"
            else:
                state = "unquoted-attribute"
        elif state == "unquoted-attribute" and html[offset].isspace():
            state = "tag"
        offset += 1

    if state != "data":
        raise ValueError("메일 HTML 태그 형식이 올바르지 않습니다.")


def _remove_non_cid_images(html: str) -> str:
    parser = _NonCidImageRemovingParser()
    parser.feed(html)
    parser.close()
    return "".join(parser.parts)


def _is_safe_link(value: str | None) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.strip()
    if not normalized or re.search(r"[\x00-\x1f\x7f]", normalized):
        return False
    parsed = urlsplit(normalized)
    scheme = parsed.scheme.lower()
    if scheme in {"http", "https"}:
        return bool(parsed.netloc)
    if scheme == "mailto":
        return bool(parsed.path)
    return False


def _normalize_color(value: str) -> str | None:
    normalized = value.strip().lower()
    if _HEX_COLOR.fullmatch(normalized):
        return normalized
    matched = _RGB_COLOR.fullmatch(normalized)
    if matched is None:
        return None
    channels = tuple(int(channel) for channel in matched.groups())
    if any(channel > 255 for channel in channels):
        return None
    return f"rgb({channels[0]},{channels[1]},{channels[2]})"


def _normalize_style_value(property_name: str, value: str) -> str | None:
    normalized = value.strip()
    if property_name == "font-family":
        family = normalized.strip("\"'").strip().lower()
        return _FONT_FAMILIES.get(family)
    if property_name == "font-size":
        lowered = normalized.lower()
        return lowered if lowered in _FONT_SIZES else None
    if property_name == "line-height":
        return normalized if normalized in _LINE_HEIGHTS else None
    if property_name in {"color", "background-color"}:
        return _normalize_color(normalized)
    if property_name == "text-align":
        lowered = normalized.lower()
        return lowered if lowered in _TEXT_ALIGNMENTS else None
    return None


def _normalize_style(value: str) -> str | None:
    normalized: dict[str, str] = {}
    for declaration in value.split(";"):
        if ":" not in declaration:
            continue
        property_name, property_value = declaration.split(":", 1)
        property_name = property_name.strip().lower()
        if property_name not in ALLOWED_STYLES:
            continue
        safe_value = _normalize_style_value(property_name, property_value)
        if safe_value is not None:
            normalized[property_name] = safe_value
    if not normalized:
        return None
    return ";".join(
        f"{property_name}:{normalized[property_name]}"
        for property_name in _STYLE_ORDER
        if property_name in normalized
    )


def _normalize_positive_integer(value: str, *, maximum: int) -> str | None:
    if not value.strip().isdigit():
        return None
    normalized = int(value)
    if not 1 <= normalized <= maximum:
        return None
    return str(normalized)


def _filter_attribute(tag: str, attribute: str, value: str) -> str | None:
    if attribute == "style":
        return _normalize_style(value)
    if attribute == "href":
        return value.strip() if _is_safe_link(value) else None
    if tag == "img" and attribute == "src":
        content_id = _content_id_from_source(value)
        return f"cid:{content_id}" if content_id is not None else None
    if tag == "img" and attribute in {"width", "height"}:
        return _normalize_positive_integer(value, maximum=4096)
    if tag in {"th", "td"} and attribute in {"colspan", "rowspan"}:
        return _normalize_positive_integer(value, maximum=100)
    return value


def _extract_cid_references(html: str) -> set[str]:
    parser = _CidReferenceParser()
    parser.feed(html)
    parser.close()
    return parser.references


def extract_cid_references(html: str | None) -> set[str]:
    """Extract inline image content IDs from an HTML fragment."""
    if html is None:
        return set()
    if not isinstance(html, str):
        raise ValueError("메일 HTML 형식이 올바르지 않습니다.")
    _validate_html_size(html)
    return _extract_cid_references(html)


def sanitize_mail_html(
    html: str | None,
    allowed_content_ids: set[str],
) -> str | None:
    """Return sanitized outbound mail HTML with complete CID references."""
    if not isinstance(allowed_content_ids, set) or any(
        not isinstance(content_id, str) or not _CONTENT_ID.fullmatch(content_id)
        for content_id in allowed_content_ids
    ):
        raise ValueError("허용된 콘텐츠 ID 형식이 올바르지 않습니다.")
    if html is None:
        if allowed_content_ids:
            raise ValueError("본문에서 참조하지 않은 인라인 이미지가 있습니다.")
        return None
    if not isinstance(html, str):
        raise ValueError("메일 HTML 형식이 올바르지 않습니다.")
    _validate_html_size(html)
    _validate_html_comments(html)
    _validate_html_declarations(html)

    scanner = _MailHtmlSecurityScanner()
    scanner.feed(html)
    scanner.close()
    if scanner.references != allowed_content_ids:
        raise ValueError("본문 CID와 인라인 이미지가 일치하지 않습니다.")

    cleaned = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        clean_content_tags=_ACTIVE_TAGS,
        attributes=_ATTRIBUTES,
        attribute_filter=_filter_attribute,
        strip_comments=True,
        link_rel="noopener noreferrer",
        url_schemes={"http", "https", "mailto", "cid"},
        filter_style_properties=ALLOWED_STYLES,
        url_relative="deny",
    )
    cleaned = _remove_non_cid_images(cleaned)
    if _extract_cid_references(cleaned) != allowed_content_ids:
        raise ValueError("정화된 본문 CID와 인라인 이미지가 일치하지 않습니다.")
    return cleaned
