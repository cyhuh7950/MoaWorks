import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";

const bash = existsSync("/bin/bash") ? "/bin/bash" : "C:\\Program Files\\Git\\bin\\bash.exe";
const script = "deploy/renew-mail-gateway-certificate.sh";
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "moaworks-cert-renew-"));
  temporaryDirectories.push(root);
  const fakeBin = join(root, "bin");
  const state = join(root, "state");
  mkdirSync(fakeBin);
  mkdirSync(state);
  const docker = join(fakeBin, "docker");
  writeFileSync(
    docker,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_STATE/commands.log"
case "$1:$2" in
  inspect:-f)
    container="$4"
    if [ "$container" = "$MAIL_RENEW_NPM_CONTAINER" ] && [ "\${FAKE_NPM_STOPPED:-0}" = 1 ]; then
      printf 'false\\n'
    elif [ "$container" = "$MAIL_RENEW_GATEWAY_CONTAINER" ] && [ "\${FAKE_GATEWAY_STOPPED:-0}" = 1 ]; then
      printf 'false\\n'
    else
      case "$3" in
        *RestartCount*) printf 'running 0\\n' ;;
        *) printf 'true\\n' ;;
      esac
    fi
    ;;
  exec:*)
    container="$2"
    shift 2
    if [ "$container" = "$MAIL_RENEW_NPM_CONTAINER" ]; then
      case "$1" in
        test) exit 0 ;;
        sha256sum)
          if [ -f "$FAKE_STATE/renewed" ] && [ "\${FAKE_CERT_CHANGED:-0}" = 1 ]; then
            printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  %s\\n' "$2"
          else
            printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  %s\\n' "$2"
          fi
          ;;
        certbot)
          [ "\${FAKE_CERTBOT_FAIL:-0}" = 0 ] || exit 42
          : > "$FAKE_STATE/renewed"
          ;;
        *) exit 91 ;;
      esac
    elif [ "$container" = "$MAIL_RENEW_GATEWAY_CONTAINER" ] && [ "$1" = postfix ] && [ "$2" = check ]; then
      [ "\${FAKE_POSTFIX_FAIL:-0}" = 0 ] || exit 43
    else
      exit 92
    fi
    ;;
  restart:*)
    [ "\${FAKE_RESTART_FAIL:-0}" = 0 ] || exit 44
    : > "$FAKE_STATE/restarted"
    ;;
  *) exit 93 ;;
esac
`,
    "utf8",
  );
  chmodSync(docker, 0o755);
  const hostLockDirectory = join(root, "renew.lock");
  const lockDirectory = hostLockDirectory
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    FAKE_STATE: state,
    MAIL_RENEW_CERT_NAME: "moaworks-mail-dev",
    MAIL_RENEW_NPM_CONTAINER: "npm",
    MAIL_RENEW_GATEWAY_CONTAINER: "moaworks-mail-gateway",
    MAIL_RENEW_CERT_PATH: "/etc/letsencrypt/live/moaworks-mail-dev/fullchain.pem",
    MAIL_RENEW_CERTBOT_CONFIG: "/etc/letsencrypt.ini",
    MAIL_RENEW_LOCK_DIR: lockDirectory,
    ...overrides,
  };
  return { env, hostLockDirectory, state };
}

function runRenewal(overrides = {}, args = []) {
  const fixture = createFixture(overrides);
  const result = spawnSync(bash, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: fixture.env,
  });
  return { ...fixture, result };
}

function commands(state) {
  return readFileSync(join(state, "commands.log"), "utf8");
}

test("인증서 해시가 같으면 gateway를 재시작하지 않는다", () => {
  const { result, state } = runRenewal();
  const log = commands(state);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /certificate unchanged/i);
  assert.match(
    log,
    /certbot renew --config \/etc\/letsencrypt\.ini --cert-name moaworks-mail-dev --non-interactive --no-random-sleep-on-renew/,
  );
  assert.doesNotMatch(log, /restart moaworks-mail-gateway/);
});

test("명시적 인증서 인수와 dry-run을 Certbot 호출에 반영한다", () => {
  const { result, state } = runRenewal({}, [
    "--cert-name",
    "alternate-cert",
    "--cert-path",
    "/custom/live/alternate-cert/fullchain.pem",
    "--certbot-config",
    "/custom/letsencrypt.ini",
    "--dry-run",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    commands(state),
    /certbot renew --config \/custom\/letsencrypt\.ini --cert-name alternate-cert --non-interactive --no-random-sleep-on-renew --dry-run/,
  );
});

test("인증서 해시가 바뀌면 gateway를 재시작하고 Postfix를 검증한다", () => {
  const { result, state } = runRenewal({ FAKE_CERT_CHANGED: "1" });
  const log = commands(state);

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /restart moaworks-mail-gateway/);
  assert.match(log, /exec moaworks-mail-gateway postfix check/);
  assert.match(log, /inspect -f .*RestartCount.* moaworks-mail-gateway/);
});

test("Certbot 갱신 실패는 비정상 종료하고 gateway를 건드리지 않는다", () => {
  const { result, state } = runRenewal({ FAKE_CERTBOT_FAIL: "1" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /certbot renewal failed/i);
  assert.doesNotMatch(commands(state), /restart moaworks-mail-gateway/);
});

test("gateway restart 실패를 성공으로 처리하지 않는다", () => {
  const { result } = runRenewal({ FAKE_CERT_CHANGED: "1", FAKE_RESTART_FAIL: "1" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gateway restart failed/i);
});

test("Postfix 검증 실패를 성공으로 처리하지 않는다", () => {
  const { result } = runRenewal({ FAKE_CERT_CHANGED: "1", FAKE_POSTFIX_FAIL: "1" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /postfix check failed/i);
});

test("이미 갱신 작업이 실행 중이면 Docker 명령 전에 종료한다", () => {
  const fixture = createFixture();
  mkdirSync(fixture.hostLockDirectory);
  const result = spawnSync(bash, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: fixture.env,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /renewal is already running/i);
  assert.equal(existsSync(join(fixture.state, "commands.log")), false);
});

test("제어 문자가 포함된 경로 인수는 Docker 실행 전에 거부한다", () => {
  const fixture = createFixture({ MAIL_RENEW_CERT_PATH: "/etc/letsencrypt/live/cert\nforged" });
  const result = spawnSync(bash, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: fixture.env,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /certificate path contains an invalid character/i);
  assert.equal(existsSync(join(fixture.state, "commands.log")), false);
});

test("Docker 옵션처럼 보이는 컨테이너 이름은 실행 전에 거부한다", () => {
  const fixture = createFixture({ MAIL_RENEW_NPM_CONTAINER: "--privileged" });
  const result = spawnSync(bash, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: fixture.env,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NPM container is invalid/i);
  assert.equal(existsSync(join(fixture.state, "commands.log")), false);
});

test("systemd timer는 WSL 실행 조건과 일 2회 수준의 영구 스케줄을 명시한다", () => {
  const service = readFileSync("deploy/systemd/moaworks-mail-certificate-renew.service", "utf8");
  const timer = readFileSync("deploy/systemd/moaworks-mail-certificate-renew.timer", "utf8");

  assert.match(service, /ConditionVirtualization=wsl/);
  assert.match(service, /EnvironmentFile=\/etc\/moaworks\/mail-certificate-renew.env/);
  assert.doesNotMatch(service, /\/home\/[A-Za-z0-9_-]+\/deploy/);
  assert.match(timer, /OnCalendar=\*-\*-\* 00,12:00:00/);
  assert.match(timer, /RandomizedDelaySec=/);
  assert.match(timer, /Persistent=true/);
});
