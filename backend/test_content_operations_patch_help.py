from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.services.content_operations_service import ContentOperationsService


class _Cursor:
    def __init__(self) -> None:
        self.executions: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self) -> "_Cursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...]) -> None:
        self.executions.append((query, params))


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor
        self.committed = False

    def __enter__(self) -> "_Connection":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def cursor(self) -> _Cursor:
        return self._cursor

    def commit(self) -> None:
        self.committed = True


class _Database:
    def __init__(self) -> None:
        self.cursor = _Cursor()
        self.connection = _Connection(self.cursor)

    def connect(self) -> _Connection:
        return self.connection


class ContentOperationsPatchHelpTest(unittest.TestCase):
    def _patch(self, content: str | None) -> tuple[str, tuple[object, ...]]:
        database = _Database()
        service = ContentOperationsService.__new__(ContentOperationsService)
        service.db = database
        service.help = lambda _item_id: {
            "id": "help-1",
            "status": "draft",
            "is_system": False,
        }
        service._audit = lambda *_args, **_kwargs: None
        patch = SimpleNamespace(
            title="수정 제목",
            category="policy",
            audience="all",
            content=content,
            status="published",
        )

        service.patch_help("admin-1", "help-1", patch)

        self.assertTrue(database.connection.committed)
        self.assertEqual(len(database.cursor.executions), 1)
        return database.cursor.executions[0]

    def test_patch_help_casts_version_binding_for_postgresql(self) -> None:
        query, params = self._patch("수정 본문")

        self.assertIn("CASE WHEN %s::text IS NULL THEN 0 ELSE 1 END", query)
        self.assertEqual(
            params,
            ("수정 제목", "policy", "all", "수정 본문", "published", "수정 본문", "published", "help-1"),
        )

    def test_patch_help_keeps_version_when_content_is_omitted(self) -> None:
        query, params = self._patch(None)

        self.assertIn("CASE WHEN %s::text IS NULL THEN 0 ELSE 1 END", query)
        self.assertIsNone(params[3])
        self.assertIsNone(params[5])
        self.assertEqual(len(params), 8)


if __name__ == "__main__":
    unittest.main()
