from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "docs" / "manuals" / "assets"

CAPTIONS = {
    "user/home.png": ("사용자 업무 홈", "로그인 후 메일·결재·일정·대화·공지 요약 확인"),
    "user/search.png": ("통합 검색", "메일·결재·메신저 등 업무 자료 검색"),
    "user/notifications.png": ("전체 알림", "알림 조회·읽음 처리·원본 업무 이동"),
    "user/mail-shell.png": ("메일함 기본 화면", "메일함·목록·본문 3단 구성"),
    "user/mail-compose-normal.png": ("메일 작성 기본 크기", "중앙 작성창에서 받는 사람·본문·첨부·발송 설정"),
    "user/mail-compose-maximized.png": ("메일 작성 확대", "확대 버튼으로 작성 영역을 화면 전체 크기로 전환"),
    "user/approval-compose.png": ("새 결재 작성", "제목·본문·첨부·결재선 작성"),
    "user/approval-list-detail.png": ("결재 목록과 상세", "문서 상태와 결재 흐름 확인"),
    "user/approval-actions.png": ("결재 처리", "상신·승인·반려·재기안 업무 처리"),
    "user/messenger-room-create.png": ("대화방 만들기", "참여자를 선택해 새 업무 대화 시작"),
    "user/messenger-timeline.png": ("메신저 대화", "실시간 메시지와 대화 이력 확인"),
    "user/messenger-participants.png": ("대화 참여자", "대화방 구성원과 방장 상태 확인"),
    "user/calendar-month.png": ("월간 일정", "개인·공유 일정을 월 단위로 확인"),
    "user/schedule-compose.png": ("일정 작성", "일정 시간·참여자·공유 범위 입력"),
    "user/address-personal-list.png": ("개인 주소록", "개인 연락처 검색과 관리"),
    "user/address-contact-form.png": ("연락처 등록", "이름·이메일·전화번호 등 연락처 입력"),
    "user/organization-tree.png": ("조직도", "부서 계층과 구성원 탐색"),
    "user/files-mine-folder.png": ("내 파일", "개인 폴더와 파일 목록 관리"),
    "user/files-upload-detail.png": ("파일 업로드 상세", "업로드 파일·진행 상태·메타데이터 확인"),
    "user/files-version-history.png": ("파일 버전 기록", "이전 버전 조회와 복원"),
    "user/personal-profile.png": ("개인 프로필 설정", "이름·연락처·표시 정보 변경"),
    "user/personal-notifications.png": ("개인 알림 설정", "업무별 알림 수신 조건 저장"),
    "user/help-search.png": ("Help 검색", "업무별 도움말과 정책 안내 검색"),
    "mobile/android-login.png": ("Android 로그인", "모바일 앱의 서버·계정 로그인"),
    "mobile/android-home.png": ("Android 업무 홈", "모바일용 주요 업무 요약"),
    "mobile/android-mail.png": ("Android 메일", "모바일 메일 목록과 실제 데이터 확인"),
    "mobile/android-approval.png": ("Android 결재", "모바일 결재 상태와 문서 확인"),
    "mobile/android-messenger.png": ("Android 메신저", "모바일 대화와 메시지 확인"),
    "mobile/android-notifications.png": ("Android 알림", "모바일 알림 목록 확인"),
    "admin/admin-help.png": ("관리자 Help", "관리자 업무 도움말과 운영 안내"),
    "admin/admin-root.png": ("관리자 운영 화면", "사용자·조직·상태·감사 정보를 관리하는 기본 화면"),
    "install/cloudflare-dns-records.png": ("Cloudflare DNS 레코드", "A·MX·TXT·CNAME 레코드와 DNS 전용 상태 확인"),
    "install/cloudflare-nameservers.png": ("Cloudflare 이름 서버", "등록 기관에 입력할 권한 이름 서버 확인"),
    "install/halfdomain-nameserver-complete.png": ("등록 기관 이름 서버 변경", "기존 이름 서버를 Cloudflare 이름 서버로 교체한 완료 화면"),
    "install/npm-proxy-hosts.png": ("Reverse proxy 호스트", "user·admin·api 공개 호스트와 내부 대상을 연결"),
    "install/router-port-forwarding.png": ("공유기 포트 전달", "외부 80·443·SMTP 포트를 내부 서버로 전달"),
    "install/oci-dynamic-group.png": ("OCI 동적 그룹", "MoaWorks 인스턴스를 Instance Principal 그룹에 포함"),
    "install/oci-policy.png": ("OCI IAM 정책", "동적 그룹에 Email Delivery 조회 권한 부여"),
}


def main() -> None:
    entries: list[dict[str, object]] = []
    for relative, (caption, purpose) in sorted(CAPTIONS.items()):
        path = ASSETS / relative
        if not path.is_file():
            raise SystemExit(f"missing asset: {relative}")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with Image.open(path) as image:
            width, height = image.size
        audience = relative.split("/", 1)[0]
        entries.append(
            {
                "id": Path(relative).stem.replace("-", "_"),
                "audience": audience,
                "source": "verified project evidence or user-confirmed setup capture",
                "file": relative,
                "sha256": digest,
                "width": width,
                "height": height,
                "caption": caption,
                "verifiedPurpose": purpose,
            }
        )

    unmanaged = sorted(
        str(path.relative_to(ASSETS)).replace("\\", "/")
        for path in ASSETS.rglob("*")
        if path.is_file() and path.name != "asset-manifest.json"
        and str(path.relative_to(ASSETS)).replace("\\", "/") not in CAPTIONS
    )
    if unmanaged:
        raise SystemExit(f"unmanaged assets: {unmanaged}")

    output = {
        "schemaVersion": 1,
        "generatedFor": "MoaWorks role-based manuals v2.0",
        "assetCount": len(entries),
        "assets": entries,
    }
    (ASSETS / "asset-manifest.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"PASS: {len(entries)} assets")


if __name__ == "__main__":
    main()
