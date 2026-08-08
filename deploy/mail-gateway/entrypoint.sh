#!/bin/sh
set -eu

: "${MAIL_HOSTNAME:?MAIL_HOSTNAME is required}"

tls_mode="${SMTP_TLS_MODE:-disabled}"
tls_root="${SMTP_TLS_CERT_ROOT:-/run/moaworks-mail-tls}"
smtpd_tls_security_level="none"
smtpd_tls_cert_file=""
smtpd_tls_key_file=""

case "$tls_mode" in
    disabled)
        ;;
    certificate)
        : "${SMTP_TLS_CERT_NAME:?SMTP_TLS_CERT_NAME is required when SMTP_TLS_MODE=certificate}"
        : "${SMTP_TLS_CERT_FILE:?SMTP_TLS_CERT_FILE is required when SMTP_TLS_MODE=certificate}"
        : "${SMTP_TLS_KEY_FILE:?SMTP_TLS_KEY_FILE is required when SMTP_TLS_MODE=certificate}"
        tls_ca_file="${SMTP_TLS_CA_FILE:-/etc/ssl/certs/ca-certificates.crt}"

        case "$SMTP_TLS_CERT_NAME" in
            ''|*[!A-Za-z0-9._-]*|.*|*.) echo "SMTP_TLS_CERT_NAME is invalid" >&2; exit 1 ;;
        esac

        if [ ! -d "$tls_root" ]; then
            echo "SMTP TLS certificate root is not a directory" >&2
            exit 1
        fi
        tls_live_dir="$tls_root/live/$SMTP_TLS_CERT_NAME"
        tls_archive_dir="$tls_root/archive/$SMTP_TLS_CERT_NAME"
        if [ ! -d "$tls_live_dir" ] || [ ! -d "$tls_archive_dir" ]; then
            echo "SMTP TLS selected live and archive directories must both be mounted" >&2
            exit 1
        fi
        if [ ! -f "$SMTP_TLS_CERT_FILE" ]; then
            echo "SMTP TLS certificate file does not exist" >&2
            exit 1
        fi
        if [ ! -f "$SMTP_TLS_KEY_FILE" ]; then
            echo "SMTP TLS private key file does not exist" >&2
            exit 1
        fi
        if [ ! -f "$tls_ca_file" ]; then
            echo "SMTP TLS CA file does not exist" >&2
            exit 1
        fi

        case "$SMTP_TLS_CERT_FILE" in
            "$tls_live_dir"/*) ;;
            *) echo "SMTP TLS certificate path must be inside the selected live directory" >&2; exit 1 ;;
        esac
        case "$SMTP_TLS_KEY_FILE" in
            "$tls_live_dir"/*) ;;
            *) echo "SMTP TLS private key path must be inside the selected live directory" >&2; exit 1 ;;
        esac

        tls_live_real="$(readlink -f "$tls_live_dir")"
        tls_archive_real="$(readlink -f "$tls_archive_dir")"
        tls_cert_real="$(readlink -f "$SMTP_TLS_CERT_FILE")"
        tls_key_real="$(readlink -f "$SMTP_TLS_KEY_FILE")"
        case "$tls_cert_real" in
            "$tls_live_real"/*|"$tls_archive_real"/*) ;;
            *) echo "SMTP TLS certificate and private key must resolve inside the mounted certificate directories" >&2; exit 1 ;;
        esac
        case "$tls_key_real" in
            "$tls_live_real"/*|"$tls_archive_real"/*) ;;
            *) echo "SMTP TLS certificate and private key must resolve inside the mounted certificate directories" >&2; exit 1 ;;
        esac

        if ! openssl x509 -in "$tls_cert_real" -noout >/dev/null 2>&1; then
            echo "SMTP TLS certificate is invalid" >&2
            exit 1
        fi
        if ! openssl pkey -in "$tls_key_real" -noout >/dev/null 2>&1; then
            echo "SMTP TLS private key is invalid" >&2
            exit 1
        fi
        if ! openssl verify -no_check_time -partial_chain -trusted "$tls_cert_real" \
            -verify_hostname "$MAIL_HOSTNAME" "$tls_cert_real" >/dev/null 2>&1; then
            echo "SMTP TLS certificate does not match MAIL_HOSTNAME" >&2
            exit 1
        fi
        if ! openssl verify -purpose sslserver -CAfile "$tls_ca_file" \
            -untrusted "$tls_cert_real" "$tls_cert_real" >/dev/null 2>&1; then
            echo "SMTP TLS certificate trust or validity check failed" >&2
            exit 1
        fi

        tls_compare_dir="$(mktemp -d)"
        trap 'rm -rf "$tls_compare_dir"' EXIT HUP INT TERM
        if ! openssl x509 -in "$tls_cert_real" -pubkey -noout 2>/dev/null \
            | openssl pkey -pubin -outform DER -out "$tls_compare_dir/certificate.pub" 2>/dev/null; then
            echo "SMTP TLS certificate public key is invalid" >&2
            exit 1
        fi
        if ! openssl pkey -in "$tls_key_real" -pubout -outform DER \
            -out "$tls_compare_dir/private-key.pub" >/dev/null 2>&1; then
            echo "SMTP TLS private key is invalid" >&2
            exit 1
        fi
        if ! cmp -s "$tls_compare_dir/certificate.pub" "$tls_compare_dir/private-key.pub"; then
            echo "SMTP TLS certificate and private key do not match" >&2
            exit 1
        fi
        rm -rf "$tls_compare_dir"
        trap - EXIT HUP INT TERM

        smtpd_tls_security_level="may"
        smtpd_tls_cert_file="$SMTP_TLS_CERT_FILE"
        smtpd_tls_key_file="$SMTP_TLS_KEY_FILE"
        ;;
    *)
        echo "SMTP_TLS_MODE must be disabled or certificate" >&2
        exit 1
        ;;
esac

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${MAIL_INGEST_TOKEN:?MAIL_INGEST_TOKEN is required}"
: "${MAIL_INGEST_URL:?MAIL_INGEST_URL is required}"

relay_domains="${SMTP_RELAY_DOMAINS:-}"
relay_host="${SMTP_RELAY_TRANSPORT_HOST:-}"
relay_port="${SMTP_RELAY_TRANSPORT_PORT:-25}"

if { [ -n "$relay_domains" ] && [ -z "$relay_host" ]; } || \
   { [ -z "$relay_domains" ] && [ -n "$relay_host" ]; }; then
    echo "SMTP_RELAY_TRANSPORT_HOST and SMTP_RELAY_DOMAINS must be configured together" >&2
    exit 1
fi

case "$relay_port" in
    ''|*[!0-9]*) echo "SMTP_RELAY_TRANSPORT_PORT must be numeric" >&2; exit 1 ;;
esac
if [ "$relay_port" -lt 1 ] || [ "$relay_port" -gt 65535 ]; then
    echo "SMTP_RELAY_TRANSPORT_PORT must be between 1 and 65535" >&2
    exit 1
fi

: > /etc/postfix/transport
: > /etc/postfix/relay-recipient-verification
if [ -n "$relay_domains" ]; then
    case "$relay_host" in
        *[!A-Za-z0-9.-]*|.*|*.) echo "SMTP_RELAY_TRANSPORT_HOST is invalid" >&2; exit 1 ;;
    esac

    previous_ifs="$IFS"
    IFS=', '
    for relay_domain in $relay_domains; do
        case "$relay_domain" in
            ''|*[!a-z0-9.-]*|.*|*.) echo "SMTP_RELAY_DOMAINS contains an invalid domain" >&2; exit 1 ;;
        esac
        printf '%s smtp:[%s]:%s\n' "$relay_domain" "$relay_host" "$relay_port" >> /etc/postfix/transport
        printf '%s verify_relay_recipient\n' "$relay_domain" >> /etc/postfix/relay-recipient-verification
    done
    IFS="$previous_ifs"
fi

SMTP_RELAY_DOMAINS="$relay_domains"
SMTPD_TLS_SECURITY_LEVEL="$smtpd_tls_security_level"
SMTPD_TLS_CERT_FILE="$smtpd_tls_cert_file"
SMTPD_TLS_KEY_FILE="$smtpd_tls_key_file"
export SMTP_RELAY_DOMAINS SMTPD_TLS_SECURITY_LEVEL SMTPD_TLS_CERT_FILE SMTPD_TLS_KEY_FILE
envsubst '${MAIL_HOSTNAME} ${SMTP_RELAY_DOMAINS} ${SMTPD_TLS_SECURITY_LEVEL} ${SMTPD_TLS_CERT_FILE} ${SMTPD_TLS_KEY_FILE}' < /etc/postfix/main.cf.template > /etc/postfix/main.cf
envsubst < /etc/postfix/pgsql-virtual-domains.cf.template > /etc/postfix/pgsql-virtual-domains.cf
envsubst < /etc/postfix/pgsql-virtual-recipients.cf.template > /etc/postfix/pgsql-virtual-recipients.cf
chown root:postfix /etc/postfix/pgsql-virtual-domains.cf /etc/postfix/pgsql-virtual-recipients.cf
chmod 0640 /etc/postfix/pgsql-virtual-domains.cf /etc/postfix/pgsql-virtual-recipients.cf
postmap /etc/postfix/transport
postmap /etc/postfix/relay-recipient-verification
chown root:root /etc/postfix/transport /etc/postfix/transport.db /etc/postfix/relay-recipient-verification /etc/postfix/relay-recipient-verification.db
chmod 0644 /etc/postfix/transport /etc/postfix/transport.db /etc/postfix/relay-recipient-verification /etc/postfix/relay-recipient-verification.db
postfix check
exec postfix start-fg
