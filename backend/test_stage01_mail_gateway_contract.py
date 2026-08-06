import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MailGatewayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
        git_openssl = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")
        cls.bash = str(git_bash) if git_bash.exists() else shutil.which("bash")
        cls.openssl = str(git_openssl) if git_openssl.exists() else shutil.which("openssl")

    def _run_entrypoint_tls_validation(self, **environment: str) -> subprocess.CompletedProcess[str]:
        process_environment = os.environ.copy()
        for name in (
            "POSTGRES_HOST",
            "POSTGRES_PORT",
            "POSTGRES_DB",
            "POSTGRES_USER",
            "POSTGRES_PASSWORD",
            "MAIL_INGEST_TOKEN",
            "MAIL_INGEST_URL",
        ):
            process_environment.pop(name, None)
        process_environment.update(environment)
        return subprocess.run(
            [self.bash, str(ROOT / "deploy" / "mail-gateway" / "entrypoint.sh")],
            cwd=ROOT,
            env=process_environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

    def _create_certificate(self, directory: Path, hostname: str, name: str) -> tuple[Path, Path]:
        certificate = directory / f"{name}.crt"
        private_key = directory / f"{name}.key"
        subprocess.run(
            [
                self.openssl,
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(private_key),
                "-out",
                str(certificate),
                "-days",
                "1",
                "-subj",
                f"/CN={hostname}",
                "-addext",
                f"subjectAltName=DNS:{hostname}",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        return certificate, private_key

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
        self.assertIn("import_environment = MAIL_INGEST_TOKEN MAIL_INGEST_URL", main_cf)
        self.assertIn("export_environment = TZ MAIL_CONFIG LANG MAIL_INGEST_TOKEN MAIL_INGEST_URL", main_cf)
        self.assertIn("moaworks-ingest", master_cf)
        self.assertIn("flags=Rq", master_cf)
        self.assertIn("smtp      inet  n       -       n       -       -       smtpd", master_cf)
        self.assertIn("rewrite   unix  -       -       n       -       -       trivial-rewrite", master_cf)
        self.assertIn("/etc/postfix/main.cf.template", dockerfile)
        self.assertIn("chmod 0644 /etc/postfix/main.cf.template", dockerfile)
        self.assertIn("${SMTPD_TLS_SECURITY_LEVEL} ${SMTPD_TLS_CERT_FILE} ${SMTPD_TLS_KEY_FILE}", entrypoint)
        self.assertIn("chown root:postfix", entrypoint)
        self.assertIn("chmod 0640", entrypoint)

    def test_oracle_gateway_can_relay_only_explicit_test_domains(self) -> None:
        compose = (ROOT / "deploy" / "docker-compose.oracle.yml").read_text(encoding="utf-8")
        main_cf = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")
        entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")

        self.assertIn("SMTP_RELAY_DOMAINS: ${SMTP_RELAY_DOMAINS:-}", compose)
        self.assertIn("SMTP_RELAY_TRANSPORT_HOST: ${SMTP_RELAY_TRANSPORT_HOST:-}", compose)
        self.assertIn("SMTP_RELAY_TRANSPORT_PORT: ${SMTP_RELAY_TRANSPORT_PORT:-25}", compose)
        self.assertIn("relay_domains = ${SMTP_RELAY_DOMAINS}", main_cf)
        self.assertIn("transport_maps = hash:/etc/postfix/transport", main_cf)
        self.assertIn("${SMTPD_TLS_SECURITY_LEVEL} ${SMTPD_TLS_CERT_FILE} ${SMTPD_TLS_KEY_FILE}", entrypoint)
        self.assertIn("postmap /etc/postfix/transport", entrypoint)
        self.assertIn("SMTP_RELAY_TRANSPORT_HOST and SMTP_RELAY_DOMAINS must be configured together", entrypoint)
        self.assertNotIn("mynetworks = 0.0.0.0/0", main_cf)
        self.assertNotIn("permit_mynetworks", main_cf)

    def test_relay_recipient_verification_is_scoped_to_configured_relay_domains(self) -> None:
        main_cf = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")
        entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")
        parent_domain_features = (
            "debug_peer_list, fast_flush_domains, mynetworks, permit_mx_backup_networks, "
            "qmqpd_authorized_clients, postscreen_access_list, smtpd_client_event_limit_exceptions"
        )
        parent_domain_setting = next(
            line for line in main_cf.splitlines() if line.startswith("parent_domain_matches_subdomains = ")
        )
        restriction_classes_setting = next(
            line for line in main_cf.splitlines() if line.startswith("smtpd_restriction_classes = ")
        )

        self.assertIn(
            "reject_unauth_destination, check_recipient_access hash:/etc/postfix/relay-recipient-verification",
            main_cf,
        )
        self.assertEqual("smtpd_restriction_classes = verify_relay_recipient", restriction_classes_setting)
        self.assertIn("verify_relay_recipient = reject_unverified_recipient", main_cf)
        self.assertEqual(
            f"parent_domain_matches_subdomains = {parent_domain_features}",
            parent_domain_setting,
        )
        self.assertNotIn("relay_domains", parent_domain_setting)
        self.assertNotIn("transport_maps", parent_domain_setting)
        self.assertNotIn("smtpd_access_maps", parent_domain_setting)
        self.assertIn("unverified_recipient_reject_code = 550", main_cf)
        self.assertIn("unverified_recipient_defer_code = 450", main_cf)
        self.assertIn("unverified_recipient_tempfail_action = defer", main_cf)
        self.assertIn("unverified_recipient_reject_reason = Recipient address verification failed", main_cf)
        map_create_index = entrypoint.index(": > /etc/postfix/relay-recipient-verification")
        relay_domain_loop_index = entrypoint.index("if [ -n \"$relay_domains\" ]; then")
        map_compile_index = entrypoint.index("postmap /etc/postfix/relay-recipient-verification")
        self.assertLess(map_create_index, relay_domain_loop_index)
        self.assertGreater(map_compile_index, relay_domain_loop_index)
        self.assertIn(
            "printf '%s verify_relay_recipient\\n' \"$relay_domain\" >> /etc/postfix/relay-recipient-verification",
            entrypoint,
        )
        self.assertNotIn("sub.$relay_domain", entrypoint)
        self.assertNotIn(".$relay_domain verify_relay_recipient", entrypoint)
        self.assertNotIn("@$relay_domain verify_relay_recipient", entrypoint)
        self.assertIn("postmap /etc/postfix/relay-recipient-verification", entrypoint)
        self.assertIn(
            "/etc/postfix/relay-recipient-verification /etc/postfix/relay-recipient-verification.db",
            entrypoint,
        )
        self.assertRegex(
            entrypoint,
            r"chmod 0644 [^\n]*/etc/postfix/relay-recipient-verification [^\n]*/etc/postfix/relay-recipient-verification\.db",
        )

    def test_sinsan_relay_overlay_routes_only_dev_mail_to_wsl(self) -> None:
        overlay = (ROOT / "deploy" / "docker-compose.sinsan-relay.yml").read_text(encoding="utf-8")

        self.assertIn("SMTP_RELAY_DOMAINS: dev.moaworks.sinsan.kr", overlay)
        self.assertIn("SMTP_RELAY_TRANSPORT_HOST: 210.217.186.151", overlay)
        self.assertIn("SMTP_RELAY_TRANSPORT_PORT: 2525", overlay)
        self.assertNotIn("moaworks.sinsan.kr,", overlay)

    def test_tls_mode_contract_disables_false_starttls_and_rejects_unknown_modes(self) -> None:
        main_cf = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")

        self.assertIn("smtpd_tls_security_level = ${SMTPD_TLS_SECURITY_LEVEL}", main_cf)
        self.assertIn("smtpd_tls_cert_file = ${SMTPD_TLS_CERT_FILE}", main_cf)
        self.assertIn("smtpd_tls_key_file = ${SMTPD_TLS_KEY_FILE}", main_cf)
        self.assertIn("smtpd_tls_protocols = >=TLSv1.2", main_cf)
        self.assertIn("smtpd_tls_mandatory_protocols = >=TLSv1.2", main_cf)

        disabled = self._run_entrypoint_tls_validation(
            SMTP_TLS_MODE="disabled",
            MAIL_HOSTNAME="mail.dev.moaworks.sinsan.kr",
        )
        self.assertNotEqual(0, disabled.returncode)
        self.assertIn("POSTGRES_HOST is required", disabled.stderr)
        self.assertNotIn("SMTP TLS", disabled.stderr)

        unknown = self._run_entrypoint_tls_validation(
            SMTP_TLS_MODE="opportunistic",
            MAIL_HOSTNAME="mail.dev.moaworks.sinsan.kr",
        )
        self.assertNotEqual(0, unknown.returncode)
        self.assertIn("SMTP_TLS_MODE must be disabled or certificate", unknown.stderr)

    def test_certificate_mode_rejects_missing_invalid_hostname_and_key_mismatch(self) -> None:
        if not Path(self.bash).exists() or not Path(self.openssl).exists():
            self.skipTest("bash and openssl are required for the mail gateway TLS contract")

        hostname = "mail.dev.moaworks.sinsan.kr"
        with tempfile.TemporaryDirectory() as temp_directory:
            root = Path(temp_directory)
            valid_cert, valid_key = self._create_certificate(root, hostname, "valid")
            other_cert, other_key = self._create_certificate(root, "other.example.test", "other")
            invalid_cert = root / "invalid.crt"
            invalid_cert.write_text("not a certificate", encoding="utf-8")
            invalid_key = root / "invalid.key"
            invalid_key.write_text("not a private key", encoding="utf-8")

            base = {
                "SMTP_TLS_MODE": "certificate",
                "SMTP_TLS_CERT_ROOT": root.as_posix(),
                "MAIL_HOSTNAME": hostname,
            }

            missing = self._run_entrypoint_tls_validation(**base)
            self.assertIn("SMTP_TLS_CERT_FILE is required", missing.stderr)

            invalid = self._run_entrypoint_tls_validation(
                **base,
                SMTP_TLS_CERT_FILE=invalid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=valid_key.as_posix(),
            )
            self.assertIn("SMTP TLS certificate is invalid", invalid.stderr)

            invalid_private_key = self._run_entrypoint_tls_validation(
                **base,
                SMTP_TLS_CERT_FILE=valid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=invalid_key.as_posix(),
            )
            self.assertIn("SMTP TLS private key is invalid", invalid_private_key.stderr)

            hostname_mismatch = self._run_entrypoint_tls_validation(
                **base,
                SMTP_TLS_CERT_FILE=other_cert.as_posix(),
                SMTP_TLS_KEY_FILE=other_key.as_posix(),
            )
            self.assertIn("SMTP TLS certificate does not match MAIL_HOSTNAME", hostname_mismatch.stderr)

            key_mismatch = self._run_entrypoint_tls_validation(
                **base,
                SMTP_TLS_CERT_FILE=valid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=other_key.as_posix(),
            )
            self.assertIn("SMTP TLS certificate and private key do not match", key_mismatch.stderr)

            valid = self._run_entrypoint_tls_validation(
                **base,
                SMTP_TLS_CERT_FILE=valid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=valid_key.as_posix(),
            )
            self.assertIn("POSTGRES_HOST is required", valid.stderr)
            self.assertNotIn("SMTP TLS", valid.stderr)


if __name__ == "__main__":
    unittest.main()
