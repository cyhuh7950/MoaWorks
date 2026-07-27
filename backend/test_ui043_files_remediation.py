from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest

from fastapi import HTTPException

from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import FolderCreatePayload, FolderPatchPayload
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

    def test_download_read_failure_has_no_success_audit_or_commit(self):
        service=service_with([{"file_name":"report.pdf","content_type":"application/pdf","storage_key":"missing","content":None}])
        service.file_metadata=lambda *_args,**_kwargs:{"id":"f1","currentVersion":1}
        audits=[]; service._audit=lambda *_args,**_kwargs:audits.append(_args)
        with self.assertRaises(HTTPException): service.download_file(actor(),"f1",None,FailingStorage())
        self.assertEqual(audits,[])
        self.assertEqual(service.db.connection.commit_count,0)

    def test_extension_and_mime_are_validated_together(self):
        with tempfile.TemporaryDirectory() as root:
            storage=WorkspaceFileStorage(root,max_bytes=20)
            storage.validate("report.pdf","application/pdf",b"pdf")
            for name,mime in (("report.exe","text/plain"),("report.pdf.exe","application/pdf"),("image.jpg","application/pdf")):
                with self.assertRaises(ContentTypeRejected): storage.validate(name,mime,b"x")
            with self.assertRaises(ValueError): storage.safe_name("../report.pdf")
            with self.assertRaises(ValueError): storage.safe_name("bad\r\nname.pdf")

    def test_folder_names_are_normalized_and_empty_names_rejected(self):
        self.assertEqual(FolderCreatePayload(name="  업무   자료  ").name,"업무 자료")
        self.assertEqual(FolderPatchPayload(name=" 보고서 ",expectedVersion=0).name,"보고서")
        for payload in (lambda:FolderCreatePayload(name="  "),lambda:FolderPatchPayload(name="\n",expectedVersion=0)):
            with self.assertRaises(ValueError): payload()

    def test_explicit_root_and_legacy_default_generate_different_filters(self):
        legacy=service_with([[]]); legacy.list_files(actor())
        root=service_with([[]]); root.list_files(actor(),folder_id=None,folder_specified=True)
        self.assertNotIn("f.folder_id IS NULL",legacy.db.cursor.executions[0][0])
        self.assertIn("f.folder_id IS NULL",root.db.cursor.executions[0][0])


if __name__ == "__main__": unittest.main()
