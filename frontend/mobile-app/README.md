# Mobile App

일반 사용자용 모바일 앱입니다.

## 역할

- 승인/반려/조회
- 알림 확인
- 이동 중 업무 접근

## 구조 원칙

- 서버 API만 호출한다.
- 내부 인프라를 직접 접근하지 않는다.

## 7단계 빌드/실행 준비 기준

- 기준 API: `http://127.0.0.1:8510/api/v1`
- 앱 엔트리: `index.js`
- 앱 메타: `app.json`
- 화면 루트: `App.tsx`
- 서버 UI 계약 조회: `GET /api/v1/ui-contract`

## 현재 최소 실행 체인

```bash
npm install
npm run build
```

`npm run build`는 Android 번들 생성 전 선결 조건을 점검하고, 결과를 `build-evidence/mobile-app-build-*.json`에 남긴다.

## 현재 차단 조건

- `node_modules`가 없으면 React Native 번들링을 실행할 수 없다.
- `react-native` 실행 파일이 없으면 번들링을 실행할 수 없다.
- `android/` 네이티브 프로젝트가 없으면 설치 가능한 Android 산출물을 만들 수 없다.

## 다음 선결 작업

1. React Native 의존성 설치 또는 lockfile 확정
2. Android 네이티브 프로젝트 생성
3. Android SDK/Gradle/JDK 기준 버전 고정
4. `npm run build:android`를 실제 APK/AAB 생성 명령으로 승격
