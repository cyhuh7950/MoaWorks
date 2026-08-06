#!/bin/sh
set -eu

cert_name="${MAIL_RENEW_CERT_NAME:-moaworks-mail-dev}"
npm_container="${MAIL_RENEW_NPM_CONTAINER:-npm}"
gateway_container="${MAIL_RENEW_GATEWAY_CONTAINER:-moaworks-mail-gateway}"
cert_path="${MAIL_RENEW_CERT_PATH:-/etc/letsencrypt/live/moaworks-mail-dev/fullchain.pem}"
certbot_config="${MAIL_RENEW_CERTBOT_CONFIG:-/etc/letsencrypt.ini}"
lock_dir="${MAIL_RENEW_LOCK_DIR:-/run/lock/moaworks-mail-certificate-renew.lock}"
dry_run=false

usage() {
    cat <<'EOF'
Usage: renew-mail-gateway-certificate.sh [options]
  --cert-name NAME
  --npm-container NAME
  --gateway-container NAME
  --cert-path ABSOLUTE_PATH
  --certbot-config ABSOLUTE_PATH
  --lock-dir ABSOLUTE_PATH
  --dry-run
EOF
}

fail() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

log() {
    printf '%s\n' "$1"
}

require_value() {
    [ "$#" -ge 2 ] || fail "$1 requires a value"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --cert-name)
            require_value "$@"
            cert_name="$2"
            shift 2
            ;;
        --npm-container)
            require_value "$@"
            npm_container="$2"
            shift 2
            ;;
        --gateway-container)
            require_value "$@"
            gateway_container="$2"
            shift 2
            ;;
        --cert-path)
            require_value "$@"
            cert_path="$2"
            shift 2
            ;;
        --certbot-config)
            require_value "$@"
            certbot_config="$2"
            shift 2
            ;;
        --lock-dir)
            require_value "$@"
            lock_dir="$2"
            shift 2
            ;;
        --dry-run)
            dry_run=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "unknown option"
            ;;
    esac
done

validate_name() {
    case "$2" in
        ''|[!A-Za-z0-9]*|*[!A-Za-z0-9_.-]*) fail "$1 is invalid" ;;
    esac
}

validate_absolute_path() {
    case "$2" in
        /*) ;;
        *) fail "$1 must be an absolute path" ;;
    esac
    case "$2" in
        *[!A-Za-z0-9_./-]*) fail "$1 contains an invalid character" ;;
    esac
}

validate_name "certificate name" "$cert_name"
validate_name "NPM container" "$npm_container"
validate_name "gateway container" "$gateway_container"
validate_absolute_path "certificate path" "$cert_path"
validate_absolute_path "certbot config" "$certbot_config"
validate_absolute_path "lock directory" "$lock_dir"

command -v docker >/dev/null 2>&1 || fail "docker command is not available"

if ! mkdir "$lock_dir" 2>/dev/null; then
    fail "certificate renewal is already running"
fi
cleanup() {
    rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

container_is_running() {
    [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" = "true" ]
}

container_is_running "$npm_container" || fail "NPM container is not running"
container_is_running "$gateway_container" || fail "mail gateway container is not running"

if ! docker exec "$npm_container" test -f "$cert_path" >/dev/null 2>&1; then
    fail "certificate file does not exist in NPM container"
fi

certificate_hash() {
    hash_output="$(docker exec "$npm_container" sha256sum "$cert_path" 2>/dev/null)" || return 1
    set -- $hash_output
    cert_hash="${1:-}"
    [ "${#cert_hash}" -eq 64 ] || return 1
    case "$cert_hash" in
        *[!0-9A-Fa-f]*) return 1 ;;
    esac
    printf '%s\n' "$cert_hash"
}

before_hash="$(certificate_hash)" || fail "failed to hash certificate before renewal"

set -- docker exec "$npm_container" certbot renew \
    --config "$certbot_config" \
    --cert-name "$cert_name" \
    --non-interactive \
    --no-random-sleep-on-renew
if [ "$dry_run" = "true" ]; then
    set -- "$@" --dry-run
fi
if ! "$@"; then
    fail "certbot renewal failed"
fi

after_hash="$(certificate_hash)" || fail "failed to hash certificate after renewal"
if [ "$before_hash" = "$after_hash" ]; then
    log "certificate unchanged; mail gateway restart skipped"
    exit 0
fi

if ! docker restart "$gateway_container" >/dev/null; then
    fail "mail gateway restart failed"
fi

gateway_state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$gateway_container" 2>/dev/null)" || \
    fail "mail gateway state verification failed"
set -- $gateway_state
[ "${1:-}" = "running" ] || fail "mail gateway is not running after restart"
case "${2:-}" in
    ''|*[!0-9]*) fail "mail gateway restart count is invalid" ;;
esac

if ! docker exec "$gateway_container" postfix check; then
    fail "postfix check failed after certificate renewal"
fi

log "certificate changed; mail gateway restarted and verified"
