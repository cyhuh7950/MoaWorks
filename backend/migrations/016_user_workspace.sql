CREATE TABLE IF NOT EXISTS user_schedule_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS personal_contacts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS workspace_files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    content BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS user_workspace_preferences (
    owner_user_id TEXT PRIMARY KEY REFERENCES users(id),
    locale TEXT NOT NULL DEFAULT 'ko',
    timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_schedule_events_owner_status ON user_schedule_events(owner_user_id, status, starts_at);
CREATE INDEX IF NOT EXISTS idx_personal_contacts_owner_status ON personal_contacts(owner_user_id, status, name);
CREATE INDEX IF NOT EXISTS idx_workspace_files_owner_status ON workspace_files(owner_user_id, status, updated_at DESC);
INSERT INTO help_policy_documents (id, code, title, category, audience, status, is_system, content, published_at, created_at, updated_at)
VALUES
  ('hpd_user_workspace_help', 'user.workspace.help', '사용자 업무 화면 안내', 'guide', 'user', 'published', TRUE, '메신저, 일정, 주소록, 조직도, 파일은 목록에서 선택해 상세를 확인합니다. 변경 작업은 각 화면의 팝업에서 처리합니다.', NOW(), NOW(), NOW()),
  ('hpd_user_workspace_policy', 'user.workspace.policy', '사용자 데이터 보관 정책', 'policy', 'user', 'published', TRUE, '개인 일정, 연락처, 파일은 사용자 계정 기준으로 보관됩니다. 조직 정보와 정책 문서는 조회 전용입니다.', NOW(), NOW(), NOW())
ON CONFLICT (code) DO NOTHING;
