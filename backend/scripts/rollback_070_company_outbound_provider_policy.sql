-- Main 전용. 모든 API/worker writer 중지 후 정확한 대상 DB에서 먼저 BEGIN~ROLLBACK 검증.
-- 데이터 backup 전체 복원 금지. 과거 queue/provider/account pin/audit는 보존한다.
BEGIN;
LOCK TABLE mail_accounts, users, mail_provider_configs, mail_domain_settings IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM mail_accounts a JOIN users u ON u.id=a.user_id
        WHERE a.provider_config_id IS NULL
          AND (SELECT count(*) FROM mail_provider_configs p WHERE p.company_id=u.company_id AND p.active) <> 1
    ) THEN
        RAISE EXCEPTION '새 계정 rollback pin에 필요한 회사 active provider를 명시적으로 지정해야 합니다.';
    END IF;
    IF EXISTS (SELECT 1 FROM mail_domain_settings WHERE active_outbound_provider_key IS NULL) THEN
        RAISE EXCEPTION '이전 이미지의 NULL 미지원 회사 설정을 명시적으로 해소해야 합니다.';
    END IF;
END $$;

-- 070 이후 생성된 계정만 채운다. 기존 계정/과거 큐의 pin은 덮어쓰지 않는다.
UPDATE mail_accounts a SET provider_config_id=p.id
FROM users u JOIN mail_provider_configs p ON p.company_id=u.company_id AND p.active
WHERE a.user_id=u.id AND a.provider_config_id IS NULL;
ALTER TABLE mail_accounts ALTER COLUMN provider_config_id SET NOT NULL;
DROP TRIGGER mail_domain_derive_provider ON mail_domain_settings;
DROP FUNCTION derive_company_outbound_provider_display();
DROP TRIGGER mail_provider_sync_display ON mail_provider_configs;
DROP FUNCTION sync_company_outbound_provider_display();
DROP INDEX mail_provider_one_active_per_company;
ALTER TABLE mail_domain_settings ALTER COLUMN active_outbound_provider_key SET NOT NULL;
-- 큐 FK RESTRICT는 이전 이미지에서도 데이터 보호를 위해 유지한다.
DELETE FROM schema_migrations WHERE version='070_company_outbound_provider_policy.sql';
COMMIT;
