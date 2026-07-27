from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import CalendarCreatePayload, CalendarOrderPayload, CalendarSubscriptionPayload, CalendarUpdatePayload, ContactGroupCreatePayload, ContactGroupUpdatePayload, ContactPayload, FilePatchPayload, FileScope, FileShareSnapshotPayload, FileSort, FolderCreatePayload, FolderPatchPayload, NoticeListResponse, NoticeRecord, PreferencePayload, SchedulePayload, WorkspaceDirectoryResponse, WorkspaceItemList, WorkspacePreferencesResponse
from app.services.workspace_file_storage import ContentTypeRejected, WorkspaceFileStorage
from app.services.workspace_service import WorkspaceService

router = APIRouter()


def _service() -> WorkspaceService:
    return WorkspaceService()


@router.get('/directory', response_model=WorkspaceDirectoryResponse)
def directory(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().directory(user)


@router.get('/organization/departments')
def organization_departments(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().organization_departments(user)


@router.get('/organization/members')
def organization_members(departmentId: str | None = Query(default=None), query: str = Query(default="", max_length=120), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().organization_members(user, departmentId, query)


@router.get('/organization/members/{user_id}')
def organization_member_detail(user_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().organization_member_detail(user, user_id)


@router.get('/calendars')
def list_calendars(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_calendars(user)


@router.get('/calendars/discover')
def discover_calendars(query: str = Query(default="", max_length=120), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return {"items": _service().discover_calendars(user, query)}


@router.post('/calendars')
def create_calendar(payload: CalendarCreatePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_calendar(user, payload)


@router.put('/calendars/order')
def reorder_calendars(payload: CalendarOrderPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().reorder_calendars(user, payload)


@router.patch('/calendars/{calendar_id}')
def update_calendar(calendar_id: str, payload: CalendarUpdatePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_calendar(user, calendar_id, payload)


@router.delete('/calendars/{calendar_id}', status_code=204)
def delete_calendar(calendar_id: str, expectedVersion: int = Query(ge=0), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_calendar(user, calendar_id, expectedVersion)


@router.post('/calendar-subscriptions')
def create_calendar_subscription(payload: CalendarSubscriptionPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_calendar_subscription(user, payload)


@router.delete('/calendar-subscriptions/{subscription_id}', status_code=204)
def cancel_calendar_subscription(subscription_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().cancel_calendar_subscription(user, subscription_id)


@router.post('/calendar-subscriptions/{subscription_id}/accept')
def accept_calendar_subscription(subscription_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().decide_calendar_subscription(user, subscription_id, "accepted")


@router.post('/calendar-subscriptions/{subscription_id}/reject')
def reject_calendar_subscription(subscription_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().decide_calendar_subscription(user, subscription_id, "rejected")


@router.get('/schedules', response_model=WorkspaceItemList)
def list_schedules(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_schedules(user)


@router.post('/schedules')
def create_schedule(payload: SchedulePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_schedule(user, payload)


@router.patch('/schedules/{item_id}')
def update_schedule(item_id: str, payload: SchedulePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_schedule(user, item_id, payload)


@router.delete('/schedules/{item_id}', status_code=204)
def delete_schedule(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_schedule(user, item_id)


@router.get('/contacts', response_model=WorkspaceItemList)
def list_contacts(query: str = Query(default="", max_length=120), groupId: str | None = Query(default=None), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_contacts(user, query, groupId)


@router.post('/contacts')
def create_contact(payload: ContactPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_contact(user, payload)


@router.post('/contacts/import')
async def import_contacts(
    file: UploadFile = File(...),
    mode: Literal["preview", "apply"] = Query(),
    expectedDigest: str | None = Query(default=None),
    user: AuthUserSummary = Depends(permission_required("profile:read")),
):
    content = await file.read()
    service = _service()
    if mode == "preview":
        return service.preview_contact_import(user, file.filename or "", file.content_type or "", content)
    return service.apply_contact_import(user, file.filename or "", file.content_type or "", content, expectedDigest or "")


@router.patch('/contacts/{item_id}')
def update_contact(item_id: str, payload: ContactPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_contact(user, item_id, payload)


@router.delete('/contacts/{item_id}', status_code=204)
def delete_contact(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_contact(user, item_id)


@router.get('/contact-groups')
def list_contact_groups(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return {"items": _service().list_contact_groups(user)}


@router.post('/contact-groups')
def create_contact_group(payload: ContactGroupCreatePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_contact_group(user, payload)


@router.patch('/contact-groups/{group_id}')
def update_contact_group(group_id: str, payload: ContactGroupUpdatePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_contact_group(user, group_id, payload)


@router.delete('/contact-groups/{group_id}', status_code=204)
def delete_contact_group(group_id: str, expectedUpdatedAt: datetime = Query(), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_contact_group(user, group_id, expectedUpdatedAt)


@router.get('/public-contacts')
def list_public_contacts(query: str = Query(default="", max_length=120), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return {"items": _service().list_public_contacts(user, query)}


@router.get('/file-folders')
def list_file_folders(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_file_folders(user)


@router.post('/file-folders')
def create_file_folder(payload: FolderCreatePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_file_folder(user, payload)


@router.patch('/file-folders/{folder_id}')
def rename_file_folder(folder_id: str, payload: FolderPatchPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().rename_file_folder(user, folder_id, payload)


@router.delete('/file-folders/{folder_id}', status_code=204)
def delete_file_folder(folder_id: str, expectedVersion: int = Query(ge=0), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_file_folder(user, folder_id, expectedVersion)


@router.get('/files', response_model=WorkspaceItemList)
def list_files(request: Request, scope: FileScope = "mine", folderId: str | None = None, query: str = Query(default="", max_length=120), sort: FileSort = "updated_desc", user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_files(user, scope, folderId or None, query, sort, folder_specified="folderId" in request.query_params)


@router.post('/files')
async def upload_file(file: UploadFile = File(...), folderId: str | None = None, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    storage = WorkspaceFileStorage()
    content = await file.read(storage.max_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail={"code": "FILE_EMPTY", "userMessage": "빈 파일은 업로드할 수 없습니다."})
    try: safe_name = storage.safe_name(file.filename or 'upload.bin')
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "FILE_NAME_INVALID", "userMessage": "파일 이름을 확인하세요."})
    try:
        storage.validate(safe_name, file.content_type or 'application/octet-stream', content)
    except ContentTypeRejected:
        raise HTTPException(status_code=400, detail={"code": "FILE_TYPE_REJECTED", "userMessage": "허용되지 않는 파일 형식입니다."})
    except ValueError:
        raise HTTPException(status_code=413, detail={"code": "FILE_TOO_LARGE", "userMessage": "파일 크기 제한을 초과했습니다."})
    return _service().create_file(user, safe_name, file.content_type or 'application/octet-stream', content, folderId, storage)


@router.patch('/files/{item_id}')
def rename_file(item_id: str, payload: FilePatchPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_file(user, item_id, payload)


@router.delete('/files/{item_id}', status_code=204)
def delete_file(item_id: str, expectedVersion: int | None = None, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_file(user, item_id, expectedVersion)


@router.post('/files/{item_id}/versions')
async def create_file_version(item_id: str, file: UploadFile = File(...), expectedVersion: int = Query(ge=0), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    storage = WorkspaceFileStorage()
    content = await file.read(storage.max_bytes + 1)
    try: safe_name = storage.safe_name(file.filename or 'upload.bin')
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "FILE_NAME_INVALID", "userMessage": "파일 이름을 확인하세요."})
    try:
        storage.validate(safe_name, file.content_type or 'application/octet-stream', content)
    except (ContentTypeRejected, ValueError):
        raise HTTPException(status_code=400, detail={"code": "FILE_UPLOAD_INVALID", "userMessage": "파일 형식 또는 크기를 확인하세요."})
    return _service().create_file_version(user, item_id, safe_name, file.content_type or 'application/octet-stream', content, expectedVersion, storage)


@router.post('/files/{item_id}/restore')
def restore_file(item_id: str, expectedVersion: int = Query(ge=0), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().restore_file(user, item_id, expectedVersion)


@router.put('/files/{item_id}/favorite')
def favorite_file(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().set_file_favorite(user, item_id, True)


@router.delete('/files/{item_id}/favorite', status_code=204)
def unfavorite_file(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().set_file_favorite(user, item_id, False)


@router.put('/files/{item_id}/shares')
def save_file_shares(item_id: str, payload: FileShareSnapshotPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().save_file_shares(user, item_id, payload)


@router.get('/files/{item_id}/download')
def download_file(item_id: str, version: int | None = Query(default=None, ge=1), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    from urllib.parse import quote
    item = _service().download_file(user, item_id, version, WorkspaceFileStorage())
    safe_ascii = "download" + ("." + item['file_name'].rsplit(".", 1)[-1] if "." in item['file_name'] else "")
    return Response(content=item['content'], media_type=item['content_type'], headers={
        'Content-Disposition': f"attachment; filename=\"{safe_ascii}\"; filename*=UTF-8''{quote(item['file_name'])}",
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    })


@router.get('/files/{item_id}')
def file_detail(item_id: str, includeDeleted: bool = Query(default=False), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().file_detail(user, item_id, include_deleted=includeDeleted)


@router.get('/preferences', response_model=WorkspacePreferencesResponse)
def preferences(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().get_preferences(user)


@router.put('/preferences', response_model=WorkspacePreferencesResponse)
def save_preferences(payload: PreferencePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().save_preferences(user, payload)


@router.get('/help-policies', response_model=WorkspaceItemList)
def help_policies(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_help(user)


@router.get('/notices', response_model=NoticeListResponse)
def notices(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_notices(user)


@router.get('/notices/{notice_id}', response_model=NoticeRecord)
def notice_detail(notice_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().notice_detail(user, notice_id)


@router.post('/notices/{notice_id}/read', response_model=NoticeRecord)
def read_notice(notice_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().read_notice(user, notice_id)
