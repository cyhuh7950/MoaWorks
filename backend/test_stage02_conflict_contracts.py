from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routes.admin import create_user
from app.api.routes.mail import _handle_error
from app.services.directory_store import DirectoryUserEmailConflictError
from app.services.mail_messenger_service import MailFolderConflictError


class Stage02ConflictContractsTest(unittest.TestCase):
    @patch("app.api.routes.admin.DirectoryStore")
    def test_duplicate_user_email_is_409_conflict(self, store_type) -> None:
        store_type.return_value.create_user.side_effect = DirectoryUserEmailConflictError(
            "이미 존재하는 이메일입니다."
        )

        with self.assertRaises(HTTPException) as raised:
            create_user(object(), object())

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "USER_EMAIL_CONFLICT")

    def test_duplicate_mail_folder_name_is_409_conflict(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            _handle_error(MailFolderConflictError("같은 이름의 사용자 메일함이 이미 있습니다."))

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(raised.exception.detail["code"], "MAIL_FOLDER_NAME_CONFLICT")


if __name__ == "__main__":
    unittest.main()
