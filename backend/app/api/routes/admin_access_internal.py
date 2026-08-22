from __future__ import annotations

import asyncio
import secrets

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.core.config import settings
from app.services.admin_access_policy import AdminAccessOperations


router = APIRouter()


@router.get("/check", status_code=status.HTTP_204_NO_CONTENT)
async def check_admin_access(
    client_ip: str = Header(alias="X-MoaWorks-Client-IP"),
    access_token: str = Header(default="", alias="X-MoaWorks-Admin-Access-Token"),
) -> Response:
    if not access_token or not settings.admin_access_check_token or not secrets.compare_digest(
        access_token, settings.admin_access_check_token
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="admin access authentication failed")
    decision = await asyncio.to_thread(AdminAccessOperations().check, client_ip)
    if not decision.allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin access denied")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
