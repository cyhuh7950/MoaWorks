from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
import unittest

from fastapi import HTTPException


ROOT = Path(__file__).resolve().parent


class Stage02ResourcePolicyTest(unittest.TestCase):
    def test_domain_routes_map_hidden_or_missing_resources_to_404(self) -> None:
        from app.api.routes.admin import _delivery_error
        from app.api.routes.mail import _handle_error as handle_mail_error
        from app.api.routes.messenger import _handle_error as handle_messenger_error
        from app.services.resource_policy import ResourceNotFoundError

        cases = (
            (handle_mail_error, "MAIL_NOT_FOUND"),
            (handle_messenger_error, "MESSENGER_NOT_FOUND"),
            (_delivery_error, "MAIL_DELIVERY_NOT_FOUND"),
        )
        for handler, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                with self.assertRaises(HTTPException) as raised:
                    handler(ResourceNotFoundError("대상을 찾을 수 없습니다."))
                self.assertEqual(raised.exception.status_code, 404)
                self.assertEqual(raised.exception.detail["code"], expected_code)

    def test_global_policy_preserves_forbidden_and_validation_boundaries(self) -> None:
        source = (ROOT / "app" / "api" / "errors.py").read_text(encoding="utf-8")
        self.assertIn("ResourceNotFoundError", source)
        self.assertIn("status_code=404", source)
        self.assertIn('"RESOURCE_NOT_FOUND"', source)
        self.assertIn("status_code=403", source)
        self.assertIn('"FORBIDDEN"', source)
        self.assertIn("status_code=422", source)
        self.assertIn('"VALIDATION_ERROR"', source)

    def test_services_use_not_found_error_for_hidden_resources(self) -> None:
        mail_source = (ROOT / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        delivery_source = (ROOT / "app" / "services" / "mail_delivery_operations.py").read_text(encoding="utf-8")
        approval_source = (ROOT / "app" / "services" / "directory_store.py").read_text(encoding="utf-8")
        for source, marker in (
            (mail_source, "def _fetch_accessible_room"),
            (mail_source, "def _fetch_accessible_mail"),
            (delivery_source, "def queue_detail"),
            (approval_source, "def _fetch_required_approval_document"),
        ):
            section = source[source.index(marker):]
            self.assertIn("ResourceNotFoundError", section[:5000])


class Stage02MessengerLifecyclePolicyTest(unittest.TestCase):
    def test_migration_is_additive_and_defines_lifecycle_state(self) -> None:
        sql = (ROOT / "migrations" / "051_messenger_room_lifecycle.sql").read_text(encoding="utf-8")
        for token in (
            "ADD COLUMN IF NOT EXISTS status",
            "ADD COLUMN IF NOT EXISTS closed_at",
            "ADD COLUMN IF NOT EXISTS closed_by_user_id",
            "ADD COLUMN IF NOT EXISTS left_at",
            "idx_messenger_room_members_active",
            "idx_messenger_rooms_retention_cleanup",
        ):
            self.assertIn(token, sql)
        upper = sql.upper()
        self.assertNotIn("DROP TABLE", upper)
        self.assertNotIn("TRUNCATE", upper)
        self.assertNotIn("DELETE FROM", upper)

    def test_lifecycle_payload_and_response_contracts(self) -> None:
        from app.schemas.mail_messenger import (
            MessengerRoomDeleteResponse,
            MessengerRoomLeaveResponse,
            MessengerRoomOwnerTransferRequest,
        )

        transfer = MessengerRoomOwnerTransferRequest(
            newOwnerUserId="user-b",
            expectedUpdatedAt=datetime.now(UTC),
        )
        self.assertEqual(transfer.newOwnerUserId, "user-b")
        self.assertIn("roomId", MessengerRoomLeaveResponse.model_fields)
        self.assertIn("leftAt", MessengerRoomLeaveResponse.model_fields)
        self.assertIn("retentionExpiresAt", MessengerRoomDeleteResponse.model_fields)

    def test_routes_expose_owner_transfer_leave_and_soft_delete(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "messenger.py").read_text(encoding="utf-8")
        for token in (
            '@router.patch("/rooms/{room_id}/owner"',
            '@router.post("/rooms/{room_id}/leave"',
            '@router.delete("/rooms/{room_id}"',
            "transfer_room_owner",
            "leave_room",
            "delete_room",
        ):
            self.assertIn(token, source)

    def test_service_enforces_owner_leave_delete_and_audit_contracts(self) -> None:
        source = (ROOT / "app" / "services" / "mail_messenger_service.py").read_text(encoding="utf-8")
        for token in (
            "def transfer_room_owner",
            "def leave_room",
            "def delete_room",
            "def run_messenger_retention_batch",
            '"messenger.room.owner_transferred"',
            '"messenger.room.left"',
            '"messenger.room.deleted"',
            "messenger.retention.purged",
            "left_at IS NULL",
            "status='active'",
            "timedelta(days=14)",
        ):
            self.assertIn(token, source)

    def test_retention_worker_runs_mail_and_messenger_cleanup(self) -> None:
        source = (ROOT / "app" / "workers" / "mail_retention_worker.py").read_text(encoding="utf-8")
        self.assertIn("MailMessengerService", source)
        self.assertIn("run_messenger_retention_batch", source)

    def test_admin_route_can_soft_delete_room(self) -> None:
        source = (ROOT / "app" / "api" / "routes" / "admin.py").read_text(encoding="utf-8")
        self.assertIn('@router.delete("/messenger/rooms/{room_id}"', source)
        self.assertIn("allow_admin=True", source)
        self.assertIn("MessengerRoomDeleteResponse", source)


if __name__ == "__main__":
    unittest.main()
