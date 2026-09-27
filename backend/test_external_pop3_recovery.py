import poplib
import unittest
from contextlib import ExitStack
from io import BytesIO
from unittest.mock import patch

from app.services.mail_external_service import MailExternalPop3Client
from app.workers import mail_external_worker as worker


class WireSocket:
    def __init__(self, wire):
        self.reader = BytesIO(wire)
        self.commands = []

    def makefile(self, mode):
        return self.reader

    def sendall(self, data):
        self.commands.append(data)

    def close(self):
        pass

    def shutdown(self, how):
        pass


class Pop3RetrievalTests(unittest.TestCase):
    def connect(self, wire, mode="ssl"):
        sock = WireSocket(wire)
        context = type("Context", (), {"wrap_socket": lambda self, raw, **kw: raw})()
        with patch("app.services.mail_external_service.socket.create_connection", return_value=sock), patch(
            "app.services.mail_external_service.ssl.create_default_context", return_value=context
        ), patch.object(poplib.POP3, "stls", return_value=b"+OK"):
            client = MailExternalPop3Client()._connect("mail.example.com", 995 if mode == "ssl" else 110, mode, ("8.8.8.8",))
        self.addCleanup(client.close)
        return client, sock

    def test_long_html_line_is_read_on_both_tls_transports(self):
        body = b"<p>" + b"x" * 12000 + b"</p>"
        for mode in ("ssl", "starttls"):
            with self.subTest(mode=mode):
                client, sock = self.connect(b"+OK ready\r\n+OK message\r\n" + body + b"\r\n..leading-dot\r\n.\r\n+OK 2 next\r\n", mode)
                response, lines, size = client.retr(1)
                self.assertEqual(lines, [body, b".leading-dot"])
                self.assertEqual(size, len(body) + len(b".leading-dot") + 4)
                self.assertEqual(client.list(2), b"+OK 2 next")
                self.assertEqual(sock.commands, [b"RETR 1\r\n", b"LIST 2\r\n"])

    def test_retr_total_budget_is_enforced_while_reading(self):
        client, sock = self.connect(b"+OK ready\r\n+OK message\r\n" + b"small\r\n" * 100 + b".\r\n")
        client.message_limit = 32
        start = sock.reader.tell()
        with self.assertRaisesRegex(Exception, "MAIL_EXTERNAL_MESSAGE_TOO_LARGE"):
            client.retr(1)
        self.assertLess(sock.reader.tell() - start, 80)

    def test_long_single_line_cannot_bypass_total_budget(self):
        client, sock = self.connect(b"+OK ready\r\n+OK message\r\n" + b"x" * 10000 + b"\r\n.\r\n")
        client.message_limit = 32
        with self.assertRaisesRegex(Exception, "MAIL_EXTERNAL_MESSAGE_TOO_LARGE"):
            client.retr(1)
        self.assertLess(sock.reader.tell(), 100)

    def test_control_reply_still_has_standard_limit(self):
        client, _ = self.connect(b"+OK ready\r\n+OK " + b"x" * 3000 + b"\r\n")
        with self.assertRaises(poplib.error_proto):
            client.list(1)


