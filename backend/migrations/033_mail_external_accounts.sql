CREATE TABLE IF NOT EXISTS mail_external_accounts (
  id VARCHAR(80) PRIMARY KEY, company_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL,
  owner_mail_account_id VARCHAR(80) REFERENCES mail_accounts(id), display_name VARCHAR(50) NOT NULL, host VARCHAR(253) NOT NULL,
  port INTEGER NOT NULL CHECK (port IN (110,995)), tls_mode VARCHAR(20) NOT NULL CHECK (tls_mode IN ('ssl','starttls')),
  username VARCHAR(254) NOT NULL, encrypted_password TEXT NOT NULL, target_folder_id VARCHAR(80) REFERENCES mail_user_folders(id) ON DELETE SET NULL,
  delete_from_server BOOLEAN NOT NULL DEFAULT FALSE, enabled BOOLEAN NOT NULL DEFAULT FALSE,
  connection_status VARCHAR(20) NOT NULL DEFAULT 'untested' CHECK (connection_status IN ('untested','success','failed')),
  config_fingerprint VARCHAR(128), last_test_at TIMESTAMPTZ, last_test_code VARCHAR(80), next_collect_at TIMESTAMPTZ,
  last_collect_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ,
  CONSTRAINT mail_external_tls_port_ck CHECK ((tls_mode='ssl' AND port=995) OR (tls_mode='starttls' AND port=110))
);
CREATE INDEX IF NOT EXISTS idx_mail_external_owner ON mail_external_accounts(company_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_external_active_identity ON mail_external_accounts(company_id,user_id,lower(host),port,lower(username)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_external_due ON mail_external_accounts(enabled,connection_status,next_collect_at);

CREATE TABLE IF NOT EXISTS mail_external_collection_jobs (
  id VARCHAR(80) PRIMARY KEY, account_id VARCHAR(80) NOT NULL REFERENCES mail_external_accounts(id), company_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL,
  trigger VARCHAR(20) NOT NULL CHECK (trigger IN ('manual','scheduled')), status VARCHAR(20) NOT NULL CHECK (status IN ('queued','running','completed','partial','failed')),
  lease_owner VARCHAR(120), lease_expires_at TIMESTAMPTZ, attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ,
  seen_count INTEGER NOT NULL DEFAULT 0, imported_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
  deleted_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, error_code VARCHAR(80), created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_external_active_job ON mail_external_collection_jobs(account_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_mail_external_job_claim ON mail_external_collection_jobs(status,next_attempt_at,lease_expires_at);

CREATE TABLE IF NOT EXISTS mail_external_imports (
  id VARCHAR(80) PRIMARY KEY, account_id VARCHAR(80) NOT NULL REFERENCES mail_external_accounts(id) ON DELETE RESTRICT,
  company_id VARCHAR(80) NOT NULL, user_id VARCHAR(80) NOT NULL, uidl VARCHAR(500) NOT NULL, message_id VARCHAR(80),
  remote_delete_status VARCHAR(20) NOT NULL DEFAULT 'kept' CHECK (remote_delete_status IN ('kept','pending','deleted','failed')),
  remote_delete_code VARCHAR(80), imported_at TIMESTAMPTZ NOT NULL, remote_deleted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(account_id,uidl)
);
CREATE INDEX IF NOT EXISTS idx_mail_external_import_owner ON mail_external_imports(company_id,user_id);
ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS source_external_account_id VARCHAR(80);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_mail_messages_external_account') THEN
    ALTER TABLE mail_messages ADD CONSTRAINT fk_mail_messages_external_account FOREIGN KEY(source_external_account_id) REFERENCES mail_external_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;
ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS chk_mail_messages_source_action;
ALTER TABLE mail_messages ADD CONSTRAINT chk_mail_messages_source_action CHECK (source_action IS NULL OR source_action IN ('reply','reply_all','forward','out_of_office','external_pop3'));
