CREATE TABLE IF NOT EXISTS workspace_folders (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), owner_user_id TEXT NOT NULL REFERENCES users(id),
  parent_id TEXT REFERENCES workspace_folders(id), name VARCHAR(255) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_folders_active_sibling ON workspace_folders(owner_user_id, COALESCE(parent_id,''), lower(name)) WHERE status='active';
CREATE INDEX IF NOT EXISTS ix_workspace_folders_company_owner ON workspace_folders(company_id,owner_user_id,status);

CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), owner_user_id TEXT NOT NULL REFERENCES users(id),
  file_name VARCHAR(255) NOT NULL, content_type VARCHAR(160) NOT NULL, size_bytes BIGINT NOT NULL,
  content BYTEA, status VARCHAR(20) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES workspace_folders(id);
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspace_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE workspace_files ALTER COLUMN content DROP NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_file_versions (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES workspace_files(id), version_no INTEGER NOT NULL,
  file_name VARCHAR(255) NOT NULL, content_type VARCHAR(160) NOT NULL, size_bytes BIGINT NOT NULL,
  checksum VARCHAR(64), storage_key VARCHAR(255), created_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(file_id,version_no)
);
CREATE TABLE IF NOT EXISTS workspace_file_shares (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES workspace_files(id), shared_by_user_id TEXT NOT NULL REFERENCES users(id),
  target_type VARCHAR(20) NOT NULL CHECK(target_type IN ('user','department')), target_id TEXT NOT NULL,
  permission VARCHAR(20) NOT NULL CHECK(permission IN ('viewer','editor')), status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_file_shares_active_target ON workspace_file_shares(file_id,target_type,target_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS workspace_file_favorites (
  file_id TEXT NOT NULL REFERENCES workspace_files(id), user_id TEXT NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(file_id,user_id)
);
CREATE INDEX IF NOT EXISTS ix_workspace_files_scope ON workspace_files(company_id,owner_user_id,status,folder_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_workspace_file_versions_file ON workspace_file_versions(file_id,version_no DESC);
CREATE INDEX IF NOT EXISTS ix_workspace_file_shares_target ON workspace_file_shares(target_type,target_id,status);

INSERT INTO workspace_file_versions(id,file_id,version_no,file_name,content_type,size_bytes,checksum,storage_key,created_by_user_id,created_at)
SELECT 'wfv_legacy_' || md5(f.id),f.id,1,f.file_name,f.content_type,f.size_bytes,f.checksum,NULL,f.owner_user_id,f.created_at
FROM workspace_files f WHERE f.content IS NOT NULL
ON CONFLICT(file_id,version_no) DO NOTHING;
