from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def test_ui043_migration_is_additive_and_complete():
    sql = read("migrations/044_workspace_files.sql").lower()
    for table in (
        "workspace_folders",
        "workspace_file_versions",
        "workspace_file_shares",
        "workspace_file_favorites",
    ):
        assert f"create table if not exists {table}" in sql
    for column in ("folder_id", "current_version", "deleted_at", "version", "checksum"):
        assert column in sql
    assert "drop table" not in sql
    assert "truncate" not in sql
    assert "delete from workspace_files" not in sql


def test_ui043_storage_has_bounded_safe_uuid_keys_and_cleanup():
    source = read("app/services/workspace_file_storage.py")
    for marker in ("MAX_FILE_BYTES", "max_bytes + 1", "uuid4", "unlink", "resolve", "ContentTypeRejected"):
        assert marker in source
    assert "file_name" not in source[source.index("def write"):source.index("def read")]


def test_ui043_routes_cover_operational_file_contract():
    source = read("app/api/routes/workspace.py")
    for marker in (
        "scope: FileScope",
        "folderId",
        "query",
        "sort: FileSort",
        "'/file-folders'",
        "'/files/{item_id}/versions'",
        "'/files/{item_id}/restore'",
        "'/files/{item_id}/favorite'",
        "'/files/{item_id}/shares'",
        "expectedVersion",
        "filename*=UTF-8''",
        "X-Content-Type-Options",
        "Cache-Control",
    ):
        assert marker in source
    upload = source[source.index("async def upload_file"):source.index("@router.patch('/files/{item_id}')")]
    assert "max_bytes + 1" in upload


def test_ui043_service_scopes_permissions_and_audit_are_server_side():
    source = read("app/services/workspace_service.py")
    for marker in (
        "shared", "department", "recent", "favorites", "trash",
        "workspace_file_versions", "workspace_file_shares", "workspace_file_favorites",
        "expected_version", "workspace.file.version_created", "workspace.file.trashed",
        "workspace.file.restored", "workspace.file.downloaded",
    ):
        assert marker in source
    assert "company_id=%s" in source


def test_ui043_schemas_reject_ambiguous_mutations():
    from app.schemas.workspace import FilePatchPayload, FileShareSnapshotPayload

    assert FilePatchPayload(fileName=" report.txt ", expectedVersion=2).fileName == "report.txt"
    try:
        FileShareSnapshotPayload(expectedVersion=1, shares=[
            {"targetType": "user", "targetId": "usr_1", "permission": "viewer"},
            {"targetType": "user", "targetId": "usr_1", "permission": "editor"},
        ])
    except ValueError:
        pass
    else:
        raise AssertionError("duplicate share targets must be rejected")
