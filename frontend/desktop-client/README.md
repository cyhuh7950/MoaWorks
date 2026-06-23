# Desktop Client

일반 사용자용 설치형 PC 에이전트/업무 클라이언트입니다.

## 역할

- 서버 API 호출 기반 업무 클라이언트
- 로컬 알림과 실행 편의 기능

## 구조 원칙

- 서버 API만 호출한다.
- DB, Storage, Mail Layer를 직접 접근하지 않는다.

## 7단계 실행형 검증 기준

- 기준 API: `http://127.0.0.1:8510/api/v1`
- WSL 검증 위치: `~/deploy/moaworks/frontend/desktop-client`
- 실행 확인: WSL에서 임시 HTTP 서버 또는 Electron 실행으로 `index.html`을 실제 렌더링한다.
- 패키징 증적: `npm run build`가 `build-evidence/desktop-client-package-*.tar.gz`와 JSON manifest를 만든다.
- 필수 확인 항목:
  - 서버 UI 계약의 Help 문구 반영
  - 서버 UI 계약의 상태 메시지 반영
  - 서버 UI 계약의 대표 색상 반영

## 실행 명령

```bash
npm run build
python3 -m http.server 3530 --bind 0.0.0.0
```

Electron 실행은 `npm install` 후 아래 명령으로 확인한다.

```bash
npm run dev
```
