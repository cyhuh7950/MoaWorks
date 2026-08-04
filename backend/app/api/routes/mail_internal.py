from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.core.config import settings
from app.services.mail_inbound_operations import MailInboundOperations, verify_ingest_token


router = APIRouter()


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