class ExternalWorkerRecoveryTests(unittest.TestCase):
    def test_invalid_reconnect_uidl_is_closed_before_publishing_connection(self):
        for listing in ([b"1 good", b"malformed"], [b"1 same", b"2 same"], [b"1 one", b"1 two"], [b"0 zero"]):
            with self.subTest(listing=listing):
                calls = []
                class Pop:
                    sock = None
                    def user(self, value): pass
                    def pass_(self, value): pass
                    def uidl(self): return b"+OK", listing, 1
                    def close(self): calls.append("close")
                account = dict(host="mail.example.com", port=995, tls_mode="ssl", username="owner", encrypted_password="cipher")
                with patch.object(worker.MailExternalEndpointValidator, "validate_target", return_value=("mail.example.com", ("8.8.8.8",))), patch.object(worker.MailExternalPop3Client, "_connect", return_value=Pop()), patch.object(worker.SecurityService, "decrypt_secret", return_value="synthetic-secret"):
                    with self.assertRaises(poplib.error_proto):
                        worker._open_collection_connection(account, worker.ExternalCollectionSafety())
                self.assertEqual(calls, ["close"])

    def run_worker(self, delete_enabled=False):
        calls, finalized, remote = [], [], []

        class Pop:
            sock = None

            def __init__(self, generation):
                self.generation = generation

            def user(self, value): pass
            def pass_(self, value): pass
            def uidl(self):
                # POP sequence numbers can change between sessions.
                return b"+OK", ([b"1 pending", b"2 broken", b"3 good"] if self.generation == 0 else [b"7 good", b"8 broken", b"9 pending"]), 1

            def list(self, number):
                calls.append((self.generation, "list", number))
                return b"+OK 1 100"

            def retr(self, number):
                calls.append((self.generation, "retr", number))
                if self.generation == 0:
                    raise poplib.error_proto("synthetic-private-response")
                return b"+OK", [b"From: sender@example.net", b"", b"body"], 40

            def dele(self, number): calls.append((self.generation, "dele", number))
            def quit(self): calls.append((self.generation, "quit")); return b"+OK"
            def close(self): calls.append((self.generation, "close"))

        account = dict(id="account", company_id="company", user_id="user", owner_name="Owner", owner_email="owner@example.com", role_id="role", role_name="User", user_type="member", status="active", permissions=[], host="mail.example.com", port=995, tls_mode="ssl", username="owner", encrypted_password="cipher", delete_from_server=delete_enabled)
        job = dict(id="job", account_id="account", company_id="company", user_id="user", attempt_count=1)
        db = type("Db", (), {"ensure_migrations_applied": lambda self: None})()
        with ExitStack() as stack:
            for name, value in {"_enqueue_scheduled": None, "_claim": job, "_context": account, "_heartbeat": True, "_store": (True, [])}.items():
                stack.enter_context(patch.object(worker, name, return_value=value))
            stack.enter_context(patch.object(worker, "_import_state", side_effect=lambda db, aid, uid: "pending" if uid == "pending" else None))
            stack.enter_context(patch.object(worker, "_set_remote_states", side_effect=lambda db, aid, states: remote.append(states)))
            stack.enter_context(patch.object(worker, "_finalize", side_effect=lambda db, job, status, counts, code=None: finalized.append((status, dict(counts), code))))
            stack.enter_context(patch.object(worker.MailExternalEndpointValidator, "validate_target", return_value=("mail.example.com", ("8.8.8.8",))))
            stack.enter_context(patch.object(worker.MailExternalPop3Client, "_connect", side_effect=[Pop(0), Pop(1)]))
            stack.enter_context(patch.object(worker.SecurityService, "decrypt_secret", return_value="synthetic-secret"))
            worker.run_once(db)
        return calls, finalized, remote

    def test_protocol_failure_reconnects_and_uses_fresh_uidl_numbers(self):
        calls, finalized, _ = self.run_worker()
        self.assertIn((0, "close"), calls)
        self.assertNotIn((0, "quit"), calls)
        self.assertNotIn((0, "retr", 3), calls)
        self.assertIn((1, "retr", 7), calls)
        self.assertEqual(finalized[0][1]["imported"], 1)
        self.assertEqual(finalized[0][1]["failed"], 1)

    def test_aborted_session_does_not_report_pending_deletions_as_committed(self):
        calls, finalized, remote = self.run_worker(delete_enabled=True)
        self.assertIn((0, "dele", 1), calls)
        self.assertNotIn((0, "quit"), calls)
        self.assertTrue(any(states.get("pending", (None,))[0] == "failed" for states in remote))
        self.assertEqual(finalized[0][1]["deleted"], 1)

    def test_diagnostic_logs_do_not_include_protocol_response_or_secret(self):
        with self.assertLogs(worker.logger, level="WARNING") as logs:
            self.run_worker()
        output = "\n".join(logs.output)
        self.assertNotIn("synthetic-private-response", output)
        self.assertNotIn("synthetic-secret", output)
        self.assertIn("MAIL_EXTERNAL_PROTOCOL_ERROR", output)
