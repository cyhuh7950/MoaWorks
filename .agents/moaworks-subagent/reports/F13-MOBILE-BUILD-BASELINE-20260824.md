# F13 Mobile Build Baseline Recovery

## Result

App.tsx merge damage was repaired while retaining the F13 production auth-session adapter and workspace-files/reconnect paths. The Android wrapper is now a single `release` / `public` / `run` flow based on `mobile-build-support.js`, with no fixed username, duplicate environment declaration, or undefined helper.

## TDD evidence

- RED: `node --check scripts\\mobile-android-command.js` failed with `SyntaxError: Identifier 'commandEnv' has already been declared` at line 114.
- RED: `node --test test\\mobile-build-contract.test.js` failed 2/10: fixed `Users/cyhuh` path and the wrapper syntax error. The executable-wrapper contract was added before implementation.
- RED: after the dependency prerequisite was restored, Babel and Metro both reported `App.tsx: Unexpected token` at line 924, caused by the incomplete outer conditional closure.
- GREEN: `npm test` passed 59/59, including the production React Native Babel TSX parser contract; `node --check scripts\\mobile-android-command.js` and `node --check auth-session.js` passed.

## Verification

- `node -e "require('@babel/core').transformFileSync('App.tsx', { presets: ['module:@react-native/babel-preset'] });"` → `APP_TSX_PARSE=success`.
- `npm run bundle` invoked Metro and wrote the production bundle, but then failed in pre-existing out-of-scope `scripts/mobile-app-build-smoke.js` with `ReferenceError: nowIso is not defined`.
- `npm run build:android` was attempted; Gradle began plugin configuration, but no release APK was present afterwards, so Android release output is not verified.
- `git diff --check` passed. Targeted scan found no `__DEV__`, development auth/work fixtures, or fixed username in changed production files. Password, token, and LLM key values were not logged.

## Remaining

The smoke-script `nowIso` failure prevents the wrapper's successful production-bundle command from being proven end-to-end; it is outside this work order's allowed product files. Android release/device validation remains unverified because no release APK was produced by the attempted build.

## Rework 1 — smoke merge recovery

- RED: added the executable smoke contract, then `node --test test\\mobile-build-contract.test.js` failed 1/12 because `sha256File(bundlePath)` was absent and stale phase helpers remained.
- GREEN: removed the appended phase-script block, retaining the coherent single bundle/hash/log flow. The smoke contract passed 12/12.
- GREEN: `npm run bundle` exited 0 and produced `STATUS=success`, `BUNDLE=MoaWorks-Mobile-0.1.0-android-production.bundle`, and SHA-256 `a24d6fe1dff3919148a6d3856f3270ab771121ac4a2e1470a363ca23441cc39d` in its evidence log.
- Regression: complete `npm test` passed 60/60; smoke, Android wrapper, and auth-session syntax checks passed; `git diff --check` passed.
- Android release: `npm run build:android` reached Gradle `:app:createBundleReleaseJsAndAssets`; a release APK exists at `android/app/build/outputs/apk/release/app-release.apk` (59,169,514 bytes, timestamp 2026-08-24 02:20:35 UTC). The command executor did not return a final exit line, so the release build is recorded as APK-observed rather than a verified successful exit. Device launch was not run.
