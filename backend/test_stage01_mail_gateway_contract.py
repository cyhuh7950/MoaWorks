import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


ROOT = Path(__file__).resolve().parents[1]


class MailGatewayContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        git_bash = Path(r"C:\Program Files\Git\bin\bash.exe")
        git_openssl = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")
        git_envsubst = Path(r"C:\Program Files\Git\mingw64\bin\envsubst.exe")
        cls.bash = str(git_bash) if git_bash.exists() else shutil.which("bash")
        cls.openssl = str(git_openssl) if git_openssl.exists() else shutil.which("openssl")
        cls.envsubst = str(git_envsubst) if git_envsubst.exists() else shutil.which("envsubst")

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

    def _create_ca_signed_certificate(
        self,
        directory: Path,
        hostname: str,
        name: str,
        not_before: datetime,
        not_after: datetime,
    ) -> tuple[Path, Path, Path]:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"{name} test CA")])
        now = datetime.now(timezone.utc)
        ca_certificate = (
            x509.CertificateBuilder()
            .subject_name(ca_name)
            .issuer_name(ca_name)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=30))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(ca_key, hashes.SHA256())
        )

        leaf_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, hostname)])
        leaf_certificate = (
            x509.CertificateBuilder()
            .subject_name(leaf_name)
            .issuer_name(ca_name)
            .public_key(leaf_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(not_before)
            .not_valid_after(not_after)
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname)]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),
                critical=False,
            )
            .sign(ca_key, hashes.SHA256())
        )

        certificate = directory / f"{name}.crt"
        private_key = directory / f"{name}.key"
        ca_file = directory / f"{name}-ca.crt"
        certificate.write_bytes(leaf_certificate.public_bytes(serialization.Encoding.PEM))
        private_key.write_bytes(
            leaf_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        ca_file.write_bytes(ca_certificate.public_bytes(serialization.Encoding.PEM))
        return certificate, private_key, ca_file

    def _render_main_cf(self, **environment: str) -> str:
        template = (ROOT / "deploy" / "mail-gateway" / "main.cf").read_text(encoding="utf-8")
        process_environment = os.environ.copy()
        process_environment.update(environment)
        result = subprocess.run(
            [
                self.envsubst,
                "${MAIL_HOSTNAME} ${SMTP_RELAY_DOMAINS} ${SMTPD_TLS_SECURITY_LEVEL} "
                "${SMTPD_TLS_CERT_FILE} ${SMTPD_TLS_KEY_FILE} ${SMTPD_SASL_AUTH_ENABLE}",
            ],
            input=template,
            env=process_environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        )
        return result.stdout

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

    def test_postfix_chroot_receives_container_dns_files_for_rspamd_resolution(self) -> None:
        entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")

        self.assertIn("mkdir -p /var/spool/postfix/etc", entrypoint)
        self.assertIn("cp /etc/resolv.conf /var/spool/postfix/etc/resolv.conf", entrypoint)
        self.assertIn("cp /etc/hosts /var/spool/postfix/etc/hosts", entrypoint)
        self.assertIn("chmod 0644 /var/spool/postfix/etc/resolv.conf /var/spool/postfix/etc/hosts", entrypoint)

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
        self.assertIn('smtpd_tls_security_level="none"', (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8"))

        rendered = self._render_main_cf(
            MAIL_HOSTNAME="mail.dev.moaworks.sinsan.kr",
            SMTP_RELAY_DOMAINS="",
            SMTPD_TLS_SECURITY_LEVEL="none",
            SMTPD_TLS_CERT_FILE="",
            SMTPD_TLS_KEY_FILE="",
        )
        self.assertIn("smtpd_tls_security_level = none", rendered)
        self.assertIn("smtpd_tls_cert_file = \n", rendered)
        self.assertIn("smtpd_tls_key_file = \n", rendered)
        self.assertNotIn("smtpd_tls_security_level = may", rendered)

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

    def test_smtp_auth_requires_certificate_tls_mode(self) -> None:
        result = self._run_entrypoint_tls_validation(
            SMTP_AUTH_ENABLED="true",
            SMTP_TLS_MODE="disabled",
            MAIL_HOSTNAME="mail.dev.moaworks.sinsan.kr",
        )

        self.assertNotEqual(0, result.returncode)
        self.assertIn("SMTP AUTH requires certificate TLS mode", result.stderr)
        self.assertNotIn("POSTGRES_HOST is required", result.stderr)

    def test_rendered_gateway_allows_authenticated_relay_only_after_tls(self) -> None:
        rendered = self._render_main_cf(
            MAIL_HOSTNAME="mail.dev.moaworks.sinsan.kr",
            SMTP_RELAY_DOMAINS="",
            SMTPD_TLS_SECURITY_LEVEL="may",
            SMTPD_TLS_CERT_FILE="/run/tls/fullchain.pem",
            SMTPD_TLS_KEY_FILE="/run/tls/privkey.pem",
            SMTPD_SASL_AUTH_ENABLE="yes",
        )

        self.assertIn("smtpd_sasl_type = dovecot", rendered)
        self.assertIn("smtpd_sasl_path = private/auth", rendered)
        self.assertIn("smtpd_sasl_auth_enable = yes", rendered)
        self.assertIn("smtpd_tls_auth_only = yes", rendered)
        restrictions = next(
            line for line in rendered.splitlines() if line.startswith("smtpd_recipient_restrictions =")
        )
        self.assertLess(restrictions.index("permit_sasl_authenticated"), restrictions.index("reject_unlisted_recipient"))
        self.assertIn("reject_unauth_destination", restrictions)

    def test_wsl_gateway_packages_and_configures_dovecot_auth_socket(self) -> None:
        dockerfile = (ROOT / "deploy" / "mail-gateway" / "Dockerfile").read_text(encoding="utf-8")
        entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")
        compose = (ROOT / "deploy" / "docker-compose.wsl.yml").read_text(encoding="utf-8")
        dovecot_config = ROOT / "deploy" / "mail-gateway" / "dovecot.conf"

        self.assertIn("dovecot-core", dockerfile)
        self.assertTrue(dovecot_config.is_file())
        self.assertIn("/var/spool/postfix/private/auth", dovecot_config.read_text(encoding="utf-8"))
        self.assertIn("SMTP_SUBMISSION_PASSWORD_HASH", entrypoint)
        self.assertIn("dovecot -c /etc/dovecot/dovecot.conf", entrypoint)
        self.assertIn("SMTP_AUTH_ENABLED: ${SMTP_AUTH_ENABLED:-false}", compose)
        self.assertIn('"25:25"', compose)
        self.assertNotIn('"2525:25"', compose)

    def test_certificate_mode_rejects_missing_invalid_hostname_and_key_mismatch(self) -> None:
        if not Path(self.bash).exists() or not Path(self.openssl).exists():
            self.skipTest("bash and openssl are required for the mail gateway TLS contract")

        hostname = "mail.dev.moaworks.sinsan.kr"
        with tempfile.TemporaryDirectory() as temp_directory:
            root = Path(temp_directory)
            certificate_name = "mail.dev.moaworks.sinsan.kr"
            live = root / "live" / certificate_name
            archive = root / "archive" / certificate_name
            live.mkdir(parents=True)
            archive.mkdir(parents=True)
            valid_cert, valid_key = self._create_certificate(live, hostname, "valid")
            other_cert, other_key = self._create_certificate(live, "other.example.test", "other")
            invalid_cert = live / "invalid.crt"
            invalid_cert.write_text("not a certificate", encoding="utf-8")
            invalid_key = live / "invalid.key"
            invalid_key.write_text("not a private key", encoding="utf-8")

            base = {
                "SMTP_TLS_MODE": "certificate",
                "SMTP_TLS_CERT_ROOT": root.as_posix(),
                "SMTP_TLS_CERT_NAME": certificate_name,
                "SMTP_TLS_CA_FILE": valid_cert.as_posix(),
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

    def test_certificate_mode_rejects_untrusted_expired_and_not_yet_valid_certificates(self) -> None:
        hostname = "mail.dev.moaworks.sinsan.kr"
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as temp_directory:
            root = Path(temp_directory)
            certificate_name = "mail.dev.moaworks.sinsan.kr"
            live = root / "live" / certificate_name
            archive = root / "archive" / certificate_name
            live.mkdir(parents=True)
            archive.mkdir(parents=True)
            valid_cert, valid_key, valid_ca = self._create_ca_signed_certificate(
                live,
                hostname,
                "valid-chain",
                now - timedelta(minutes=5),
                now + timedelta(days=1),
            )
            expired_cert, expired_key, expired_ca = self._create_ca_signed_certificate(
                live,
                hostname,
                "expired",
                now - timedelta(days=2),
                now - timedelta(days=1),
            )
            future_cert, future_key, future_ca = self._create_ca_signed_certificate(
                live,
                hostname,
                "future",
                now + timedelta(days=1),
                now + timedelta(days=2),
            )

            common = {
                "SMTP_TLS_MODE": "certificate",
                "SMTP_TLS_CERT_ROOT": root.as_posix(),
                "SMTP_TLS_CERT_NAME": certificate_name,
                "MAIL_HOSTNAME": hostname,
            }
            valid = self._run_entrypoint_tls_validation(
                **common,
                SMTP_TLS_CERT_FILE=valid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=valid_key.as_posix(),
                SMTP_TLS_CA_FILE=valid_ca.as_posix(),
            )
            self.assertIn("POSTGRES_HOST is required", valid.stderr)

            untrusted = self._run_entrypoint_tls_validation(
                **common,
                SMTP_TLS_CERT_FILE=valid_cert.as_posix(),
                SMTP_TLS_KEY_FILE=valid_key.as_posix(),
                SMTP_TLS_CA_FILE=expired_ca.as_posix(),
            )
            self.assertIn("SMTP TLS certificate trust or validity check failed", untrusted.stderr)

            expired = self._run_entrypoint_tls_validation(
                **common,
                SMTP_TLS_CERT_FILE=expired_cert.as_posix(),
                SMTP_TLS_KEY_FILE=expired_key.as_posix(),
                SMTP_TLS_CA_FILE=expired_ca.as_posix(),
            )
            self.assertIn("SMTP TLS certificate trust or validity check failed", expired.stderr)

            future = self._run_entrypoint_tls_validation(
                **common,
                SMTP_TLS_CERT_FILE=future_cert.as_posix(),
                SMTP_TLS_KEY_FILE=future_key.as_posix(),
                SMTP_TLS_CA_FILE=future_ca.as_posix(),
            )
            self.assertIn("SMTP TLS certificate trust or validity check failed", future.stderr)

    def test_certificate_mode_preserves_live_symlink_path_and_rejects_path_escape(self) -> None:
        hostname = "mail.dev.moaworks.sinsan.kr"
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as temp_directory:
            root = Path(temp_directory)
            certificate_name = "mail.dev.moaworks.sinsan.kr"
            live = root / "live" / certificate_name
            archive = root / "archive" / certificate_name
            outside = root.parent / f"{root.name}-outside"
            live.mkdir(parents=True)
            archive.mkdir(parents=True)
            outside.mkdir()
            try:
                cert, key, ca_file = self._create_ca_signed_certificate(
                    archive,
                    hostname,
                    "fullchain1",
                    now - timedelta(minutes=5),
                    now + timedelta(days=1),
                )
                live_cert = live / "fullchain.pem"
                live_key = live / "privkey.pem"
                live_cert.symlink_to(Path("..") / ".." / "archive" / certificate_name / cert.name)
                live_key.symlink_to(Path("..") / ".." / "archive" / certificate_name / key.name)

                common = {
                    "SMTP_TLS_MODE": "certificate",
                    "SMTP_TLS_CERT_ROOT": root.as_posix(),
                    "SMTP_TLS_CERT_NAME": certificate_name,
                    "SMTP_TLS_CA_FILE": ca_file.as_posix(),
                    "MAIL_HOSTNAME": hostname,
                }
                valid = self._run_entrypoint_tls_validation(
                    **common,
                    SMTP_TLS_CERT_FILE=live_cert.as_posix(),
                    SMTP_TLS_KEY_FILE=live_key.as_posix(),
                )
                self.assertIn("POSTGRES_HOST is required", valid.stderr)

                rendered = self._render_main_cf(
                    MAIL_HOSTNAME=hostname,
                    SMTP_RELAY_DOMAINS="",
                    SMTPD_TLS_SECURITY_LEVEL="may",
                    SMTPD_TLS_CERT_FILE=live_cert.as_posix(),
                    SMTPD_TLS_KEY_FILE=live_key.as_posix(),
                )
                self.assertIn(f"smtpd_tls_cert_file = {live_cert.as_posix()}", rendered)
                self.assertIn(f"smtpd_tls_key_file = {live_key.as_posix()}", rendered)
                self.assertNotIn(cert.resolve().as_posix(), rendered)
                entrypoint = (ROOT / "deploy" / "mail-gateway" / "entrypoint.sh").read_text(encoding="utf-8")
                self.assertIn('smtpd_tls_cert_file="$SMTP_TLS_CERT_FILE"', entrypoint)
                self.assertIn('smtpd_tls_key_file="$SMTP_TLS_KEY_FILE"', entrypoint)

                outside_cert, outside_key, _ = self._create_ca_signed_certificate(
                    outside,
                    hostname,
                    "outside",
                    now - timedelta(minutes=5),
                    now + timedelta(days=1),
                )
                live_cert.unlink()
                live_key.unlink()
                live_cert.symlink_to(outside_cert)
                live_key.symlink_to(outside_key)
                escaped = self._run_entrypoint_tls_validation(
                    **common,
                    SMTP_TLS_CERT_FILE=live_cert.as_posix(),
                    SMTP_TLS_KEY_FILE=live_key.as_posix(),
                )
                self.assertIn("must resolve inside the mounted certificate directories", escaped.stderr)
            finally:
                shutil.rmtree(outside, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
