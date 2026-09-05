-- 기존 queue pin/attempt/audit 불변. unknown 자료가 있으면 구 worker/schema로 단순 복원 금지.
ALTER TABLE mail_delivery_queue ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE mail_delivery_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE mail_delivery_queue ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ;

ALTER TABLE mail_delivery_queue DROP CONSTRAINT IF EXISTS mail_delivery_queue_status_check;
ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_status_check CHECK (status IN (
    'queued','processing','blocked','retry_pending','sent','failed','cancelled','result_unknown'));
ALTER TABLE mail_delivery_attempts DROP CONSTRAINT IF EXISTS mail_delivery_attempts_result_check;
ALTER TABLE mail_delivery_attempts ADD CONSTRAINT mail_delivery_attempts_result_check CHECK (result IN (
    'sent','retry_pending','failed','blocked','result_unknown'));
ALTER TABLE mail_auto_forward_deliveries DROP CONSTRAINT IF EXISTS mail_auto_forward_deliveries_status_check;
ALTER TABLE mail_auto_forward_deliveries ADD CONSTRAINT mail_auto_forward_deliveries_status_check CHECK (status IN (
    'internal_delivered','queued','blocked','retry_pending','sent','failed','result_unknown'));
ALTER TABLE mail_out_of_office_deliveries DROP CONSTRAINT IF EXISTS mail_out_of_office_deliveries_status_check;
ALTER TABLE mail_out_of_office_deliveries ADD CONSTRAINT mail_out_of_office_deliveries_status_check CHECK (status IN (
    'internal_delivered','queued','blocked','retry_pending','sent','failed','result_unknown'));
