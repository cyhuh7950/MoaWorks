#!/usr/bin/env sh
set -eu

repo_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$repo_root"
env_file=".env"

if [ -e ".env" ]; then
  echo "기존 .env가 있어 덮어쓰지 않았습니다." >&2
  exit 1
fi

umask 077
: "${POSTGRES_PASSWORD:?local-postgres의 POSTGRES_PASSWORD를 환경변수로 제공해야 합니다.}"
db_name="${POSTGRES_DB:-moaworks}"
db_user="${POSTGRES_USER:-moaworks}"
mail_ingest_token="$(openssl rand -hex 32)"
admin_access_token="$(openssl rand -hex 32)"
setup_secret="$(openssl rand -hex 32)"

cat > "$env_file" <<EOF
APP_ENV=wsl-test
BACKEND_PORT=8510
FRONTEND_PORT=3510
USER_WEB_PORT=3520
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=$db_name
POSTGRES_USER=$db_user
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
MAIL_HOSTNAME=mail.dev.moaworks.sinsan.kr
MAIL_INGEST_TOKEN=$mail_ingest_token
ADMIN_ACCESS_CHECK_TOKEN=$admin_access_token
ADMIN_ACCESS_BOOTSTRAP_MODE=restricted
ADMIN_ACCESS_BOOTSTRAP_IPV4_CIDR=192.168.0.0/16
ADMIN_ACCESS_BOOTSTRAP_IPV6_CIDR=::1/128
TRUSTED_PROXY_CIDR=172.16.0.0/12
SETUP_SECRET_KEY=$setup_secret
OCI_EMAIL_API_ENABLED=false
TRANSLATION_ENABLED=false
EOF

chmod 600 "$env_file"
unset POSTGRES_PASSWORD db_name db_user mail_ingest_token admin_access_token setup_secret
echo "WSL 테스트용 .env를 생성했습니다. 비밀값은 출력하지 않았습니다."
