from datetime import UTC, datetime, timedelta

from app.schemas.health import ComponentHealth


class MailHealthService:
    """발송을 유발하지 않는 SQL 기반 상태 조회. 공개 응답은 집계값만 포함한다."""

    def __init__(self, db):
        self.db = db

    def build(self, worker_id=None):
        now = datetime.now(UTC)
        try:
            with self.db.connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute("SET LOCAL statement_timeout = '3000ms'")
                    where = 'WHERE worker_id=%s' if worker_id else ''
                    cursor.execute(f"""SELECT status,last_heartbeat_at
                        FROM mail_delivery_worker_heartbeats {where}
                        ORDER BY last_heartbeat_at DESC LIMIT 1""", (worker_id,) if worker_id else ())
                    worker = cursor.fetchone()
                    cursor.execute("""SELECT
                        COUNT(CASE WHEN status IN ('queued','retry_pending') THEN 1 END) AS pending,
                        COUNT(CASE WHEN status IN ('queued','retry_pending') AND COALESCE(next_attempt_at,created_at)<%s THEN 1 END) AS overdue,
                        COUNT(CASE WHEN status='processing' AND (lease_expires_at IS NULL OR lease_expires_at<%s) THEN 1 END) AS expired,
                        COUNT(CASE WHEN status IN ('failed','blocked') AND updated_at>=%s THEN 1 END) AS recent_failures,
                        COUNT(CASE WHEN status='result_unknown' THEN 1 END) AS unknown
                        FROM mail_delivery_queue""", (now-timedelta(minutes=10), now, now-timedelta(hours=1)))
                    counts = cursor.fetchone()
            details = {key: str(int(counts[key])) for key in ('pending','overdue','expired','recent_failures','unknown')}
            heartbeat = worker.get('last_heartbeat_at') if worker else None
            if isinstance(heartbeat, str):
                heartbeat = datetime.fromisoformat(heartbeat)
            age = (now-heartbeat).total_seconds() if heartbeat else None
            # 30초 lease/heartbeat 갱신의 세 주기를 허용하되 미래 시각도 정상으로 숨기지 않는다.
            alive = age is not None and -5 <= age <= 90 and worker['status'] in {'idle','working'}
            details['workerReady'] = str(alive).lower()
            details['workerState'] = ('healthy' if alive else 'unavailable')
            if not alive:
                return ComponentHealth(status='error', message='메일 worker의 현재 정상 동작을 확인할 수 없습니다.', details=details)
            if any(int(details[key]) for key in ('overdue','expired','recent_failures','unknown')):
                return ComponentHealth(status='warning', message='메일 worker는 동작 중이며 대기 지연 또는 전달 이력 확인이 필요합니다.', details=details)
            return ComponentHealth(status='ok', message='메일 worker heartbeat와 전달 큐 상태를 확인했습니다. 수신함 도착 확인은 아닙니다.', details=details)
        except Exception:
            return ComponentHealth(status='error', message='메일 상태 SQL 조회에 실패했습니다.', details={'workerReady': 'false'})
