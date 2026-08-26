from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from io import BytesIO
import json
from pathlib import Path
import re
import warnings
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import settings
from app.schemas.directory import AuthUserSummary
from app.schemas.mail_messenger import MailAttachmentMeta, MailAttachmentUploadResponse


_UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
_INLINE_IMAGE_MAX_DIMENSION = 4096
_INLINE_IMAGE_TYPES = {
    "PNG": {"extensions": {".png"}, "content_type": "image/png"},
    "JPEG": {"extensions": {".jpg", ".jpeg"}, "content_type": "image/jpeg"},
    "WEBP": {"extensions": {".webp"}, "content_type": "image/webp"},
}


class MailAttachmentStorage:
    def __init__(self, root: Path | None = None, *, max_file_bytes: int | None = None) -> None:
        self.root = (root or settings.storage_path).resolve()
        self.upload_root = self.root / "mail" / "uploads"
        self.max_file_bytes = max_file_bytes or settings.mail_attachment_max_file_bytes

    def stage(self, actor: AuthUserSummary, file_name: str, content_type: str, content: bytes) -> MailAttachmentUploadResponse:
        safe_name = self._safe_file_name(file_name)
        return self._write_stage(
            actor,
            safe_name,
            content_type or "application/octet-stream",
            content,
            max_bytes=self.max_file_bytes,
            content_disposition="attachment",
            content_id=None,
        )

    def stage_inline_image(
        self,
        actor: AuthUserSummary,
        file_name: str,
        content_type: str,
        content: bytes,
    ) -> MailAttachmentUploadResponse:
        if not content:
            raise ValueError("빈 이미지는 첨부할 수 없습니다.")
        if len(content) > _INLINE_IMAGE_MAX_BYTES:
            raise ValueError("본문 이미지 한 개의 최대 크기를 초과했습니다.")
        safe_name = self._safe_file_name(file_name)
        image_format = self._validate_inline_image_contract(safe_name, content_type, content)
        normalized = self._normalize_inline_image(content, image_format)
        normalized_content_type = str(_INLINE_IMAGE_TYPES[image_format]["content_type"])
        content_id = f"mw-{uuid4().hex}@moaworks.invalid"
        return self._write_stage(
            actor,
            safe_name,
            normalized_content_type,
            normalized,
            max_bytes=_INLINE_IMAGE_MAX_BYTES,
            content_disposition="inline",
            content_id=content_id,
        )

    def _write_stage(
        self,
        actor: AuthUserSummary,
        safe_name: str,
        content_type: str,
        content: bytes,
        *,
        max_bytes: int | None,
        content_disposition: str,
        content_id: str | None,
    ) -> MailAttachmentUploadResponse:
        if not content:
            raise ValueError("빈 파일은 첨부할 수 없습니다.")
        if max_bytes is not None and len(content) > max_bytes:
            raise ValueError("첨부 파일 한 개의 최대 크기를 초과했습니다.")
        upload_id = uuid4().hex
        self.upload_root.mkdir(parents=True, exist_ok=True)
        data_path = self._data_path(upload_id)
        metadata_path = self._metadata_path(upload_id)
        data_path.write_bytes(content)
        content_sha256 = sha256(content).hexdigest()
        metadata = {
            "uploadId": upload_id,
            "ownerCompanyId": actor.companyId,
            "ownerUserId": actor.userId,
            "fileName": safe_name,
            "contentType": content_type or "application/octet-stream",
            "sizeBytes": len(content),
            "storageKey": self._storage_key(upload_id),
            "attached": False,
            "createdAt": datetime.now(UTC).isoformat(),
            "content_disposition": content_disposition,
            "content_id": content_id,
            "normalized_content_type": content_type,
            "normalized_size_bytes": len(content),
            "sha256": content_sha256,
        }
        try:
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        except Exception:
            data_path.unlink(missing_ok=True)
            raise
        return MailAttachmentUploadResponse(
            uploadId=upload_id,
            fileName=safe_name,
            contentType=metadata["contentType"],
            sizeBytes=len(content),
            disposition=content_disposition,
            contentId=content_id,
            previewPath=(
                f"/mail/attachments/staged/{upload_id}/preview"
                if content_disposition == "inline"
                else None
            ),
        )

    def resolve(self, actor: AuthUserSummary, attachment: MailAttachmentMeta) -> dict:
        upload_id = attachment.uploadId or self._upload_id_from_storage_key(attachment.storageKey)
        metadata = self._load_metadata(upload_id)
        if metadata["ownerCompanyId"] != actor.companyId or metadata["ownerUserId"] != actor.userId:
            raise PermissionError("첨부 업로드에 접근할 권한이 없습니다.")
        if metadata.get("attached"):
            raise ValueError("이미 사용된 첨부 업로드입니다.")
        content_disposition = metadata.get("content_disposition", "attachment")
        content_id = metadata.get("content_id")
        data, content_sha256 = self._read_verified_upload(
            upload_id,
            metadata,
            require_sha256=content_disposition == "inline",
        )
        canonical_content_type = metadata.get("normalized_content_type", metadata["contentType"])
        canonical_size = int(metadata.get("normalized_size_bytes", metadata["sizeBytes"]))
        requested = (
            attachment.fileName,
            attachment.contentType,
            attachment.sizeBytes,
            attachment.disposition,
        )
        canonical = (
            metadata["fileName"],
            canonical_content_type,
            canonical_size,
            content_disposition,
        )
        if requested != canonical:
            raise ValueError("첨부 파일 정보가 업로드 결과와 일치하지 않습니다.")
        return {
            "upload_id": upload_id,
            "file_name": metadata["fileName"],
            "content_type": canonical_content_type,
            "size_bytes": len(data),
            "storage_key": metadata["storageKey"],
            "content_disposition": content_disposition,
            "content_id": content_id,
            "sha256": content_sha256,
        }

    def open_staged_preview(self, actor: AuthUserSummary, upload_id: str) -> dict:
        metadata = self._load_metadata(upload_id)
        if metadata.get("ownerCompanyId") != actor.companyId or metadata.get("ownerUserId") != actor.userId:
            raise PermissionError("본문 이미지 미리보기에 접근할 권한이 없습니다.")
        if metadata.get("content_disposition") != "inline" or not metadata.get("content_id"):
            raise PermissionError("본문 이미지 미리보기에 접근할 권한이 없습니다.")
        content, _content_sha256 = self._read_verified_upload(upload_id, metadata, require_sha256=True)
        return self._preview_payload(metadata, content)

    def open_persisted_preview(
        self,
        actor: AuthUserSummary,
        mail_id: str,
        attachment_id: str,
        db,
    ) -> dict:
        db.ensure_migrations_applied()
        with db.connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT DISTINCT a.file_name, a.content_type, a.size_bytes, a.storage_key
                    FROM mail_attachments a
                    JOIN mail_messages m ON a.message_id = m.id
                    LEFT JOIN mail_recipients r ON r.message_id = m.id
                    WHERE a.id = %s
                      AND a.message_id = %s
                      AND m.company_id = %s
                      AND a.content_disposition = 'inline'
                      AND a.content_id IS NOT NULL
                      AND (
                        (m.sender_user_id = %s AND m.sender_purged_at IS NULL)
                        OR (
                          (r.recipient_user_id = %s OR LOWER(r.recipient_email) = %s)
                          AND r.purged_at IS NULL
                        )
                      )
                    """,
                    (
                        attachment_id,
                        mail_id,
                        actor.companyId,
                        actor.userId,
                        actor.userId,
                        actor.userEmail.lower(),
                    ),
                )
                row = cursor.fetchone()
        if row is None:
            raise PermissionError("본문 이미지 미리보기에 접근할 권한이 없습니다.")
        try:
            upload_id = self._upload_id_from_storage_key(row["storage_key"])
            metadata = self._load_metadata(upload_id)
            canonical = (
                metadata["fileName"],
                metadata.get("normalized_content_type", metadata["contentType"]),
                int(metadata.get("normalized_size_bytes", metadata["sizeBytes"])),
            )
            persisted = (row["file_name"], row["content_type"], int(row["size_bytes"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("본문 이미지 저장 상태가 올바르지 않습니다.") from exc
        if metadata.get("content_disposition") != "inline" or canonical != persisted:
            raise ValueError("본문 이미지 저장 상태가 올바르지 않습니다.")
        content, _content_sha256 = self._read_verified_upload(upload_id, metadata, require_sha256=True)
        return self._preview_payload(metadata, content)

    def clone(
        self,
        actor: AuthUserSummary,
        *,
        storage_key: str,
        file_name: str,
        content_type: str,
        size_bytes: int,
    ) -> dict:
        source_path = self.stored_path(storage_key)
        if source_path.stat().st_size != size_bytes:
            raise ValueError("원문 첨부 파일 저장 상태가 올바르지 않습니다.")
        uploaded = self.stage(actor, file_name, content_type, source_path.read_bytes())
        return self.resolve(
            actor,
            MailAttachmentMeta(
                uploadId=uploaded.uploadId,
                fileName=uploaded.fileName,
                contentType=uploaded.contentType,
                sizeBytes=uploaded.sizeBytes,
            ),
        )

    def mark_attached(self, upload_id: str) -> None:
        metadata = self._load_metadata(upload_id)
        metadata["attached"] = True
        metadata["attachedAt"] = datetime.now(UTC).isoformat()
        self._metadata_path(upload_id).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")

    def stored_path(self, storage_key: str) -> Path:
        upload_match = re.fullmatch(r"mail/uploads/([0-9a-f]{32})\.bin", storage_key or "")
        inbound_match = re.fullmatch(
            r"mail/inbound/([0-9a-f]{2})/([0-9a-f]{64})/attachment-([0-9]+)\.bin",
            storage_key or "",
        )
        if upload_match:
            path = self._data_path(upload_match.group(1)).resolve()
            allowed_root = self.upload_root.resolve()
        elif inbound_match and inbound_match.group(1) == inbound_match.group(2)[:2]:
            path = (self.root / storage_key).resolve()
            allowed_root = (self.root / "mail" / "inbound").resolve()
        else:
            raise ValueError("첨부 저장 식별자가 올바르지 않습니다.")
        if allowed_root not in path.parents or not path.is_file():
            raise ValueError("첨부 파일을 찾을 수 없습니다.")
        return path

    @staticmethod
    def _validate_inline_image_contract(file_name: str, content_type: str, content: bytes) -> str:
        extension = Path(file_name).suffix.lower()
        declared_content_type = (content_type or "").strip().lower()
        expected_format = next(
            (
                image_format
                for image_format, contract in _INLINE_IMAGE_TYPES.items()
                if extension in contract["extensions"]
            ),
            None,
        )
        detected_format = MailAttachmentStorage._detect_inline_image_magic(content)
        if expected_format is None:
            raise ValueError("허용되지 않는 본문 이미지 형식입니다.")
        expected_content_type = _INLINE_IMAGE_TYPES[expected_format]["content_type"]
        if declared_content_type != expected_content_type or detected_format != expected_format:
            raise ValueError("본문 이미지 형식 정보가 실제 파일과 일치하지 않습니다.")
        return expected_format

    @staticmethod
    def _detect_inline_image_magic(content: bytes) -> str | None:
        if content.startswith(b"\x89PNG\r\n\x1a\n"):
            return "PNG"
        if content.startswith(b"\xff\xd8\xff"):
            return "JPEG"
        if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
            return "WEBP"
        return None

    @staticmethod
    def _normalize_inline_image(content: bytes, expected_format: str) -> bytes:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as verified:
                    if verified.format != expected_format:
                        raise ValueError("본문 이미지 decode 형식이 일치하지 않습니다.")
                    verified.verify()
                with Image.open(BytesIO(content)) as decoded:
                    if decoded.format != expected_format or getattr(decoded, "is_animated", False):
                        raise ValueError("본문 이미지 decode 형식이 올바르지 않습니다.")
                    MailAttachmentStorage._validate_inline_image_dimensions(decoded)
                    decoded.load()
                    transposed = ImageOps.exif_transpose(decoded)
                    try:
                        MailAttachmentStorage._validate_inline_image_dimensions(transposed)
                        has_alpha = "A" in transposed.getbands() or "transparency" in transposed.info
                        if expected_format == "JPEG":
                            safe_image = transposed.convert("RGB")
                            save_options = {"quality": 95, "optimize": True}
                        else:
                            safe_image = transposed.convert("RGBA" if has_alpha else "RGB")
                            save_options = {"optimize": True} if expected_format == "PNG" else {"quality": 90, "method": 4}
                        output = BytesIO()
                        try:
                            safe_image.save(output, format=expected_format, **save_options)
                        finally:
                            safe_image.close()
                    finally:
                        transposed.close()
            normalized = output.getvalue()
            with Image.open(BytesIO(normalized)) as result:
                if result.format != expected_format:
                    raise ValueError("본문 이미지 재인코딩 결과가 올바르지 않습니다.")
                result.verify()
            return normalized
        except (
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            UnidentifiedImageError,
            OSError,
            SyntaxError,
        ) as exc:
            raise ValueError("본문 이미지 파일을 안전하게 해석할 수 없습니다.") from exc

    @staticmethod
    def _validate_inline_image_dimensions(image: Image.Image) -> None:
        width, height = image.size
        if not (1 <= width <= _INLINE_IMAGE_MAX_DIMENSION):
            raise ValueError("본문 이미지 너비 제한을 초과했습니다.")
        if not (1 <= height <= _INLINE_IMAGE_MAX_DIMENSION):
            raise ValueError("본문 이미지 높이 제한을 초과했습니다.")

    def _read_verified_upload(
        self,
        upload_id: str,
        metadata: dict,
        *,
        require_sha256: bool,
    ) -> tuple[bytes, str]:
        try:
            expected_size = int(metadata.get("normalized_size_bytes", metadata["sizeBytes"]))
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.") from exc
        data_path = self._data_path(upload_id).resolve()
        allowed_root = self.upload_root.resolve()
        if allowed_root not in data_path.parents or not data_path.is_file():
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        try:
            content = data_path.read_bytes()
        except OSError as exc:
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.") from exc
        if len(content) != expected_size:
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        actual_sha256 = sha256(content).hexdigest()
        expected_sha256 = metadata.get("sha256")
        if require_sha256 and not isinstance(expected_sha256, str):
            raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        if expected_sha256 is not None:
            if not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256):
                raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
            if not compare_digest(expected_sha256, actual_sha256):
                raise ValueError("첨부 파일 저장 상태가 올바르지 않습니다.")
        return content, actual_sha256

    @staticmethod
    def _preview_payload(metadata: dict, content: bytes) -> dict:
        try:
            content_type = metadata["normalized_content_type"]
            size_bytes = int(metadata["normalized_size_bytes"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("본문 이미지 저장 상태가 올바르지 않습니다.") from exc
        if content_type not in {"image/png", "image/jpeg", "image/webp"} or size_bytes != len(content):
            raise ValueError("본문 이미지 저장 상태가 올바르지 않습니다.")
        return {
            "content": content,
            "contentType": content_type,
            "sizeBytes": size_bytes,
        }

    def cleanup_expired(self, *, older_than: timedelta = timedelta(hours=24)) -> int:
        if not self.upload_root.exists():
            return 0
        threshold = datetime.now(UTC) - older_than
        removed = 0
        for metadata_path in self.upload_root.glob("*.json"):
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                created_at = datetime.fromisoformat(metadata["createdAt"])
                if metadata.get("attached") or created_at >= threshold:
                    continue
                upload_id = metadata["uploadId"]
                self._data_path(upload_id).unlink(missing_ok=True)
                metadata_path.unlink(missing_ok=True)
                removed += 1
            except (KeyError, ValueError, OSError, json.JSONDecodeError):
                continue
        return removed

    def _load_metadata(self, upload_id: str) -> dict:
        self._validate_upload_id(upload_id)
        try:
            return json.loads(self._metadata_path(upload_id).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("첨부 업로드를 찾을 수 없습니다.") from exc

    def _data_path(self, upload_id: str) -> Path:
        self._validate_upload_id(upload_id)
        return self.upload_root / f"{upload_id}.bin"

    def _metadata_path(self, upload_id: str) -> Path:
        self._validate_upload_id(upload_id)
        return self.upload_root / f"{upload_id}.json"

    @staticmethod
    def _validate_upload_id(upload_id: str) -> None:
        if not _UPLOAD_ID.fullmatch(upload_id):
            raise ValueError("첨부 업로드 식별자가 올바르지 않습니다.")

    @staticmethod
    def _storage_key(upload_id: str) -> str:
        return f"mail/uploads/{upload_id}.bin"

    @staticmethod
    def _upload_id_from_storage_key(storage_key: str | None) -> str:
        if not storage_key:
            raise ValueError("실제 업로드된 첨부만 사용할 수 있습니다.")
        matched = re.fullmatch(r"mail/uploads/([0-9a-f]{32})\.bin", storage_key)
        if not matched:
            raise ValueError("첨부 저장 식별자가 올바르지 않습니다.")
        return matched.group(1)

    @staticmethod
    def _safe_file_name(file_name: str) -> str:
        normalized = Path((file_name or "attachment.bin").replace("\\", "/")).name
        normalized = "".join(character for character in normalized if ord(character) >= 32).strip()
        return (normalized or "attachment.bin")[:255]
