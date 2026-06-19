# Frontend

클라이언트 프로그램 영역입니다.

## 하위 구조

- `admin-web`: 운영자/관리자용 웹
- `user-web`: 일반 사용자용 웹
- `desktop-client`: 일반 사용자용 설치형 프로그램
- `mobile-app`: 일반 사용자용 앱

## 공통 원칙

- 모든 클라이언트는 서버 API만 호출한다.
- 관리자 기능은 `admin-web`에만 둔다.
