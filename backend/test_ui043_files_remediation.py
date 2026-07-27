from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest

from fastapi import HTTPException

from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import FilePatchPayload, FileShareSnapshotPayload, FolderCreatePayload, FolderPatchPayload
from app.services.workspace_file_storage import ContentTypeRejected, WorkspaceFileStorage
from app.services.workspace_service import WorkspaceService


def actor(user_id: str = "user-a") -> AuthUserSummary:
    return AuthUserSummary(userId=user_id, companyId="company-a", userName="Actor", userEmail="actor@example.test", roleId="role-a", roleName="User", userType="user", status="active", permissions=["profile:read"])


class Cursor:
    def __init__(self, results): self.results=list(results); self.current=None; self.executions=[]; self.rowcount=1
    def __enter__(self): return self
    def __exit__(self,*_): return False
    def execute(self,sql,params=()): self.executions.append((" ".join(sql.split()),tuple(params))); self.current=self.results.pop(0) if self.results else None
    def fetchone(self): return self.current
    def fetchall(self): return list(self.current or [])


class Connection:
    def __init__(self,cursor): self._cursor=cursor; self.commit_count=0
    def __enter__(self): return self
    def __exit__(self,*_): return False
    def cursor(self): return self._cursor
    def commit(self): self.commit_count+=1


class Db:
    def __init__(self,results): self.cursor=Cursor(results); self.connection=Connection(self.cursor)
    def connect(self): return self.connection


def service_with(results):
    service=object.__new__(WorkspaceService); service.db=Db(results); return service


class FailingStorage:
    def read(self,_key): raise FileNotFoundError("missing blob")


class RecordingStorage:
    def __init__(self,events): self.events=events
    def read(self,_key): self.events.append("read"); return b"ok"


