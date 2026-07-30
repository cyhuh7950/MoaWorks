from __future__ import annotations

import logging
import unittest
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, require_admin, require_permission
from app.api.errors import logger as error_logger
from app.api.errors import register_error_handlers
from app.main import app
from app.services.token_service import TokenService


class Ui047AuthSecurityRegressionTest(unittest.TestCase):
    def test_missing_authorization_header_is_401(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            get_current_user(authorization=None)

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, raised.exception.status_code)
        self.assertEqual("AUTH_REQUIRED", raised.exception.detail["code"])

    def test_forged_session_is_401(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            TokenService().decode_access_token("[REDACTED]")

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, raised.exception.status_code)
        self.assertEqual("AUTH_TOKEN_INVALID", raised.exception.detail["code"])

    def test_expired_session_is_401(self) -> None:
        expired_credential = TokenService().issue_access_token(
            SimpleNamespace(userId="expired-user"),
            expires_in=-1,
        )

        with self.assertRaises(HTTPException) as raised:
            TokenService().decode_access_token(expired_credential)

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, raised.exception.status_code)
        self.assertEqual("AUTH_TOKEN_EXPIRED", raised.exception.detail["code"])

    def test_nonexistent_user_in_existing_session_is_401(self) -> None:
        with (
            patch("app.api.dependencies.TokenService.decode_access_token", return_value={"subject": "missing-user"}),
            patch("app.api.dependencies.DirectoryStore.get_user_summary", side_effect=ValueError("not found")),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(authorization="Bearer [REDACTED]")

        self.assertEqual(status.HTTP_401_UNAUTHORIZED, raised.exception.status_code)
        self.assertEqual("AUTH_TOKEN_INVALID", raised.exception.detail["code"])

    def test_inactive_user_or_role_in_existing_session_is_423(self) -> None:
        with (
            patch("app.api.dependencies.TokenService.decode_access_token", return_value={"subject": "blocked-user"}),
            patch("app.api.dependencies.DirectoryStore.get_user_summary", side_effect=PermissionError("blocked")),
            self.assertRaises(HTTPException) as raised,
        ):
            get_current_user(authorization="Bearer [REDACTED]")

        self.assertEqual(status.HTTP_423_LOCKED, raised.exception.status_code)
        self.assertEqual("AUTH_ACCESS_BLOCKED", raised.exception.detail["code"])

    def test_active_user_is_reloaded_for_each_request(self) -> None:
        active_user = SimpleNamespace(userId="active-user", permissions=["profile:read"])
        with (
            patch("app.api.dependencies.TokenService.decode_access_token", return_value={"subject": "active-user"}),
            patch("app.api.dependencies.DirectoryStore.get_user_summary", return_value=active_user) as load_user,
        ):
            result = get_current_user(authorization="Bearer [REDACTED]")

        self.assertIs(active_user, result)
        load_user.assert_called_once_with("active-user")

    def test_admin_and_feature_permissions_are_server_enforced(self) -> None:
        user = SimpleNamespace(userId="regular-user", permissions=["profile:read"])

        with self.assertRaises(HTTPException) as admin_denied:
            require_admin(user)
        with self.assertRaises(HTTPException) as feature_denied:
            require_permission("mail:write", user)

        self.assertEqual(status.HTTP_403_FORBIDDEN, admin_denied.exception.status_code)
        self.assertEqual(status.HTTP_403_FORBIDDEN, feature_denied.exception.status_code)

    def test_notification_stream_rejects_query_token_authentication(self) -> None:
        response = TestClient(app).get(
            "/api/v1/notifications/stream",
            params={"token": "redacted-placeholder"},
        )

        self.assertEqual(401, response.status_code)
        self.assertEqual("AUTH_REQUIRED", response.json()["code"])

    def test_http_error_does_not_expose_internal_admin_detail(self) -> None:
        test_app = FastAPI()
        register_error_handlers(test_app)

        @test_app.get("/failure/{item_id}")
        def failure(item_id: str) -> None:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "FORBIDDEN",
                    "userMessage": "요청한 기능을 수행할 권한이 없습니다.",
                    "adminMessage": "INTERNAL_SENTINEL",
                },
            )

        rendered_log = StringIO()
        handler = logging.StreamHandler(rendered_log)
        handler.setFormatter(logging.Formatter("%(message)s"))
        previous_level = error_logger.level
        previous_propagate = error_logger.propagate
        error_logger.addHandler(handler)
        error_logger.setLevel(logging.WARNING)
        error_logger.propagate = False
        try:
            response = TestClient(test_app).get("/failure/INTERNAL_SENTINEL")
        finally:
            error_logger.removeHandler(handler)
            error_logger.setLevel(previous_level)
            error_logger.propagate = previous_propagate

        self.assertEqual(403, response.status_code)
        self.assertEqual("FORBIDDEN", response.json()["code"])
        self.assertNotIn("INTERNAL_SENTINEL", response.text)
        self.assertEqual(
            "API request rejected status=403 code=FORBIDDEN route=/failure/{item_id}",
            rendered_log.getvalue().strip(),
        )
        self.assertNotIn("INTERNAL_SENTINEL", rendered_log.getvalue())

    def test_unhandled_value_error_does_not_expose_exception_text(self) -> None:
        test_app = FastAPI()
        register_error_handlers(test_app)

        @test_app.get("/failure")
        def failure() -> None:
            raise ValueError("internal database identifier")

        rendered_log = StringIO()
        handler = logging.StreamHandler(rendered_log)
        handler.setFormatter(logging.Formatter("%(message)s"))
        previous_level = error_logger.level
        previous_propagate = error_logger.propagate
        error_logger.addHandler(handler)
        error_logger.setLevel(logging.WARNING)
        error_logger.propagate = False
        try:
            response = TestClient(test_app).get("/failure")
        finally:
            error_logger.removeHandler(handler)
            error_logger.setLevel(previous_level)
            error_logger.propagate = previous_propagate

        self.assertEqual(422, response.status_code)
        self.assertNotIn("internal database identifier", response.text)
        self.assertEqual(
            "API request rejected status=422 code=VALIDATION_ERROR route=/failure",
            rendered_log.getvalue().strip(),
        )
        self.assertNotIn("internal database identifier", rendered_log.getvalue())


if __name__ == "__main__":
    unittest.main()
