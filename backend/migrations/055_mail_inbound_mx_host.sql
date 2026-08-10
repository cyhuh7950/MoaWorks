ALTER TABLE mail_domain_settings
    ADD COLUMN IF NOT EXISTS inbound_mx_host TEXT;

UPDATE mail_domain_settings
SET inbound_mx_host = mail_host
WHERE inbound_mx_host IS NULL;

ALTER TABLE mail_domain_settings ALTER COLUMN inbound_mx_host SET NOT NULL;
