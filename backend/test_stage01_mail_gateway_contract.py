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
        self.assertNotIn("127.0.0.1:${BACKEND_PORT:-8510}:8000\n", compose)

    def test_gateway_rejects_unknown_recipient_and_delivers_only_after_internal_ingest(self) -> None:
        main_cf = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")
        master_cf = (ROOT / "deploy" / "mail-gateway" / "master.cf").read_text(encoding="utf-8")

        self.assertIn("reject_unlisted_recipient", main_cf)
        self.assertIn("smtpd_recipient_restrictions", main_cf)
        self.assertIn("moaworks-ingest", master_cf)
        self.assertIn("flags=Rq", master_cf)


if __name__ == "__main__":
    unittest.main()
