import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MailGatewayContractTest(unittest.TestCase):
    def test_oracle_compose_exposes_only_smtp_gateway_and_persists_spool(self) -> None:
        compose = (ROOT / "deploy" / "docker-compose.oracle.yml").read_text(encoding="utf-8")

        self.assertIn("mail-gateway:", compose)
        self.assertIn('"25:25"', compose)
        self.assertIn("mail-spool:", compose)
        self.assertIn("rspamd:", compose)
        self.assertIn("clamav:", compose)
        self.assertIn("image: clamav/clamav-debian:1.4.3", compose)
        self.assertIn('"127.0.0.1:${BACKEND_PORT:-8510}:8000"', compose)

    def test_gateway_rejects_unknown_recipient_and_delivers_only_after_internal_ingest(self) -> None:
        main_cf = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")
        master_cf = (ROOT / "deploy" / "mail-gateway" / "master.cf").read_text(encoding="utf-8")
        dockerfile = (ROOT / "deploy" / "mail-gateway" / "Dockerfile").read_text(encoding="utf-8")
        entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")

        self.assertIn("reject_unlisted_recipient", main_cf)
        self.assertIn("smtpd_recipient_restrictions", main_cf)
        self.assertIn("virtual_mailbox_domains = pgsql:", main_cf)
        self.assertIn("virtual_mailbox_maps = pgsql:", main_cf)
        self.assertNotIn("proxy:pgsql:", main_cf)
        self.assertIn("maillog_file = /dev/stdout", main_cf)
        self.assertIn("moaworks-ingest", master_cf)
        self.assertIn("flags=Rq", master_cf)
        self.assertIn("smtp      inet  n       -       n       -       -       smtpd", master_cf)
        self.assertIn("rewrite   unix  -       -       n       -       -       trivial-rewrite", master_cf)
        self.assertIn("/etc/postfix/main.cf.template", dockerfile)
        self.assertIn("chmod 0644 /etc/postfix/main.cf.template", dockerfile)
        self.assertIn("envsubst '${MAIL_HOSTNAME}'", entrypoint)
        self.assertIn("chown root:postfix", entrypoint)
        self.assertIn("chmod 0640", entrypoint)


if __name__ == "__main__":
    unittest.main()
