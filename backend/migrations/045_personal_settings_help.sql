CREATE TABLE IF NOT EXISTS user_workspace_preferences (
  owner_user_id TEXT PRIMARY KEY REFERENCES users(id),
  company_id TEXT REFERENCES companies(id),
  locale VARCHAR(16) NOT NULL DEFAULT 'ko-KR',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Seoul',
  start_page VARCHAR(32) NOT NULL DEFAULT 'home',
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id);
ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS start_page VARCHAR(32) NOT NULL DEFAULT 'home';
ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_workspace_preferences ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE user_workspace_preferences preference
SET company_id = account.company_id
FROM users account
WHERE preference.owner_user_id = account.id AND preference.company_id IS NULL;
ALTER TABLE user_workspace_preferences ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS ix_user_workspace_preferences_company_owner ON user_workspace_preferences(company_id,owner_user_id);

CREATE TABLE IF NOT EXISTS help_policy_documents (
  id TEXT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(240) NOT NULL,
  category VARCHAR(32) NOT NULL,
  audience VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'published',
  version INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_help_policy_documents_public ON help_policy_documents(status,audience,category,updated_at DESC);

INSERT INTO help_policy_documents(id,code,title,category,audience,content,status)
VALUES
 ('help_user_entry','USER-WORKSPACE','사용자 업무 시작 가이드','guide','user','홈에서 메일, 결재, 메신저, 일정, 주소록, 조직도와 파일 업무로 이동할 수 있습니다.','published'),
 ('help_retention','RETENTION-POLICY','메일·메신저 보관 정책','policy','user','메일과 메신저의 보관 기간은 Help, 정책 안내와 각 업무 설정에서 확인합니다.','published'),
 ('help_error_401','ERROR-401','로그인이 필요한 경우','error','user','세션이 만료되었으면 다시 로그인한 뒤 요청을 반복하세요.','published'),
 ('help_error_403','ERROR-403','권한이 없는 경우','error','user','업무 권한을 확인하고 필요한 경우 관리자에게 문의하세요.','published'),
 ('help_error_409','ERROR-409','다른 변경이 먼저 저장된 경우','error','user','최신 값을 다시 불러온 뒤 변경 내용을 확인하고 저장하세요.','published'),
 ('help_error_423','ERROR-423','계정 사용이 제한된 경우','error','user','계정 또는 역할 상태를 관리자에게 확인하세요.','published')
ON CONFLICT(code) DO NOTHING;
