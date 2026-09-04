FROM debian:12-slim

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       ca-certificates curl dovecot-core dovecot-pgsql gettext-base openssl postfix postfix-pgsql \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/mail-gateway/main.cf /etc/postfix/main.cf.template
COPY deploy/mail-gateway/master.cf /etc/postfix/master.cf
COPY deploy/mail-gateway/dovecot.conf /etc/dovecot/dovecot.conf
COPY deploy/mail-gateway/dovecot-sql.conf.ext /etc/dovecot/dovecot-sql.conf.ext
COPY deploy/mail-gateway/pgsql-virtual-domains.cf.template /etc/postfix/pgsql-virtual-domains.cf.template
COPY deploy/mail-gateway/pgsql-virtual-recipients.cf.template /etc/postfix/pgsql-virtual-recipients.cf.template
COPY deploy/mail-gateway/moaworks-ingest.sh /usr/local/bin/moaworks-ingest.sh
COPY deploy/mail-gateway/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod 0755 /usr/local/bin/moaworks-ingest.sh /usr/local/bin/entrypoint.sh \
    && chmod 0644 /etc/postfix/main.cf.template /etc/postfix/master.cf /etc/dovecot/dovecot.conf \
       /etc/postfix/pgsql-virtual-domains.cf.template \
       /etc/postfix/pgsql-virtual-recipients.cf.template

EXPOSE 25
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
