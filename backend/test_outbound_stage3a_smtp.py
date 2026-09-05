import smtplib
from email.message import EmailMessage

import pytest

from app.services.mail_transports import OciEmailDeliveryTransport, SelfHostedSmtpTransport, RelaySmtpConfig, MailTransportFailure


class PhaseSmtp:
    def __init__(self, phase):
        self.phase = phase
        self.payloads = []
        self.closed = False

    def __enter__(self): return self
    def __exit__(self, *args): self.quit()
    def ehlo(self, *args):
        if self.phase == 'connect': raise TimeoutError('private@example.test token=hidden')
        return 250, b'ok'
    def has_extn(self, name): return True
    def starttls(self, **kwargs): return 220, b'ok'
    def login(self, *args): return 235, b'ok'
    def mail(self, *args, **kwargs): return (550 if self.phase == 'mail5' else 250), b'private'
    def rcpt(self, *args, **kwargs): return (450 if self.phase == 'rcpt4' else 250), b'private'
    def docmd(self, command):
        assert command == 'DATA'
        return (554 if self.phase == 'data5' else 354), b'private'
    def send(self, data):
        self.payloads.append(data)
        if self.phase == 'write': raise TimeoutError('private')
    def getreply(self):
        if self.phase == 'reply': raise smtplib.SMTPServerDisconnected('private')
        return (451 if self.phase == 'reply4' else 550 if self.phase == 'reply5' else 250), b'private'
    def quit(self):
        if self.phase == 'quit': raise OSError('private')
    def close(self): self.closed = True
    # 기존 블랙박스 경로도 동등한 합성 실패를 발생시켜 유효 RED를 만든다.
    def sendmail(self, sender, recipients, data):
        for code, message in (self.mail(sender), self.rcpt(recipients[0]), self.docmd('DATA')):
            if code >= 400: raise smtplib.SMTPDataError(code, message)
        self.send(data)
        code, message = self.getreply()
        if code >= 400: raise smtplib.SMTPDataError(code, message)
        return {}
    def send_message(self, message, *, from_addr=None, to_addrs=None):
        return self.sendmail(from_addr or message['From'], to_addrs or [message['To']], message.as_bytes())


@pytest.mark.parametrize('raw', [False, True])
@pytest.mark.parametrize('kind', ['oci', 'self'])
@pytest.mark.parametrize('phase,want', [('connect','retry'), ('mail5','failed'), ('rcpt4','retry'),
    ('data5','failed'), ('write','unknown'), ('reply','unknown'), ('reply4','retry'),
    ('reply5','failed'), ('quit','sent'), ('ok','sent')])
def test_smtp_phase_classification_without_duplicate_mx(kind, raw, phase, want):
    clients = []
    def factory(**kwargs):
        client = PhaseSmtp(phase)
        clients.append(client)
        return client
    message = EmailMessage()
    message['From'] = 'sender@example.test'
    message['To'] = 'recipient@example.test'
    message.set_content('.hello')
    payload = b'From: sender@example.test\r\n\r\n.hello\r\n' if raw else message
    try:
        if kind == 'oci':
            OciEmailDeliveryTransport(smtp_factory=factory).send_prepared(payload,
                envelope_from='sender@example.test', recipient_email='recipient@example.test',
                config=RelaySmtpConfig('smtp.invalid',587,'synthetic','synthetic'))
        else:
            SelfHostedSmtpTransport(mx_resolver=lambda _: ['first.invalid','second.invalid'], smtp_factory=factory).send_prepared(
                payload, envelope_from='sender@example.test', recipient_email='recipient@example.test',
                helo_name='sender.invalid', timeout_sec=3)
        actual = 'sent'
    except MailTransportFailure as exc:
        actual = 'unknown' if getattr(exc, 'result_unknown', False) else 'retry' if exc.transient else 'failed'
        assert 'private' not in str(exc)
    assert actual == want
    if want in ('sent', 'unknown', 'failed'):
        assert len(clients) == 1
    if raw and want == 'sent':
        assert clients[0].payloads == [b'From: sender@example.test\r\n\r\n..hello\r\n.\r\n']


