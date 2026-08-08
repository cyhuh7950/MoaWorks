#!/bin/sh
set -eu
umask 077

cert_name="${MAIL_RENEW_CERT_NAME:-moaworks-mail-dev}"
npm_container="${MAIL_RENEW_NPM_CONTAINER:-npm}"
gateway_container="${MAIL_RENEW_GATEWAY_CONTAINER:-moaworks-mail-gateway}"
cert_path="${MAIL_RENEW_CERT_PATH:-/etc/letsencrypt/live/moaworks-mail-dev/fullchain.pem}"
certbot_config="${MAIL_RENEW_CERTBOT_CONFIG:-/etc/letsencrypt.ini}"
lock_dir="${MAIL_RENEW_LOCK_DIR:-/run/lock/moaworks-mail-certificate-renew.lock}"
stabilization_seconds="${MAIL_RENEW_STABILIZATION_SECONDS:-5}"
state_dir="${MAIL_RENEW_STATE_DIR:-/var/lib/moaworks/mail-certificate-renew}"
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
  --stabilization-seconds SECONDS
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
        --stabilization-seconds)
            require_value "$@"
            stabilization_seconds="$2"
            shift 2
            ;;
        --state-file)
            fail "--state-file is no longer supported; use MAIL_RENEW_STATE_DIR"
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
validate_absolute_path "state directory" "$state_dir"
[ "${MAIL_RENEW_STATE_FILE+x}" != x ] || fail "MAIL_RENEW_STATE_FILE is no longer supported; use MAIL_RENEW_STATE_DIR"
case "$state_dir" in
    /|/var|/var/|/var/lib|/var/lib/|/var/lib/moaworks|/var/lib/moaworks/)
        fail "state directory is not a dedicated directory"
        ;;
esac
case "$state_dir" in
    */) fail "state directory must not end with a slash" ;;
esac
case "$stabilization_seconds" in
    ''|*[!0-9]*) fail "stabilization seconds is invalid" ;;
esac
[ "$stabilization_seconds" -le 300 ] || fail "stabilization seconds must not exceed 300"
expected_cert_path="/etc/letsencrypt/live/$cert_name/fullchain.pem"
[ "$cert_path" = "$expected_cert_path" ] || fail "certificate path must match certificate name"
state_file="$state_dir/loaded.sha256"

command -v docker >/dev/null 2>&1 || fail "docker command is not available"

if ! mkdir "$lock_dir" 2>/dev/null; then
    fail "certificate renewal is already running"
fi
state_tmp=""
cleanup() {
    [ -z "$state_tmp" ] || rm -f "$state_tmp"
    rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

if [ -L "$state_dir" ]; then
    fail "certificate state directory must not be a symlink"
fi
if [ ! -d "$state_dir" ]; then
    [ ! -e "$state_dir" ] || fail "certificate state path is not a directory"
    state_parent="${state_dir%/*}"
    [ -n "$state_parent" ] || state_parent="/"
    [ -d "$state_parent" ] || fail "certificate state directory parent does not exist"
    [ ! -L "$state_parent" ] || fail "certificate state directory parent must not be a symlink"
    mkdir -m 700 "$state_dir" || fail "failed to create certificate state directory"
    if ! chown 0:0 "$state_dir"; then
        rmdir "$state_dir" 2>/dev/null || true
        fail "failed to set certificate state directory owner"
    fi
    chmod 700 "$state_dir" || fail "failed to secure certificate state directory"
fi
state_dir_metadata="$(stat -c '%u:%g:%a' "$state_dir" 2>/dev/null || true)"
[ "$state_dir_metadata" = "0:0:700" ] || fail "certificate state directory must be root-owned with mode 0700"

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

current_hash="$(certificate_hash)" || fail "failed to hash current certificate after renewal"
loaded_hash=""
if [ -e "$state_file" ] || [ -L "$state_file" ]; then
    [ ! -L "$state_file" ] || fail "certificate state file must not be a symlink"
    [ -f "$state_file" ] || fail "certificate state path is not a regular file"
    loaded_hash="$(cat "$state_file")" || fail "failed to read loaded certificate state"
    [ "${#loaded_hash}" -eq 64 ] || fail "loaded certificate state is invalid"
    case "$loaded_hash" in
        *[!0-9A-Fa-f]*) fail "loaded certificate state is invalid" ;;
    esac
fi

if [ "$loaded_hash" = "$current_hash" ]; then
    log "certificate unchanged; mail gateway restart skipped"
    exit 0
fi

if ! docker restart "$gateway_container" >/dev/null; then
    fail "mail gateway restart failed"
fi

first_gateway_state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$gateway_container" 2>/dev/null)" || \
    fail "initial mail gateway state verification failed"
set -- $first_gateway_state
first_gateway_status="${1:-}"
first_restart_count="${2:-}"
[ "$first_gateway_status" = "running" ] || fail "mail gateway is not running after restart"
case "$first_restart_count" in
    ''|*[!0-9]*) fail "mail gateway restart count is invalid" ;;
esac

sleep "$stabilization_seconds"

second_gateway_state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$gateway_container" 2>/dev/null)" || \
    fail "mail gateway state verification failed after stabilization"
set -- $second_gateway_state
second_gateway_status="${1:-}"
second_restart_count="${2:-}"
[ "$second_gateway_status" = "running" ] || fail "mail gateway is not running after stabilization"
case "$second_restart_count" in
    ''|*[!0-9]*) fail "mail gateway restart count is invalid after stabilization" ;;
esac
[ "$second_restart_count" = "$first_restart_count" ] || \
    fail "mail gateway restart count changed during stabilization"

if ! docker exec "$gateway_container" postfix check; then
    fail "postfix check failed after certificate renewal"
fi

final_hash="$(certificate_hash)" || fail "failed to hash certificate after gateway restart"
[ "$final_hash" = "$current_hash" ] || fail "certificate changed during gateway restart; state was not written"

state_tmp="${state_file}.tmp.$$"
if ! printf '%s\n' "$current_hash" > "$state_tmp"; then
    fail "failed to write loaded certificate state"
fi
chmod 600 "$state_tmp" || fail "failed to secure loaded certificate state"
mv -f "$state_tmp" "$state_file" || fail "failed to commit loaded certificate state"
state_tmp=""

log "certificate changed; mail gateway restarted and verified"
