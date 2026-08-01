CREATE TABLE IF NOT EXISTS message_keys (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  default_locale TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS message_translations (
  id TEXT PRIMARY KEY,
  message_key_id TEXT NOT NULL REFERENCES message_keys(id),
  locale TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_key_id, locale)
);
CREATE TABLE IF NOT EXISTS help_policy_documents (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  audience TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','inactive','deleted')),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_keys_status_category ON message_keys(status, category);
CREATE INDEX IF NOT EXISTS idx_help_policy_documents_status_category ON help_policy_documents(status, category);
