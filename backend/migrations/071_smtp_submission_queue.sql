-- 기존 gateway/worker 큐를 재분류하거나 재발송하지 않는다.
ALTER TABLE mail_messages
    ADD COLUMN raw_storage_key TEXT NULL,
    ADD COLUMN raw_sha256 TEXT NULL,
    ADD COLUMN raw_size BIGINT NULL,
    ADD CONSTRAINT mail_messages_raw_submission_check CHECK (
        (raw_storage_key IS NULL AND raw_sha256 IS NULL AND raw_size IS NULL)
        OR (raw_storage_key IS NOT NULL AND raw_sha256 IS NOT NULL AND raw_size IS NOT NULL
            AND raw_sha256 ~ '^[0-9a-f]{64}$' AND raw_size > 0)
    );

ALTER TABLE mail_delivery_queue DROP CONSTRAINT mail_delivery_queue_delivery_kind_check;
ALTER TABLE mail_delivery_queue ADD CONSTRAINT mail_delivery_queue_delivery_kind_check
    CHECK (delivery_kind IN ('direct','auto_forward','out_of_office','submission'));

-- 메일 삭제 후에도 접수 tombstone은 유지: 응답 손실 재시도는 재발송하지 않는다.
CREATE TABLE mail_submission_messages (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    gateway_queue_id TEXT NOT NULL CHECK (gateway_queue_id ~ '^[A-Za-z0-9]{5,100}$'),
    original_sha256 TEXT NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
    raw_sha256 TEXT NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
    mail_message_id TEXT NULL REFERENCES mail_messages(id) ON DELETE SET NULL,
    stored_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (company_id,gateway_queue_id)
);
CREATE TABLE mail_submission_recipients (
    company_id TEXT NOT NULL,
    gateway_queue_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('queued','internal','spam','quarantine')),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (company_id,gateway_queue_id,recipient_email),
    FOREIGN KEY (company_id,gateway_queue_id)
        REFERENCES mail_submission_messages(company_id,gateway_queue_id) ON DELETE CASCADE
);

-- 25 수신은 기존 hash 정체성을 유지한다. 인증 submission은 gateway queue가 정체성이다.
-- 기존 행은 모두 NULL이므로 hash를 다시 쓰거나 과거 수신을 재분류하지 않는다.
ALTER TABLE mail_inbound_messages
    ADD COLUMN submission_queue_id TEXT NULL,
    ADD CONSTRAINT mail_inbound_submission_source_fkey
        FOREIGN KEY (company_id,submission_queue_id)
        REFERENCES mail_submission_messages(company_id,gateway_queue_id) ON DELETE NO ACTION;
ALTER TABLE mail_inbound_messages
    DROP CONSTRAINT mail_inbound_messages_company_id_content_sha256_key;
CREATE UNIQUE INDEX mail_inbound_25_content_unique
    ON mail_inbound_messages(company_id,content_sha256)
    WHERE submission_queue_id IS NULL;
CREATE UNIQUE INDEX mail_inbound_submission_queue_unique
    ON mail_inbound_messages(company_id,submission_queue_id)
    WHERE submission_queue_id IS NOT NULL;
