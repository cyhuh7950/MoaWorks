from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import threading

from app.services.postgres_service import PostgresService


def test_migrations_lock_before_schema_creation_until_commit():
    events=[]
    class Cursor:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def execute(self,sql,params=None): events.append('lock' if 'pg_advisory_xact_lock' in sql else 'schema' if 'CREATE TABLE' in sql else 'query')
        def fetchall(self): return []
    class Connection:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def cursor(self): return Cursor()
        def commit(self): events.append('commit')
    db=PostgresService(migration_dir=Path('nonexistent-synthetic-migrations'))
    db.connect=lambda _: Connection()
    db.ensure_migrations_applied(db_config=object())
    assert events==['lock','schema','query','commit']


def test_retry_route_optional_confirmation_preserves_bodyless_contract(monkeypatch):
    from app.api.routes import admin
    from app.schemas import mail_messenger
    op=Mock(); monkeypatch.setattr(admin,'_delivery_service',lambda:op)
    user=SimpleNamespace(companyId='a')
    admin.retry_mail_delivery('q',user=user)
    assert op.retry.call_args.kwargs.get('confirm_duplicate_risk',False) is False
    payload=mail_messenger.MailDeliveryRetryRequest(confirmDuplicateRisk=True)
    admin.retry_mail_delivery('q',user=user,payload=payload)
    assert op.retry.call_args.kwargs=={'confirm_duplicate_risk':True}


def test_new_migration_preserves_terminal_attempt_contract():
    migration=Path('migrations/072_mail_delivery_claim_fencing.sql')
    assert migration.exists(), '결과불명 CHECK 및 소유권 schema 필요'
    sql=migration.read_text(encoding='utf-8')
    for table,field in [('mail_delivery_queue','status'),('mail_delivery_attempts','result'),
                        ('mail_auto_forward_deliveries','status'),('mail_out_of_office_deliveries','status')]:
        import re,sqlite3
        check=re.search(r'ALTER TABLE '+table+r' ADD CONSTRAINT \w+ CHECK \('+field+r' IN \((.*?)\)\)',sql,re.S)
        assert check,table
        with sqlite3.connect(':memory:') as db:
            db.execute(f'CREATE TABLE t ({field} NOT NULL CHECK ({field} IN ({check[1]})))')
            db.execute('INSERT INTO t VALUES (?)',('result_unknown',))
            assert db.execute('SELECT * FROM t').fetchone()[0]=='result_unknown'


def test_two_migration_runners_serialize_before_pending_query():
    # 프로세스별 로컬락은 서로 다르게, DB advisory의 blocking을 경계 double로 재현.
    gate=threading.Lock(); pending=threading.Event(); release=threading.Event()
    events=[]; errors=[]
    class Connection:
        def __init__(self,name): self.name=name; self.locked=False
        def __enter__(self): return self
        def __exit__(self,*args):
            if self.locked: gate.release(); self.locked=False
        def cursor(self): return self
        def execute(self,sql,params=None):
            if 'pg_advisory_xact_lock' in sql:
                gate.acquire(); self.locked=True
            elif 'SELECT version' in sql:
                events.append(self.name)
                if self.name=='first':
                    pending.set(); assert release.wait(1)
        def fetchall(self): return []
        def commit(self):
            events.append(self.name+'-commit')
            # transaction lock은 cursor 종료가 아니라 commit에 해제되어야 한다.
            gate.release(); self.locked=False
    # cursor와 connection context를 분리해 commit 이전 lock을 보존한다.
    class Cursor:
        def __init__(self,c): self.c=c
        def __enter__(self): return self.c
        def __exit__(self,*args): pass
    def run(name):
        db=PostgresService(migration_dir=Path('nonexistent-synthetic-migrations'))
        db._migration_lock=threading.Lock()
        c=Connection(name); c.cursor=lambda:Cursor(c); db.connect=lambda _:c
        try: db.ensure_migrations_applied(db_config=object())
        except Exception as exc: errors.append(type(exc).__name__)
    first=threading.Thread(target=run,args=('first',)); second=threading.Thread(target=run,args=('second',))
    first.start(); assert pending.wait(1); second.start(); release.set()
    first.join(2); second.join(2)
    assert not first.is_alive() and not second.is_alive() and errors==[]
    assert events==['first','first-commit','second','second-commit']


def test_retry_http_bodyless_default_explicit_true_and_strict_boolean(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.routes import admin
    actor=SimpleNamespace(companyId='a')
    observed=[]
    class Service:
        def retry(self,user,queue_id,*,confirm_duplicate_risk):
            observed.append((user.companyId,queue_id,confirm_duplicate_risk))
            raise ValueError('synthetic state rejection')
    monkeypatch.setattr(admin,'_delivery_service',lambda:Service())
    app=FastAPI(); app.include_router(admin.router); app.dependency_overrides[admin.require_admin]=lambda:actor
    with TestClient(app) as client:
        assert client.post('/mail-delivery/queue/q/retry').status_code==400
        assert client.post('/mail-delivery/queue/q/retry',json={'confirmDuplicateRisk':True}).status_code==400
        assert client.post('/mail-delivery/queue/q/retry',json={'confirmDuplicateRisk':'true'}).status_code==422
    assert observed==[('a','q',False),('a','q',True)]
