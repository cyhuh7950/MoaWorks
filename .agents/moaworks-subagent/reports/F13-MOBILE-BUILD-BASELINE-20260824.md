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
