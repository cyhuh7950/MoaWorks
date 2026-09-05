import json
import os

from app.services.mail_health_service import MailHealthService
from app.services.postgres_service import PostgresService


def check(db, worker_id):
    if not worker_id:
        print(json.dumps({'status': 'error', 'reason': 'WORKER_ID_REQUIRED'}))
        return 1
    result = MailHealthService(db).build(worker_id)
    ready = result.details.get('workerReady') == 'true' and not any(
        int(result.details.get(key, '0')) for key in ('overdue', 'expired'))
    print(json.dumps({'ready': ready, **result.model_dump()}, ensure_ascii=False))
    return 0 if ready else 1


if __name__ == '__main__':
    raise SystemExit(check(PostgresService(), os.getenv('MAIL_DELIVERY_WORKER_ID')))
