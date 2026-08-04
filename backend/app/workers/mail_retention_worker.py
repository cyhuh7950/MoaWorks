from __future__ import annotations

import logging
import os
import socket
import time
import uuid

from app.core.config import settings
from app.services.mailbox_settings_service import MailboxSettingsService
from app.services.mail_messenger_service import MailMessengerService


logger = logging.getLogger(__name__)


def run_worker_iteration(
    service: MailboxSettingsService,
    worker_id: str,
    messenger_service: MailMessengerService | None = None,
) -> int:
    batch_size = max(
        1,
        min(
            int(getattr(settings, "mail_retention_batch_size", 500)),
            500,
        ),
    )
    mail_changed = service.run_retention_batch(worker_id, limit=batch_size)
    messenger_changed = 0 if messenger_service is None else messenger_service.run_messenger_retention_batch(worker_id, limit=batch_size)
    return mail_changed + messenger_changed


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    worker_id = (
        f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    )
    service = MailboxSettingsService()
    messenger_service = MailMessengerService()
    poll_seconds = max(
        1,
        int(getattr(settings, "mail_retention_poll_seconds", 60)),
    )
    while True:
        try:
            changed = run_worker_iteration(service, worker_id, messenger_service)
            if changed == 0:
                time.sleep(poll_seconds)
        except Exception:
            logger.error("Mail retention iteration failed")
            time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
