#!/usr/bin/python3
"""Postfix 전용 pipe. 실패 상세/메일/토큰을 로그에 출력하지 않는다."""
import os
import re
import sys
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(args, *, environ=None, stream=None, opener=None):
    environ = os.environ if environ is None else environ
    stream = sys.stdin.buffer if stream is None else stream
    opener = opener or build_opener(ProxyHandler({}), NoRedirect()).open
    if len(args) != 3 or not re.fullmatch('[A-Za-z0-9]{5,100}', args[0]):
        print('5.7.1 Invalid submission envelope')
        return 65
    if any(not value or any(ord(char) < 33 or ord(char) > 126 for char in value) for value in args):
        print('5.7.1 Invalid submission envelope')
        return 65
    token = environ.get('MAIL_INGEST_TOKEN', '')
    url = environ.get('MAIL_INGEST_URL', '')
    if not token or not url.endswith('/ingest') or not url.startswith(('http://', 'https://')):
        print('4.3.0 Submission service unavailable')
        return 75
    try:
        raw = stream.read(26214401)
        if not raw or len(raw) > 26214400:
            print('5.7.1 Invalid submission message size')
            return 65
        request = Request(url[:-len('/ingest')] + '/submission', data=raw, method='POST', headers={
            'Content-Type': 'message/rfc822', 'X-MoaWorks-Ingest-Token': token,
            'X-MoaWorks-Queue-Id': args[0], 'X-MoaWorks-Envelope-From': args[1],
            'X-MoaWorks-Envelope-To': args[2],
        })
        with opener(request, timeout=120) as response:
            if response.status == 202:
                return 0
    except HTTPError as exc:
        if exc.code in (400, 413, 415, 422):
            print('5.7.1 Submission validation rejected')
            return 65
    except Exception:
        pass
    print('4.3.0 Submission service temporarily unavailable')
    return 75


if __name__ == '__main__':
    sys.exit(run(sys.argv[1:]))
