# Desktop Client

일반 사용자용 설치형 PC 에이전트/업무 클라이언트입니다.

## 역할

- 서버 API 호출 기반 업무 클라이언트
- 로컬 알림과 실행 편의 기능

## 구조 원칙

- 서버 API만 호출한다.
- DB, Storage, Mail Layer를 직접 접근하지 않는다.
