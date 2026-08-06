#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
env_file="$repo_root/.env"
db_container="${DB_CONTAINER:-local-postgres}"
db_name="${POSTGRES_DB:-moaworks}"
db_user="${POSTGRES_USER:-moaworks}"

case "$db_container" in
  *[!A-Za-z0-9_.-]*|'') echo "허용되지 않은 DB 컨테이너 이름입니다." >&2; exit 1 ;;
esac
case "$db_name" in
  *[!a-z0-9_]*|'') echo "허용되지 않은 DB 이름입니다." >&2; exit 1 ;;
esac
case "$db_user" in
  *[!a-z0-9_]*|'') echo "허용되지 않은 DB 역할 이름입니다." >&2; exit 1 ;;
esac

test -f "$env_file"
docker inspect "$db_container" >/dev/null
umask 077
db_password="$(openssl rand -hex 32)"

{
  printf "\\set role_password '%s'\n" "$db_password"
  cat <<SQL
DO \$do\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$db_user') THEN
    CREATE ROLE $db_user LOGIN;
  END IF;
END
\$do\$;
ALTER ROLE $db_user PASSWORD :'role_password';
ALTER DATABASE $db_name OWNER TO $db_user;
\\connect $db_name
ALTER SCHEMA public OWNER TO $db_user;
DO \$do\$
DECLARE
  item record;
  object_type text;
BEGIN
  FOR item IN
    SELECT c.relkind, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  LOOP
    object_type := CASE item.relkind
      WHEN 'S' THEN 'SEQUENCE'
      WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'f' THEN 'FOREIGN TABLE'
      ELSE 'TABLE'
    END;
    EXECUTE format('ALTER %s %I.%I OWNER TO $db_user', object_type, item.nspname, item.relname);
  END LOOP;
END
\$do\$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $db_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $db_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO $db_user;
SQL
} | docker exec -i "$db_container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null

temp_env="$(mktemp "$repo_root/.env.XXXXXX")"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    POSTGRES_DB=*) printf 'POSTGRES_DB=%s\n' "$db_name" ;;
    POSTGRES_USER=*) printf 'POSTGRES_USER=%s\n' "$db_user" ;;
    POSTGRES_PASSWORD=*) printf 'POSTGRES_PASSWORD=%s\n' "$db_password" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$temp_env"
chmod 600 "$temp_env"
mv "$temp_env" "$env_file"
unset db_password
echo "WSL MoaWorks 전용 DB 역할과 .env 연결을 갱신했습니다. 비밀값은 출력하지 않았습니다."
