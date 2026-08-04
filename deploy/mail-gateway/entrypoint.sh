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

envsubst < /etc/postfix/pgsql-virtual-domains.cf.template > /etc/postfix/pgsql-virtual-domains.cf
envsubst < /etc/postfix/pgsql-virtual-recipients.cf.template > /etc/postfix/pgsql-virtual-recipients.cf
chmod 0600 /etc/postfix/pgsql-virtual-domains.cf /etc/postfix/pgsql-virtual-recipients.cf
postfix check
exec postfix start-fg
