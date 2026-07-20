from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.api.dependencies import permission_required
from app.schemas.directory import AuthUserSummary
from app.schemas.workspace import ContactPayload, FileRenamePayload, NoticeListResponse, NoticeRecord, PreferencePayload, SchedulePayload, WorkspaceDirectoryResponse, WorkspaceItemList, WorkspacePreferencesResponse
from app.services.workspace_service import WorkspaceService

router = APIRouter()


def _service() -> WorkspaceService:
    return WorkspaceService()


@router.get('/directory', response_model=WorkspaceDirectoryResponse)
def directory(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().directory(user)


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
def list_contacts(user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().list_contacts(user)


@router.post('/contacts')
def create_contact(payload: ContactPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().create_contact(user, payload)


@router.patch('/contacts/{item_id}')
def update_contact(item_id: str, payload: ContactPayload, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    return _service().update_contact(user, item_id, payload)


@router.delete('/contacts/{item_id}', status_code=204)
def delete_contact(item_id: str, user: AuthUserSummary = Depends(permission_required("profile:read"))):
    _service().delete_contact(user, item_id)


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
