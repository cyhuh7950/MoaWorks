from __future__ import annotations

import logging
import os
import socket
import time
import uuid

from app.core.config import settings
from app.services.mailbox_settings_service import MailboxSettingsService


logger = logging.getLogger(__name__)


def run_worker_iteration(
    service: MailboxSettingsService,
    worker_id: str,
) -> int:
    batch_size = max(
        1,
        min(
            int(getattr(settings, "mail_retention_batch_size", 500)),
            500,
        ),
    )
    return service.run_retention_batch(worker_id, limit=batch_size)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    worker_id = (
        f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    )
    service = MailboxSettingsService()
    poll_seconds = max(
        1,
        int(getattr(settings, "mail_retention_poll_seconds", 60)),
    )
    while True:
        try:
            changed = run_worker_iteration(service, worker_id)
            if changed == 0:
                time.sleep(poll_seconds)
        except Exception:
            logger.error("Mail retention iteration failed")
            time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
