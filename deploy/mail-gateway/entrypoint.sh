#!/bin/sh
set -eu

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${MAIL_INGEST_TOKEN:?MAIL_INGEST_TOKEN is required}"
: "${MAIL_INGEST_URL:?MAIL_INGEST_URL is required}"
: "${MAIL_HOSTNAME:?MAIL_HOSTNAME is required}"

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
export SMTP_RELAY_DOMAINS
envsubst '${MAIL_HOSTNAME} ${SMTP_RELAY_DOMAINS}' < /etc/postfix/main.cf.template > /etc/postfix/main.cf
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
