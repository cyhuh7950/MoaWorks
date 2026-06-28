UPDATE roles
SET permissions = (
    SELECT jsonb_agg(permission ORDER BY permission)
    FROM (
        SELECT jsonb_array_elements_text(permissions) AS permission
        UNION
        SELECT permission
        FROM (
            VALUES
                ('mail:read'),
                ('mail:send'),
                ('messenger:read'),
                ('messenger:write')
        ) AS required_permissions(permission)
    ) merged_permissions
)
WHERE name = '일반사용자'
  AND NOT (permissions ? 'admin:*');
