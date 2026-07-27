from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import CalendarCreatePayload, CalendarOrderPayload, CalendarSubscriptionPayload, CalendarUpdatePayload, ContactGroupCreatePayload, ContactGroupUpdatePayload, ContactPayload, FileRenamePayload, NoticeListResponse, NoticeRecord, PreferencePayload, SchedulePayload, WorkspaceDirectoryResponse, WorkspaceItemList, WorkspacePreferencesResponse
from app.services.workspace_service import WorkspaceService

router = APIRouter()


def _service() -> WorkspaceService:
    return WorkspaceService()


@router.get('/directory', response_model=WorkspaceDirectoryResponse)
def directory(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().directory(user)


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


@router.get('/files', response_model=WorkspaceItemList)
def list_files(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_files(user)


@router.post('/files')
async def upload_file(file: UploadFile = File(...), user: AuthUserSummary = Depends(permission_required("profile:read"))):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail={"code": "FILE_EMPTY", "userMessage": "빈 파일은 업로드할 수 없습니다."})
    return _service().create_file(user, file.filename or 'upload.bin', file.content_type or 'application/octet-stream', content)


@router.patch('/files/{item_id}')
def rename_file(item_id: str, payload: FileRenamePayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().rename_file(user, item_id, payload.fileName)


@router.delete('/files/{item_id}', status_code=204)
def delete_file(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_file(user, item_id)


@router.get('/files/{item_id}/download')
def download_file(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    item = _service().file_metadata(user, item_id, include_content=True)
    return Response(content=item['content'], media_type=item['content_type'], headers={'Content-Disposition': f'attachment; filename="{item["file_name"]}"'})


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
