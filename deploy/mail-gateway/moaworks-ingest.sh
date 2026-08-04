#!/bin/sh
set -eu

envelope_from="${1:-}"
recipient="${2:-}"
test -n "$recipient"

exec curl --silent --show-error --fail-with-body \
  --connect-timeout 10 --max-time 120 \
  -H "Content-Type: message/rfc822" \
  -H "X-MoaWorks-Ingest-Token: ${MAIL_INGEST_TOKEN}" \
  -H "X-MoaWorks-Envelope-From: ${envelope_from}" \
  -H "X-MoaWorks-Envelope-To: ${recipient}" \
  --data-binary @- \
  "${MAIL_INGEST_URL}"
