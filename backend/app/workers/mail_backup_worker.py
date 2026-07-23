from __future__ import annotations

import errno
import logging
import os
import socket
import time
import uuid

from app.core.config import settings
from app.services.mailbox_backup_service import MailboxBackupService


logger = logging.getLogger(__name__)

BACKUP_SOURCE_MISSING = "BACKUP_SOURCE_MISSING"
BACKUP_STORAGE_FULL = "BACKUP_STORAGE_FULL"
BACKUP_IO_FAILED = "BACKUP_IO_FAILED"
BACKUP_INTERNAL_FAILED = "BACKUP_INTERNAL_FAILED"


def classify_backup_error(error: Exception) -> str:
    if isinstance(error, FileNotFoundError):
        return BACKUP_SOURCE_MISSING
    if isinstance(error, OSError) and error.errno == errno.ENOSPC:
        return BACKUP_STORAGE_FULL
    if isinstance(error, OSError):
        return BACKUP_IO_FAILED
    return BACKUP_INTERNAL_FAILED


def run_worker_iteration(
    service: MailboxBackupService,
    worker_id: str,
) -> bool:
    service.expire_artifacts()
    job = service.claim_next(worker_id)
    if job is None:
        return False
    try:
        result = service.build_claimed(job, worker_id)
        service.complete_job(worker_id, job, result)
    except Exception as error:
        error_code = classify_backup_error(error)
        service.fail_job(worker_id, job, error_code)
        logger.error(
            "Mailbox backup iteration failed: job_id=%s error_code=%s",
            job.get("id"),
            error_code,
        )
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    worker_id = (
        f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    )
    service = MailboxBackupService()
    poll_seconds = max(
        1,
        int(getattr(settings, "mail_backup_poll_seconds", 5)),
    )
    while True:
        worked = run_worker_iteration(service, worker_id)
        if not worked:
            time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
