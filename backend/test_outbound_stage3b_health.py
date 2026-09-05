from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from contextlib import nullcontext

from app.services.health_service import HealthService


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr('socket.create_connection', lambda *a, **k: nullcontext())


class Database:
    def __init__(self, worker=None, queue=None, fail=False):
        self.worker = worker
        self.queue = queue or {'pending': 0, 'overdue': 0, 'expired': 0, 'recent_failures': 0, 'unknown': 0}
        self.fail = fail
        self.queries = []

    @contextmanager
    def connect(self):
        yield self

    @contextmanager
    def cursor(self):
        yield self

    def execute(self, sql, params=()):
        self.queries.append((sql, params))
        if self.fail:
            raise RuntimeError('password=private host=private recipient@private.test')
        if 'mail_delivery_worker_heartbeats' in sql:
            self.row = self.worker
        elif 'mail_delivery_queue' in sql:
            self.row = self.queue
        elif 'mail_provider_configs' in sql:
            self.row = {'provider_type': 'smtp', 'relay_host': 'fixture', 'relay_port': 25}
        else:
            self.row = {'ok': 1}

    def fetchone(self):
        return self.row


def health(db):
    service = HealthService()
    service.directory_store = SimpleNamespace(db=db)
    return service


def worker(status='idle', age=0):
    return {'status': status, 'last_heartbeat_at': datetime.now(UTC) - timedelta(seconds=age)}


def test_db_health_executes_query_not_tcp(monkeypatch):
    monkeypatch.setattr('socket.create_connection', lambda *a, **k: pytest.fail('TCP-only health'))
    db = Database()
    result = health(db)._build_db()
    assert result.status == 'ok'
    assert any('SELECT 1' in sql for sql, _ in db.queries)
    assert 'host' not in result.details


def test_db_sql_failure_is_structured_and_private():
    result = health(Database(fail=True))._build_db()
    assert result.status == 'error'
    assert 'private' not in result.model_dump_json()


@pytest.mark.parametrize('record,expected', [(None, 'error'), (worker(age=121), 'error'),
    (worker('degraded'), 'error'), (worker(), 'ok'), (worker('working', 31), 'ok')])
def test_mail_health_requires_current_worker(record, expected):
    result = health(Database(record))._build_mail(True)
    assert result.status == expected


@pytest.mark.parametrize('field', ['overdue', 'expired', 'recent_failures', 'unknown'])
def test_mail_health_reports_backlog_and_history(field):
    db = Database(worker())
    db.queue[field] = 1
    result = health(db)._build_mail(True)
    assert result.status == 'warning'
    assert result.details[field] == '1'


def test_mail_db_error_never_raises_or_leaks():
    result = health(Database(fail=True))._build_mail(True)
    assert result.status == 'error'
    assert 'private' not in result.model_dump_json()


@pytest.mark.parametrize('record,counts,expected', [(worker(), {}, 0), (None, {}, 1),
    (worker('degraded'), {}, 1), (worker(), {'recent_failures': 5, 'unknown': 2}, 0),
    (worker(), {'expired': 1}, 1), (worker(), {'overdue': 1}, 1)])
def test_worker_gate_distinguishes_history_from_current_failure(record, counts, expected):
    from app.workers.mail_delivery_healthcheck import check
    db = Database(record)
    db.queue.update(counts)
    assert check(db, 'this-container-worker') == expected
    assert any('WHERE worker_id=%s' in sql and params == ('this-container-worker',) for sql, params in db.queries)
def test_health_aggregate_sql_and_exact_worker_id_with_local_rows():
    # 실제 집계 SQL을 SQLite에서 실행한다. PostgreSQL 연결/lock 검증은 Main 근거와 구분.
    from test_outbound_stage3a_lifecycle import Db, Cursor
    from app.services.mail_health_service import MailHealthService
    from datetime import UTC, datetime, timedelta
    class ProbeCursor(Cursor):
        def execute(self, sql, params=()):
            if sql.startswith('SET LOCAL'): return
            super().execute(sql, params)
    db = Db()
    db.cursor = lambda: ProbeCursor(db)
    try:
        now = datetime.now(UTC)
        for key, status in [('new','queued'), ('old','retry_pending'), ('lease','processing'), ('fail','failed'), ('unknown','result_unknown')]:
            db.add(key, status)
        db.sql.execute("UPDATE mail_delivery_queue SET next_attempt_at=? WHERE id='old'", ((now-timedelta(minutes=20)).isoformat(),))
        db.sql.execute("UPDATE mail_delivery_queue SET lease_expires_at=? WHERE id='lease'", ((now-timedelta(minutes=1)).isoformat(),))
        db.sql.execute("INSERT INTO mail_delivery_worker_heartbeats VALUES (?,?,?,?,?,?)", ('current','working',now.isoformat(),None,None,now.isoformat()))
        db.sql.commit()
        result = MailHealthService(db).build('current')
        assert result.status == 'warning'
        assert {k: result.details[k] for k in ['pending','overdue','expired','recent_failures','unknown']} == {
            'pending':'2', 'overdue':'1', 'expired':'1', 'recent_failures':'1', 'unknown':'1'}
        assert result.details['workerReady'] == 'true'
        assert MailHealthService(db).build('different-new-worker').details['workerReady'] == 'false'
    finally:
        db.sql.close()
