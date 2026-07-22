from pathlib import Path
import unittest
from app.services.mail_delivery_service import MailDeliveryPolicy, MailDeliveryWorker, RelayDeliveryError, mask_delivery_error
class Adapter:
 def __init__(self,error=None): self.error,self.calls=error,[]
 def send(self,envelope,provider):
  self.calls.append(envelope)
  if self.error: raise self.error
  return "accepted"
class Ui021Tests(unittest.TestCase):
 root=Path(__file__).parent
 def test_contract(self):
  sql=(self.root/"migrations/025_mail_delivery_queue.sql").read_text().lower()
  for m in ("delivery_enabled boolean not null default false","create table if not exists mail_delivery_queue","create table if not exists mail_delivery_attempts","create table if not exists mail_delivery_worker_heartbeats","unique (mail_id, recipient_id)","on delete cascade","idx_mail_delivery_queue_claim"): self.assertIn(m,sql)
  admin=(self.root/"app/api/routes/admin.py").read_text(); schema=(self.root/"app/schemas/mail_messenger.py").read_text(); compose=(self.root.parent/"deploy/docker-compose.yml").read_text(); api=(self.root.parent/"frontend/admin-web/src/api.ts").read_text()
  for m in ('/mail-delivery/status','/mail-delivery/queue','/mail-delivery/provider/test'): self.assertIn(m,admin)
  self.assertIn("externalDeliveries",schema); self.assertIn("app.workers.mail_delivery_worker",compose); self.assertIn('const defaultApiBase = "/api/v1"',api)
 def test_policy_worker_and_masking(self):
  result=MailDeliveryPolicy().classify("moaworks.test",{"inside@moaworks.test":"u1"},[("to","inside@moaworks.test"),("cc","outside@example.invalid")])
  self.assertEqual(len(result.internal),1); self.assertEqual(len(result.external),1)
  with self.assertRaises(ValueError): MailDeliveryPolicy().classify("moaworks.test",{},[("to","missing@moaworks.test")])
  job={"queue_id":"q1","attempt_count":0,"recipient_email":"outside@example.invalid","sender_email":"sender@moaworks.test","subject":"s","body_text":"b","body_html":None}
  adapter=Adapter(); self.assertEqual(MailDeliveryWorker("w",adapter).deliver_claimed(job,{"delivery_enabled":False,"last_test_status":"success"}).status,"blocked"); self.assertEqual(adapter.calls,[])
  provider={"delivery_enabled":True,"last_test_status":"success","max_retry_count":2,"retry_interval_sec":10}
  self.assertEqual(MailDeliveryWorker("w",Adapter()).deliver_claimed(job,provider).status,"sent")
  retry=MailDeliveryWorker("w",Adapter(RelayDeliveryError("token=secret",True))).deliver_claimed(job,provider); self.assertEqual(retry.status,"retry_pending"); self.assertNotIn("secret",retry.error_message or "")
  self.assertNotIn("hunter2",mask_delivery_error("password=hunter2 user@example.com"))
if __name__=="__main__": unittest.main()
