"""기존 MIME/envelope 검증을 단계별 SMTP 경계에서 유지하는 합성 도구."""
from email.parser import BytesParser
from email.policy import default
import re


def configure_smtp_mock(client):
    client.mail.return_value=(250,b'ok')
    client.rcpt.return_value=(250,b'ok')
    client.docmd.return_value=(354,b'continue')
    client.getreply.return_value=(250,b'accepted')
    return client


def captured_message(client):
    payload=client.send.call_args.args[0]
    assert payload.endswith(b'\r\n.\r\n')
    return BytesParser(policy=default).parsebytes(re.sub(br'(?m)^\.\.',b'.',payload[:-3]))
