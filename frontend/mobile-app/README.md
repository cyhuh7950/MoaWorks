# MoaWorks Mobile

일반 사용자가 알림, 결재, 메일, 메신저를 사용하는 React Native Android 앱입니다.

## 내부 검증 APK 설치

1. 운영자가 모든 패키징 게이트를 통과해 전달한 `MoaWorks-Mobile-<version>-android-internal-release.apk` 또는 사내 배포 링크를 받습니다.
2. Android 기기에서 APK를 탭합니다.
3. Android가 요청하면 해당 파일 제공 앱에 대해서만 `알 수 없는 앱 설치`를 일시 허용합니다.
4. 설치 화면에서 제품명 `MoaWorks Mobile`과 설치를 확인합니다.
5. 앱을 열어 운영 계정으로 로그인합니다.

일반 사용자는 Python, Node, Gradle, adb 명령을 실행하지 않습니다. 이 APK는 저장소의 debug keystore로 서명된 내부 검증 전용이며 Play Store·외부 공개 배포용이 아닙니다.

앱을 제거하거나 새 내부 검증 버전으로 교체해도 서버의 운영 데이터는 제거되지 않습니다. 단, 기기에 저장된 앱 설정과 로그인 상태는 앱 제거 시 삭제될 수 있습니다.

## 개발자 재현 검증

```text
npm ci
npm test
npm run test:coverage
npm run bundle
npm run package:android
npm audit --omit=dev
```

- Windows와 WSL에서는 환경변수 또는 표준 설치 위치에서 JDK와 Android SDK를 탐지합니다.
- `npm run package:android`는 production JavaScript bundle과 `assembleRelease` APK를 만들고, audit 도달성·debuggable·임베디드 bundle·개발 서버 상수를 검사합니다. 모든 게이트를 통과해야 SHA-256 성공 manifest를 생성합니다.
- 연결된 Android 기기/에뮬레이터가 없으면 manifest에 `NO_CONNECTED_ANDROID_DEVICE` GAP을 기록합니다.
- 공개 배포에는 production signing과 승인된 배포 채널이 별도로 필요합니다.
