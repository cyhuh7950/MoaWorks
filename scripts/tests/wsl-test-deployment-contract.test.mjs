import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("WSL 테스트 배포는 기존 local-postgres 및 고정 서비스 이름을 사용한다", () => {
  const compose = read("deploy/docker-compose.wsl.yml");

  assert.doesNotMatch(compose, /container_name:\s*moaworks-postgres/);
  assert.match(compose, /name:\s*postgres_env_default/);
  assert.match(compose, /POSTGRES_HOST:\s*postgres/);
  assert.match(compose, /POSTGRES_DB:\s*\$\{POSTGRES_DB\}/);
  assert.match(compose, /container_name:\s*moaworks-server/);
  assert.match(compose, /container_name:\s*moaworks-admin-web/);
  assert.match(compose, /container_name:\s*moaworks-user-web/);
  assert.match(compose, /container_name:\s*moaworks-mail-gateway/);
  assert.equal(
    (compose.match(/image:\s*moaworks-server-runtime:local/g) ?? []).length,
    5,
    "API와 메일 작업자는 하나의 서버 런타임 이미지를 공유해야 한다",
  );
  assert.equal(
    (compose.match(/dockerfile:\s*deploy\/server\.Dockerfile/g) ?? []).length,
    1,
    "서버 런타임 이미지는 한 번만 빌드해야 한다",
  );
  assert.match(compose, /"25:25"/);
  assert.doesNotMatch(compose, /5432:5432/);
});

test("WSL 환경 초기화는 비밀값을 출력하지 않고 기존 환경 파일을 덮어쓰지 않는다", () => {
  const init = read("deploy/init-wsl-env.sh");

  assert.match(init, /umask 077/);
  assert.match(init, /openssl rand -hex 32/);
  assert.match(init, /if \[ -e "\.env" \]/);
  assert.match(init, /APP_ENV=wsl-test/);
  assert.match(init, /db_name="\$\{POSTGRES_DB:-moaworks\}"/);
  assert.match(init, /db_user="\$\{POSTGRES_USER:-moaworks\}"/);
  assert.match(init, /MAIL_HOSTNAME=mail\.dev\.moaworks\.sinsan\.kr/);
  assert.doesNotMatch(init, /set -x/);
});

test("Windows 포트 전달 스크립트는 현재 WSL IP를 조회하고 80, 443, 25만 갱신한다", () => {
  const portproxy = read("deploy/update-wsl-portproxy.ps1");

  assert.match(portproxy, /wsl\.exe -d/);
  assert.match(portproxy, /25, 80, 443/);
  assert.match(portproxy, /netsh interface portproxy delete v4tov4/);
  assert.match(portproxy, /netsh interface portproxy add v4tov4/);
  assert.doesNotMatch(portproxy, /interface portproxy reset/);
});

test("WSL 운영 안내서는 DNS, NPM, SMTP 및 분리 검증 절차를 포함한다", () => {
  const runbook = read("docs/runbooks/moaworks-wsl-test-environment.md");

  for (const required of [
    "user.dev.moaworks.sinsan.kr",
    "admin.dev.moaworks.sinsan.kr",
    "api.dev.moaworks.sinsan.kr",
    "mail.dev.moaworks.sinsan.kr",
    "dev.moaworks.sinsan.kr MX",
    "proxy-network",
    "outbound TCP 25",
    "외부 수신",
  ]) {
    assert.ok(runbook.includes(required), `runbook must include: ${required}`);
  }
});
