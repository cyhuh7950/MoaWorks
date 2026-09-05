from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.core.config import settings
from app.services.mail_inbound_operations import MailInboundOperations, verify_ingest_token


router = APIRouter()


@router.post('/submission', status_code=status.HTTP_202_ACCEPTED)
async def submit_mail(request: Request) -> dict:
    from app.services.mail_submission_operations import MailSubmissionOperations
    try:
        verify_ingest_token(request.headers.get('X-MoaWorks-Ingest-Token', ''), settings.mail_ingest_token)
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail='submission authentication failed') from exc
    names = ('X-MoaWorks-Envelope-From', 'X-MoaWorks-Envelope-To', 'X-MoaWorks-Queue-Id')
    if any(len(request.headers.getlist(name)) != 1 for name in names):
        raise HTTPException(status_code=422, detail='invalid submission headers')
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'message/rfc822':
        raise HTTPException(status_code=415, detail='message/rfc822 required')
    try:
        length = int(request.headers.get('content-length', '0'))
        if length < 0:
            raise ValueError()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='invalid content length') from exc
    if length > settings.mail_inbound_max_message_bytes:
        raise HTTPException(status_code=413, detail='message too large')
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > settings.mail_inbound_max_message_bytes:
            raise HTTPException(status_code=413, detail='message too large')
        raw.extend(chunk)
    try:
        return await asyncio.to_thread(MailSubmissionOperations().submit,
            envelope_from=request.headers[names[0]], recipient_email=request.headers[names[1]],
            queue_id=request.headers[names[2]], raw_message=bytes(raw))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail='submission validation rejected') from exc
    except Exception as exc:
        # 정책/DB/storage 장애: 민감한 원문은 반환하지 않고 gateway가 보관한다.
        raise HTTPException(status_code=503, detail='submission temporarily unavailable') from exc


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED)
async def ingest_mail(
    request: Request,
    ingest_token: str = Header(default="", alias="X-MoaWorks-Ingest-Token"),
    envelope_from: str = Header(default="", alias="X-MoaWorks-Envelope-From"),
    recipient_email: str = Header(alias="X-MoaWorks-Envelope-To"),
) -> dict:
    try:
        verify_ingest_token(ingest_token, settings.mail_ingest_token)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ingest authentication failed") from exc
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.mail_inbound_max_message_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="message too large")
    raw_message = await request.body()
    if len(raw_message) > settings.mail_inbound_max_message_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="message too large")
    try:
        result = await asyncio.to_thread(
            MailInboundOperations().ingest,
            envelope_from=envelope_from,
            recipient_email=recipient_email,
            raw_message=raw_message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return {
        "status": "accepted",
        "inboundId": result.inbound_id,
        "disposition": result.disposition,
        "duplicate": result.duplicate,
    }
