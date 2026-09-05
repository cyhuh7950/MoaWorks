import smtplib
import ssl


def probe_smtp_connection(provider, security, timeout=10):
    """TCP/EHLO/TLS/AUTH까지만 검사한다. MAIL/RCPT/DATA 및 quota 소비 없음."""
    mode = provider.get('tls_mode', 'none')
    if mode not in {'none', 'starttls', 'tls'}:
        raise ValueError('지원하지 않는 TLS 설정입니다.')
    is_oci = provider['provider_type'] in {'oci_email_delivery', 'oci_smtp'}
    if not is_oci and mode == 'tls':
        raise ValueError('자체 SMTP 릴레이는 implicit TLS를 지원하지 않습니다. none 또는 STARTTLS 설정이 필요합니다.')
    if is_oci and mode == 'none':
        raise ValueError('OCI 연결에는 TLS가 필요합니다.')
    username = str(provider.get('username') or '').strip()
    encrypted = provider.get('encrypted_password')
    password = security.decrypt_secret(encrypted) if encrypted else ''
    # 인증정보 완전성은 실제 transport와 같은 경계에서 확인한다. 실제 값은 반환하지 않는다.
    if is_oci and (not username or not password or not password.strip()):
        raise ValueError('OCI SMTP 자격증명이 완전하지 않습니다.')
    if not is_oci and bool(username) != bool(password):
        raise ValueError('자체 SMTP 릴레이 자격증명이 완전하지 않습니다.')
    host, port = provider['relay_host'], int(provider['relay_port'])
    if is_oci and (port, mode) not in {(465, 'tls'), (587, 'starttls')}:
        raise ValueError('OCI SMTP 연결 검증은 465/TLS 또는 587/STARTTLS 설정이 필요합니다.')
    kwargs = {'timeout': timeout}
    factory = smtplib.SMTP
    if mode == 'tls':
        factory = smtplib.SMTP_SSL
        kwargs['context'] = ssl.create_default_context()
    with factory(host, port, **kwargs) as client:
        if client.ehlo()[0] != 250:
            raise ValueError('SMTP EHLO 검증 실패')
        if mode == 'starttls':
            client.starttls(context=ssl.create_default_context())
            if client.ehlo()[0] != 250:
                raise ValueError('TLS 이후 EHLO 검증 실패')
        if username:
            client.login(username, password)
    tls_result = 'TLS 검증 완료' if mode != 'none' else 'TLS 미사용'
    auth_result = 'AUTH 검증 완료' if username else 'AUTH 미사용'
    return f'TCP/EHLO 검증 완료 · {tls_result} · {auth_result}. 메일 DATA 및 수신함 도착은 검증하지 않았습니다.'
