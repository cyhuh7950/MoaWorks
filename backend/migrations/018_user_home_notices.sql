CREATE TABLE IF NOT EXISTS user_notices (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'deleted')),
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_notice_reads (
    notice_id TEXT NOT NULL REFERENCES user_notices(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_notices_company_status_published
    ON user_notices(company_id, status, published_at DESC);

INSERT INTO user_notices (id, company_id, title, content, author_name, status, published_at)
SELECT 'ntc_user_home_welcome_' || c.id,
       c.id,
       'MoaWorks 사용자 홈 안내',
       '메일, 결재, 일정, 대화의 최근 업무와 공지를 홈에서 확인할 수 있습니다.',
       'MoaWorks 운영팀',
       'published',
       NOW()
FROM companies c
ON CONFLICT (id) DO NOTHING;
