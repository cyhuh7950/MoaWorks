-- 중복 활성 설정은 임의 선택하지 않고 migration 전체를 중단한다.
DO $$
BEGIN
    IF EXISTS (SELECT company_id FROM mail_provider_configs WHERE active GROUP BY company_id HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION '회사별 활성 발송 Provider 중복을 명시적으로 해소해야 합니다.';
    END IF;
END $$;

CREATE UNIQUE INDEX mail_provider_one_active_per_company
    ON mail_provider_configs(company_id) WHERE active;

-- 과거 큐의 provider와 그 아래 attempt/feedback 기록을 삭제에서 보호한다.
ALTER TABLE mail_delivery_queue DROP CONSTRAINT mail_delivery_queue_provider_config_id_fkey;
ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_provider_config_id_fkey
    FOREIGN KEY (provider_config_id) REFERENCES mail_provider_configs(id) ON DELETE RESTRICT;

-- 이전 이미지 rollback용 과거 pin 보존. 신규 런타임은 읽거나 쓰지 않는다.
ALTER TABLE mail_accounts ALTER COLUMN provider_config_id DROP NOT NULL;

-- 표시값은 정책 원본이 아니다. 활성 설정이 없으면 NULL로 표시한다.
ALTER TABLE mail_domain_settings ALTER COLUMN active_outbound_provider_key DROP NOT NULL;
UPDATE mail_domain_settings d SET active_outbound_provider_key = (
    SELECT CASE WHEN p.provider_type IN ('oci_email_delivery', 'oci_smtp') THEN 'oci_email_delivery'
                WHEN p.provider_type IN ('self_hosted', 'self_hosted_smtp', 'smtp') THEN 'self_hosted' END
    FROM mail_provider_configs p WHERE p.company_id=d.company_id AND p.active
);

CREATE FUNCTION sync_company_outbound_provider_display() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE mail_domain_settings d SET active_outbound_provider_key = (
        SELECT CASE WHEN p.provider_type IN ('oci_email_delivery', 'oci_smtp') THEN 'oci_email_delivery'
                    WHEN p.provider_type IN ('self_hosted', 'self_hosted_smtp', 'smtp') THEN 'self_hosted' END
        FROM mail_provider_configs p WHERE p.company_id=d.company_id AND p.active
    ) WHERE d.company_id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.company_id END,
                            CASE WHEN TG_OP <> 'DELETE' THEN NEW.company_id END);
    RETURN NULL;
END $$;
CREATE TRIGGER mail_provider_sync_display AFTER INSERT OR UPDATE OR DELETE ON mail_provider_configs
    FOR EACH ROW EXECUTE FUNCTION sync_company_outbound_provider_display();

-- provider가 먼저 생성되는 초기 설치 및 domain 나중 생성 경로도 동일 정책을 표시한다.
CREATE FUNCTION derive_company_outbound_provider_display() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.active_outbound_provider_key := (
        SELECT CASE WHEN p.provider_type IN ('oci_email_delivery', 'oci_smtp') THEN 'oci_email_delivery'
                    WHEN p.provider_type IN ('self_hosted', 'self_hosted_smtp', 'smtp') THEN 'self_hosted' END
        FROM mail_provider_configs p WHERE p.company_id=NEW.company_id AND p.active
    );
    RETURN NEW;
END $$;
CREATE TRIGGER mail_domain_derive_provider BEFORE INSERT OR UPDATE OF active_outbound_provider_key, company_id ON mail_domain_settings
    FOR EACH ROW EXECUTE FUNCTION derive_company_outbound_provider_display();
