from __future__ import annotations

import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from app.api.routes.notifications import stream_notifications


class NotificationStreamCursorTest(unittest.IsolatedAsyncioTestCase):
    async def test_streammeta_uses_iso_created_at_cursor_without_fallback(self) -> None:
        created_at = datetime(2026, 7, 20, 9, 0, tzinfo=UTC)
        notification = SimpleNamespace(
            notificationId="evt_should_not_be_used_as_cursor",
            createdAt=created_at,
            model_dump_json=lambda: '{"notificationId":"evt_should_not_be_used_as_cursor"}',
        )

        with patch(
            "app.api.routes.notifications.NotificationCenterService.list_notifications",
            return_value=SimpleNamespace(notifications=[notification]),
        ):
            response = stream_notifications(user=SimpleNamespace(userId="user_test"))
            chunks = [chunk async for chunk in response.body_iterator]

        body = b"".join(chunk if isinstance(chunk, bytes) else chunk.encode() for chunk in chunks).decode()
        self.assertIn(f'"value":"{created_at.isoformat()}"', body)
        self.assertNotIn('"type":"fallback"', body)


if __name__ == "__main__":
    unittest.main()
