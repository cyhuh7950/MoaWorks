from __future__ import annotations
import os
import time
from uuid import uuid4
from app.services.mail_delivery_operations import MailDeliveryOperations

def run_worker_iteration(operations, worker_id: str) -> bool:
    try:
        return bool(operations.run_once(worker_id))
    except Exception as exc:
        try:
            operations.record_degraded(worker_id, exc)
        except Exception:
            pass
        return False

def main():
    worker_id=os.getenv("MAIL_DELIVERY_WORKER_ID") or f"mail-worker-{uuid4().hex[:8]}"
    interval=max(1,int(os.getenv("MAIL_DELIVERY_POLL_SECONDS","5")))
    operations=MailDeliveryOperations()
    while True:
        worked=run_worker_iteration(operations,worker_id)
        if not worked: time.sleep(interval)

if __name__=="__main__":
    main()
