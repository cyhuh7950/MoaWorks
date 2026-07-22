from __future__ import annotations
import os
import time
from uuid import uuid4
from app.services.mail_delivery_operations import MailDeliveryOperations

def main():
    worker_id=os.getenv("MAIL_DELIVERY_WORKER_ID") or f"mail-worker-{uuid4().hex[:8]}"
    interval=max(1,int(os.getenv("MAIL_DELIVERY_POLL_SECONDS","5")))
    operations=MailDeliveryOperations()
    while True:
        worked=operations.run_once(worker_id)
        if not worked: time.sleep(interval)

if __name__=="__main__":
    main()
