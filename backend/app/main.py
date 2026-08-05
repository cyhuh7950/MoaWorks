import asyncio
from contextlib import asynccontextmanager, suppress
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.core.config import settings
from app.services.mail_messenger_service import MailMessengerService
from app.services.operational_backup_service import OperationalBackupService
from app.services.operational_metrics_service import OperationalMetricsService, api_request_metrics
from app.services.schedule_notification_service import ScheduleNotificationService


logger = logging.getLogger(__name__)


async def mail_scheduler_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(MailMessengerService().dispatch_scheduled_mail)
        except Exception:
            logger.exception("예약 메일 처리에 실패했습니다.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.mail_scheduler_interval_seconds)
        except TimeoutError:
            continue


async def schedule_notification_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(ScheduleNotificationService().dispatch_due_notifications)
        except Exception:
            logger.exception("일정 알림 처리에 실패했습니다.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.schedule_notification_interval_seconds)
        except TimeoutError:
            continue


async def operational_backup_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(OperationalBackupService().process_once)
        except Exception:
            logger.exception("운영 백업·복구 worker 처리에 실패했습니다.")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.operational_backup_poll_seconds)
        except TimeoutError:
            continue


async def operational_monitoring_loop(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        await asyncio.to_thread(OperationalMetricsService().collect_once)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.watcher_interval_seconds)
        except TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop_event = asyncio.Event()
    tasks = []
    if settings.mail_scheduler_enabled:
        tasks.append(asyncio.create_task(mail_scheduler_loop(stop_event)))
    if settings.schedule_notification_enabled:
        tasks.append(asyncio.create_task(schedule_notification_loop(stop_event)))
    if settings.operational_backup_worker_enabled:
        tasks.append(asyncio.create_task(operational_backup_loop(stop_event)))
    if settings.watcher_enabled:
        tasks.append(asyncio.create_task(operational_monitoring_loop(stop_event)))
    try:
        yield
    finally:
        stop_event.set()
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task





app = FastAPI(
    title="MoaWorks Core API",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def track_api_status(request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        api_request_metrics.record(500)
        raise
    api_request_metrics.record(response.status_code)
    return response

register_error_handlers(app)
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "environment": settings.app_env,
        "status": "ok",
    }