@pytest.mark.parametrize('kind', ['oci','self'])
def test_owner_loss_after_354_prevents_payload_and_next_mx(kind):
    clients=[]
    def factory(**kwargs):
        client=PhaseSmtp('ok'); clients.append(client); return client
    calls=[]
    def guard():
        calls.append(1)
        if len(calls)==2:
            raise MailTransportFailure('lease lost',transient=False,result_unknown=True)
    options=dict(envelope_from='a@example.test',recipient_email='b@example.test',before_data=guard)
    with pytest.raises(MailTransportFailure):
        if kind=='oci':
            OciEmailDeliveryTransport(smtp_factory=factory).send_prepared(b'\r\nbody',config=RelaySmtpConfig('invalid',587,'s','s'),**options)
        else:
            SelfHostedSmtpTransport(mx_resolver=lambda _: ['one','two'],smtp_factory=factory).send_prepared(b'\r\nbody',helo_name='invalid',timeout_sec=3,**options)
    assert len(clients)==1 and clients[0].payloads==[]


def test_legacy_relay_uses_same_data_unknown_boundary(monkeypatch):
    from app.services.mail_delivery_service import SmtpRelayAdapter
    client=PhaseSmtp('reply')
    monkeypatch.setattr(smtplib,'SMTP',lambda *args,**kwargs: client)
    with pytest.raises(MailTransportFailure) as error:
        SmtpRelayAdapter().send(dict(sender_email='a@example.test',recipient_email='b@example.test',
            subject='test',body_text='body'),dict(relay_host='invalid',relay_port=25,tls_mode='none'))
    assert error.value.result_unknown and not error.value.transient


def test_legacy_routing_does_not_repeat_preparation_after_quota(monkeypatch):
    from app.services.mail_delivery_service import SmtpRelayAdapter
    from app.services.mail_transports import MailProviderRoutingAdapter
    smtp=PhaseSmtp('ok'); monkeypatch.setattr(smtplib,'SMTP',lambda *args,**kwargs:smtp)
    legacy=SmtpRelayAdapter()
    adapter=MailProviderRoutingAdapter(self_hosted_transport=None,oci_transport=None,legacy_relay_adapter=legacy)
    provider=dict(provider_type='smtp',relay_host='invalid',relay_port=25,tls_mode='none')
    prepared=adapter.prepare(dict(sender_email='a@example.test',recipient_email='b@example.test',subject='t',body_text='b'),provider)
    def reserved():
        monkeypatch.setattr(legacy,'build_message',lambda *args: pytest.fail('quota 후 MIME 재준비'))
    assert adapter.send_prepared(prepared,provider,before_network_attempt=reserved)=='relay accepted'


def test_oci_465_explicitly_verifies_certificate_and_hostname():
    import ssl
    contexts=[]
    def factory(**kwargs):
        context=kwargs.get('context')
        assert context is not None, 'SMTP_SSL의 insecure default context 사용 금지'
        assert context.verify_mode==ssl.CERT_REQUIRED and context.check_hostname is True
        contexts.append(context)
        return PhaseSmtp('ok')
    receipt=OciEmailDeliveryTransport(smtp_ssl_factory=factory).send_prepared(b'\r\nbody',
        envelope_from='a@example.test',recipient_email='b@example.test',config=RelaySmtpConfig('invalid',465,'s','s'))
    assert len(contexts)==1 and receipt.remote_smtp_accepted


def test_oci_465_verification_failure_never_falls_back_to_plain_smtp():
    import ssl
    def reject(**kwargs): raise ssl.SSLCertVerificationError('synthetic untrusted CA')
    def forbidden(**kwargs): pytest.fail('465 검증 실패 후 다른 transport 호출 금지')
    with pytest.raises(MailTransportFailure):
        OciEmailDeliveryTransport(smtp_ssl_factory=reject,smtp_factory=forbidden).send_prepared(b'\r\nbody',
            envelope_from='a@example.test',recipient_email='b@example.test',config=RelaySmtpConfig('invalid',465,'s','s'))