class Ui043RemediationTests(unittest.TestCase):
    def test_public_file_view_is_allowlist_and_removes_internal_fields(self):
        row={"id":"f1","file_name":"report.pdf","content_type":"application/pdf","size_bytes":3,"status":"active","folder_id":None,"current_version":1,"version":0,"owner_user_id":"user-a","created_at":"now","updated_at":"now","content":b"raw","checksum":"secret","storage_key":"server-key","server_path":"/app/data/private","is_favorite":False,"effective_permission":"owner"}
        view=WorkspaceService._file_view(row,"user-a")
        self.assertFalse({"content","checksum","storage_key","server_path"}&view.keys())
        self.assertEqual(view["file_name"],"report.pdf")

    def test_deleted_shared_access_is_rejected_but_deleted_owner_trash_is_allowed(self):
        shared=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"owner","status":"deleted","effective_permission":"viewer"}])
        with self.assertRaises(HTTPException) as denied: shared._lock_file_access(shared.db.cursor,actor(),"f1","download","active")
        self.assertEqual(denied.exception.status_code,404)
        owner=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"deleted","effective_permission":"owner"}])
        self.assertEqual(owner._lock_file_access(owner.db.cursor,actor(),"f1","restore","deleted")["id"],"f1")

    def test_move_target_folder_is_locked_and_must_be_owned_active_same_company(self):
        good=service_with([{"id":"folder-a","company_id":"company-a","owner_user_id":"user-a","status":"active"}])
        self.assertEqual(good._lock_owned_folder(good.db.cursor,actor(),"folder-a")["id"],"folder-a")
        foreign=service_with([None])
        with self.assertRaises(HTTPException) as denied: foreign._lock_owned_folder(foreign.db.cursor,actor(),"folder-b")
        self.assertEqual(denied.exception.status_code,404)
        self.assertIn("FOR UPDATE",good.db.cursor.executions[0][0])

    def test_revoked_editor_cannot_mutate_and_foreign_folder_move_stops_before_update(self):
        revoked=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"owner","status":"active","version":1,"effective_permission":"viewer"}])
        with self.assertRaises(HTTPException) as denied: revoked.update_file(actor(),"f1",FilePatchPayload(fileName="safe.pdf",expectedVersion=1))
        self.assertEqual(denied.exception.status_code,403)
        self.assertEqual(len(revoked.db.cursor.executions),1)
        foreign=service_with([None])
        with self.assertRaises(HTTPException) as missing: foreign.update_file(actor(),"f1",FilePatchPayload(folderId="folder-b",expectedVersion=1))
        self.assertEqual(missing.exception.status_code,404)
        self.assertEqual(len(foreign.db.cursor.executions),1)

    def test_download_read_failure_has_no_success_audit_or_commit(self):
        service=service_with([
            {"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"active","current_version":1,"effective_permission":"owner"},
            {"file_name":"report.pdf","content_type":"application/pdf","storage_key":"missing","content":None},
        ])
        audits=[]; service._audit=lambda *_args,**_kwargs:audits.append(_args)
        with self.assertRaises(HTTPException): service.download_file(actor(),"f1",None,FailingStorage())
        self.assertEqual(audits,[])
        self.assertEqual(service.db.connection.commit_count,0)

    def test_download_success_reads_blob_before_audit_and_commits_once(self):
        service=service_with([
            {"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"active","current_version":1,"effective_permission":"owner"},
            {"file_name":"report.pdf","content_type":"application/pdf","storage_key":"key","content":None},
        ])
        events=[]; service._audit=lambda *_args,**_kwargs:events.append("audit")
        result=service.download_file(actor(),"f1",None,RecordingStorage(events))
        self.assertEqual(result["content"],b"ok")
        self.assertEqual(events,["read","audit"])
        self.assertEqual(service.db.connection.commit_count,1)

    def test_extension_and_mime_are_validated_together(self):
        with tempfile.TemporaryDirectory() as root:
            storage=WorkspaceFileStorage(root,max_bytes=20)
            storage.validate("report.pdf","application/pdf",b"pdf")
            for name,mime in (("report.exe","text/plain"),("report.pdf.exe","application/pdf"),("report.exe.pdf","application/pdf"),("image.jpg","application/pdf")):
                with self.assertRaises(ContentTypeRejected): storage.validate(name,mime,b"x")
            with self.assertRaises(ValueError): storage.safe_name("../report.pdf")
            with self.assertRaises(ValueError): storage.safe_name("bad\r\nname.pdf")

    def test_folder_names_are_normalized_and_empty_names_rejected(self):
        self.assertEqual(FolderCreatePayload(name="  업무   자료  ").name,"업무 자료")
        self.assertEqual(FolderPatchPayload(name=" 보고서 ",expectedVersion=0).name,"보고서")
        for payload in (lambda:FolderCreatePayload(name="  "),lambda:FolderPatchPayload(name="\n",expectedVersion=0)):
            with self.assertRaises(ValueError): payload()

    def test_share_snapshot_supports_user_department_change_and_removal_atomically(self):
        service=service_with([
            {"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"active","version":2,"effective_permission":"owner"},
            None,None,{"id":"user-b"},None,{"id":"dept-a"},None,None,
        ])
        service.file_detail=lambda *_args:{"saved":True}
        payload=FileShareSnapshotPayload(expectedVersion=2,shares=[
            {"targetType":"user","targetId":"user-b","permission":"editor"},
            {"targetType":"department","targetId":"dept-a","permission":"viewer"},
        ])
        self.assertEqual(service.save_file_shares(actor(),"f1",payload),{"saved":True})
        sql="\n".join(item[0] for item in service.db.cursor.executions)
        self.assertIn("UPDATE workspace_file_shares SET status='inactive'",sql)
        self.assertEqual(sql.count("INSERT INTO workspace_file_shares"),2)
        self.assertIn("FROM users",sql); self.assertIn("FROM departments",sql)
        self.assertEqual(service.db.connection.commit_count,1)

    def test_share_snapshot_rejects_self_and_duplicate_targets(self):
        with self.assertRaises(ValueError): FileShareSnapshotPayload(expectedVersion=0,shares=[
            {"targetType":"user","targetId":"user-b","permission":"viewer"},
            {"targetType":"user","targetId":"user-b","permission":"editor"},
        ])
        service=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"active","version":0,"effective_permission":"owner"},None,None])
        with self.assertRaises(HTTPException) as denied: service.save_file_shares(actor(),"f1",FileShareSnapshotPayload(expectedVersion=0,shares=[{"targetType":"user","targetId":"user-a","permission":"viewer"}]))
        self.assertEqual(denied.exception.status_code,400)
        self.assertEqual(service.db.connection.commit_count,0)

    def test_folder_tree_rename_conflict_and_non_empty_delete_have_stable_409(self):
        conflict=service_with([{"id":"folder-a","company_id":"company-a","owner_user_id":"user-a","status":"active","version":2}])
        with self.assertRaises(HTTPException) as version: conflict.rename_file_folder(actor(),"folder-a",FolderPatchPayload(name="새 이름",expectedVersion=1))
        self.assertEqual(version.exception.status_code,409)
        self.assertEqual(version.exception.detail["code"],"FOLDER_VERSION_CONFLICT")
        non_empty=service_with([{"id":"folder-a","company_id":"company-a","owner_user_id":"user-a","status":"active","version":2},{"id":"child"},None])
        with self.assertRaises(HTTPException) as occupied: non_empty.delete_file_folder(actor(),"folder-a",2)
        self.assertEqual(occupied.exception.status_code,409)
        self.assertEqual(occupied.exception.detail["code"],"FOLDER_NOT_EMPTY")

    def test_folder_filter_sql_and_parameters_are_typed_for_postgresql(self):
        legacy=service_with([[]]); legacy.list_files(actor())
        root=service_with([[]]); root.list_files(actor(),folder_id=None,folder_specified=True)
        child=service_with([[]]); child.list_files(actor(),folder_id="folder-a",folder_specified=True)
        legacy_sql,legacy_params=legacy.db.cursor.executions[0]
        root_sql,root_params=root.db.cursor.executions[0]
        child_sql,child_params=child.db.cursor.executions[0]
        self.assertNotIn("AND f.folder_id IS NULL",legacy_sql)
        self.assertNotIn("AND f.folder_id=%s",legacy_sql)
        self.assertIn("AND f.folder_id IS NULL",root_sql)
        self.assertNotIn(None,root_params)
        self.assertIn("AND f.folder_id=%s",child_sql)
        self.assertEqual(child_params[-1],"folder-a")
        self.assertEqual(len(root_params),len(legacy_params))
        self.assertEqual(len(child_params),len(legacy_params)+1)

    def test_deleted_owner_trash_detail_is_restore_only(self):
        service=service_with([
            {"id":"f1","company_id":"company-a","owner_user_id":"user-a","file_name":"trash.pdf","content_type":"application/pdf","size_bytes":3,"status":"deleted","current_version":1,"version":4,"effective_permission":"owner"},
            [],[],[],
        ])
        detail=service.file_detail(actor(),"f1",include_deleted=True)
        self.assertEqual(detail["status"],"deleted")
        self.assertEqual(detail["permissions"],{"download":False,"favorite":False,"rename":False,"newVersion":False,"move":False,"share":False,"trash":False,"restore":True})

    def test_deleted_shared_trash_detail_and_default_active_detail_are_404(self):
        shared=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"owner","status":"deleted","effective_permission":"viewer"}])
        with self.assertRaises(HTTPException) as denied: shared.file_detail(actor(),"f1",include_deleted=True)
        self.assertEqual(denied.exception.status_code,404)
        owner_default=service_with([{"id":"f1","company_id":"company-a","owner_user_id":"user-a","status":"deleted","effective_permission":"owner"}])
        with self.assertRaises(HTTPException) as active_only: owner_default.file_detail(actor(),"f1")
        self.assertEqual(active_only.exception.status_code,404)

    def test_non_mine_scopes_omit_explicit_folder_filter(self):
        for scope in ("shared","department","recent","favorites","trash"):
            service=service_with([[]]); service.list_files(actor(),scope=scope,folder_specified=False)
            sql,_params=service.db.cursor.executions[0]
            self.assertNotIn("AND f.folder_id IS NULL",sql,scope)
            self.assertNotIn("AND f.folder_id=%s",sql,scope)


if __name__ == "__main__": unittest.main()
