# Server

운영자/관리자와 일반 사용자 클라이언트가 공통으로 호출하는 Core API 서버입니다.

## 역할

- 인증/권한
- 초기 설정 Wizard 백엔드
- Health Check
- 메일/결재/알림/번역 API
- Watcher 및 운영 이벤트

## 단계 1 범위

- `/api/v1/health`
- `/api/v1/setup/*`
- `/api/v1/auth/login`
- 설정 완료 전 운영 기능 차단
