UPDATE mail_messages AS m
SET status = 'sent',
    updated_at = GREATEST(m.updated_at, NOW())
WHERE m.status = 'received'
  AND EXISTS (
      SELECT 1
      FROM mail_recipients AS r
      WHERE r.message_id = m.id
        AND r.delivery_source = 'external_smtp'
  );
