from __future__ import annotations
from pathlib import Path
import unittest

from app.services.mail_delivery_operations import MailDeliveryOperations, prepare_provider_update
from app.workers.mail_delivery_worker import run_worker_iteration

class EventAdapter:
    def __init__(self, events, error=None): self.events, self.error = events, error
    def prepare(self, envelope, provider): return envelope
    def send_prepared(self, envelope, provider, *, before_data=None):
        if before_data: before_data()
        self.events.append("network")
        if self.error: raise self.error
        return "accepted"

class OrchestratedOperations(MailDeliveryOperations):
    def __init__(self, adapter, stale=False):
        self.adapter=adapter; self.events=adapter.events; self.stale=stale
    def claim_next(self, worker_id):
        self.events.append("claim_commit")
        return {"queue_id":"q1","attempt_count":0,"recipient_email":"test@example.invalid","sender_email":"sender@moaworks.test","subject":"s","body_text":"b","body_html":None,"attachments":[]}
    def prepare_claim(self,job):
        self.events.append('prepare')
        return {"delivery_enabled":True,"last_test_status":"success","max_retry_count":2,"retry_interval_sec":1}
    def renew_claim(self,*args,**kwargs): return True
    def finalize_claim(self, worker_id, job, result):
        self.events.append("finalize_transaction")
        return not self.stale
    def record_degraded(self, worker_id, error):
        self.events.append("degraded")

class Ui021RemediationTests(unittest.TestCase):
    root=Path(__file__).parent
    def test_oracle_compose_runs_worker_with_same_origin_and_operational_networks(self):
        local=(self.root.parent/"deploy/docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn('command: ["python", "-m", "app.workers.mail_delivery_worker"]',local)
        self.assertNotIn("VITE_API_BASE_URL", local)
        self.assertNotIn("VITE_PROXY_TARGET", local)
        text=(self.root.parent/"deploy/docker-compose.oracle.yml").read_text(encoding="utf-8")
        self.assertIn('command: ["python", "-m", "app.workers.mail_delivery_worker"]',text)
        self.assertNotIn("VITE_API_BASE_URL", text)
        self.assertNotIn("VITE_PROXY_TARGET", text)
        self.assertNotIn("https://api.moaworks.sinsan.kr/api/v1",text)
        api_source=(self.root.parent/"frontend/admin-web/src/api.ts").read_text(encoding="utf-8")
        self.assertIn('const defaultApiBase = "/api/v1";', api_source)
        worker=text[text.index("  mail-layer:"):text.index("  storage:")]
        for marker in ("dockerfile: deploy/server.Dockerfile","../data:/app/data","- app_net","- pg_net","restart: unless-stopped"): self.assertIn(marker,worker)
        self.assertNotIn("../backend:/app",worker)
    def test_provider_connection_change_forces_untested_and_lock(self):
        current={"provider_type":"smtp","relay_host":"old","relay_port":587,"tls_mode":"starttls","username":"user","from_address":"from@test","last_test_status":"success","delivery_enabled":True}
        updates=prepare_provider_update(current,{"relayHost":"new"},lambda value:"enc:"+value)
        self.assertEqual(updates["relay_host"],"new"); self.assertFalse(updates["delivery_enabled"]); self.assertEqual(updates["last_test_status"],"untested")
        with self.assertRaises(ValueError): prepare_provider_update(current,{"relayHost":"new","deliveryEnabled":True},lambda value:value)
        password=prepare_provider_update(current,{"password":"new-secret"},lambda value:"encrypted")
        self.assertEqual(password["encrypted_password"],"encrypted"); self.assertNotIn("password",password)
    def test_claim_network_finalize_are_separate_and_stale_finalize_rejected(self):
        events=[]; operations=OrchestratedOperations(EventAdapter(events))
        self.assertTrue(operations.run_once("worker-a")); self.assertEqual(events,["claim_commit","prepare","network","finalize_transaction"])
        stale_events=[]; stale=OrchestratedOperations(EventAdapter(stale_events),stale=True)
        self.assertFalse(stale.run_once("worker-a"))
        source=(self.root/"app/services/mail_delivery_operations.py").read_text(encoding="utf-8").lower()
        self.assertIn("claim_token=%s and lease_expires_at>clock_timestamp() and worker_id=%s",source)
        self.assertIn("returning id",source)
    def test_unexpected_worker_error_records_degraded_without_stopping_iteration(self):
        class Broken:
            def run_once(self, worker_id): raise RuntimeError("secret token=abc")
            def record_degraded(self, worker_id, error): self.recorded=str(error)
        operations=Broken()
        self.assertFalse(run_worker_iteration(operations,"worker-a"))
        self.assertTrue(hasattr(operations,"recorded"))
    def test_scheduled_and_immediate_delivery_audit_target_queue(self):
        source=(self.root/"app/services/mail_messenger_service.py").read_text(encoding="utf-8").lower()
        self.assertIn("'mail_delivery_queue', q.id",source)
        self.assertIn("target_type, target_id",source)
        self.assertNotIn("'mail', q.mail_id",source)

if __name__=="__main__": unittest.main()
