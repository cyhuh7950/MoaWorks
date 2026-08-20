import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const readRepositoryFile = (path) => readFileSync(`${repositoryRoot}${path}`, "utf8");

const dockerfile = readRepositoryFile("deploy/user-web.Dockerfile");
const serverDockerfile = readRepositoryFile("deploy/server.Dockerfile");
const nginxConfig = readRepositoryFile("deploy/user-web.nginx.conf");
const oracleCompose = readRepositoryFile("deploy/docker-compose.oracle.yml");
const localCompose = readRepositoryFile("deploy/docker-compose.yml");

assert.match(dockerfile, /FROM node:[^\r\n]+ AS build/i, "Node는 빌드 단계에서만 사용해야 합니다.");
assert.match(dockerfile, /RUN npm ci(?:\s|$)/, "lock 파일을 사용하는 npm ci 빌드여야 합니다.");
assert.match(dockerfile, /RUN npm run build/, "운영 이미지는 정적 산출물을 빌드해야 합니다.");
assert.match(dockerfile, /FROM nginx:[^\r\n]+ AS runtime/i, "운영 단계는 nginx 정적 서버여야 합니다.");
assert.match(dockerfile, /COPY --from=build \/app\/dist \/usr\/share\/nginx\/html/, "빌드 산출물만 운영 이미지에 포함해야 합니다.");
assert.doesNotMatch(dockerfile, /npm run dev|CMD\s*\[\s*"npm"/i, "운영 이미지에서 Vite 개발 서버를 실행하면 안 됩니다.");

assert.match(nginxConfig, /listen\s+3520\s*;/, "기존 user-web 내부 포트 3520을 유지해야 합니다.");
assert.match(nginxConfig, /location\s+\/api\//, "브라우저 API는 same-origin /api 경로를 사용해야 합니다.");
assert.match(nginxConfig, /proxy_pass\s+http:\/\/server:8000\s*;/, "API 요청은 Docker 내부 server:8000으로만 프록시해야 합니다.");
assert.match(nginxConfig, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html\s*;/, "SPA 새로고침을 위한 index.html fallback이 필요합니다.");
assert.match(nginxConfig, /client_max_body_size\s+64m\s*;/, "기존 50 MB 파일 업로드와 multipart 오버헤드를 수용해야 합니다.");
assert.doesNotMatch(nginxConfig, /add_header\s+Access-Control-Allow-Origin\s+["']?\*/i, "운영 프록시에 광범위한 CORS 허용을 추가하면 안 됩니다.");
assert.match(nginxConfig, /add_header\s+Content-Security-Policy\s+"[^"]*default-src 'self'[^"]*"\s+always\s*;/i, "운영 HTML에는 CSP가 필요합니다.");
assert.match(nginxConfig, /add_header\s+Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"\s+always\s*;/i, "운영 HTTPS에는 HSTS가 필요합니다.");
assert.match(nginxConfig, /add_header\s+Permissions-Policy\s+"[^"]+"\s+always\s*;/i, "사용하지 않는 브라우저 기능을 제한해야 합니다.");
assert.doesNotMatch(nginxConfig, /script-src[^;"']*'unsafe-(?:inline|eval)'/i, "CSP script-src에서 unsafe-inline/unsafe-eval을 허용하면 안 됩니다.");
assert.equal((nginxConfig.match(/add_header\s+Content-Security-Policy/g) ?? []).length, 3, "location의 add_header가 상위 보안 헤더를 가리지 않도록 HTML과 asset에도 CSP를 명시해야 합니다.");
assert.equal((nginxConfig.match(/add_header\s+Strict-Transport-Security/g) ?? []).length, 3, "HTML과 asset 응답에도 HSTS가 유지되어야 합니다.");
const cspValues = [...nginxConfig.matchAll(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always\s*;/gi)].map((match) => match[1]);
for (const csp of cspValues) {
  const imageSources = csp.match(/(?:^|;)\s*img-src\s+([^;]+)/i)?.[1].trim().split(/\s+/) ?? [];
  assert.ok(imageSources.includes("https:"), "사용자가 외부 이미지 표시를 허용하면 HTTPS 메일 이미지를 로드할 수 있어야 합니다.");
  assert.ok(!imageSources.includes("*"), "메일 이미지 허용 범위를 모든 프로토콜과 출처로 확대하면 안 됩니다.");
  assert.ok(!imageSources.includes("http:"), "평문 HTTP 메일 이미지를 직접 허용하면 안 됩니다.");
}

assert.match(serverDockerfile, /CMD\s*\[\s*"uvicorn"[\s\S]*"app\.main:app"/i, "운영 server는 Uvicorn으로 API를 실행해야 합니다.");
assert.match(serverDockerfile, /CMD\s*\[[^\]]*"--no-access-log"[^\]]*\]/i, "운영 server는 원문 URL query를 남기는 Uvicorn access log를 비활성화해야 합니다.");

for (const [name, compose] of [["oracle", oracleCompose], ["local", localCompose]]) {
  const userWebService = compose.match(/^  user-web:\r?\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\r?$)/m)?.[0];
  assert.ok(userWebService, `${name} compose에 user-web 서비스가 있어야 합니다.`);
  assert.doesNotMatch(userWebService, /VITE_PROXY_TARGET/, `${name} user-web에서 개발 서버 프록시 환경변수를 제거해야 합니다.`);
  assert.doesNotMatch(userWebService, /VITE_API_BASE_URL/, `${name} user-web에서 브라우저 API 절대 설정 의존성을 제거해야 합니다.`);
}

console.log("PASS user-web and server production runtime security contract (34 assertions)");
