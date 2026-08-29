import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..", "..", "..");
const read = (...segments) => readFileSync(path.join(repositoryRoot, ...segments), "utf8");
const readJson = (...segments) => JSON.parse(read(...segments));

const packageJson = readJson("frontend", "admin-web", "package.json");
const packageLock = readJson("frontend", "admin-web", "package-lock.json");
const dockerfile = read("deploy", "admin-web.Dockerfile");
const nginx = read("deploy", "admin-web.nginx.conf");
const compose = read("deploy", "docker-compose.yml");
const oracleCompose = read("deploy", "docker-compose.oracle.yml");
const apiSource = read("frontend", "admin-web", "src", "api.ts");

let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
};

check(packageJson.devDependencies.vite === "7.3.6", "Vite must be pinned to 7.3.6");
check(packageJson.devDependencies["@vitejs/plugin-react"] === "5.2.0", "plugin-react must be pinned to 5.2.0");
check(packageJson.devDependencies.postcss === "8.5.25", "PostCSS must be pinned to 8.5.25");
check(packageLock.packages["node_modules/vite"]?.version === "7.3.6", "lock must resolve Vite 7.3.6");
check(packageLock.packages["node_modules/@vitejs/plugin-react"]?.version === "5.2.0", "lock must resolve plugin-react 5.2.0");
check(packageLock.packages["node_modules/postcss"]?.version === "8.5.25", "lock must resolve PostCSS 8.5.25");

check(dockerfile.includes("FROM node:24.18.0-alpine3.23 AS build"), "builder image must be pinned");
check(dockerfile.includes("frontend/admin-web/package-lock.json"), "Docker build must copy the lockfile");
check(dockerfile.includes("RUN npm ci"), "Docker build must use npm ci");
check(dockerfile.includes("RUN npm run build"), "Docker build must compile admin-web");
check(dockerfile.includes("FROM nginx:1.28.3-alpine3.23 AS runtime"), "runtime image must be pinned Nginx");
check(dockerfile.includes("COPY deploy/admin-web.nginx.conf /etc/nginx/templates/default.conf.template"), "runtime must install the env-substituted admin Nginx template");
check(dockerfile.includes("COPY --from=build /app/dist /usr/share/nginx/html"), "runtime must contain only built assets");
check(dockerfile.includes("EXPOSE 3510"), "runtime must expose port 3510");
check(dockerfile.includes("HEALTHCHECK") && dockerfile.includes("http://127.0.0.1:3510/health"), "runtime healthcheck must use port 3510");
check(!dockerfile.includes('CMD ["npm", "run", "dev"]'), "runtime must not run the Vite development server");

check(nginx.includes("listen 3510;"), "Nginx must listen on 3510");
check(nginx.includes("location = /health"), "Nginx must provide a health endpoint");
check(nginx.includes("try_files $uri $uri/ /index.html;"), "Nginx must provide SPA fallback");
check(nginx.includes("location /api/") && nginx.includes("proxy_pass http://server:8000;"), "Nginx must proxy same-origin API requests");
check(nginx.includes("auth_request /_admin_access_check") && nginx.includes("internal;"), "Nginx must enforce the internal admin access policy");
check(nginx.includes("${ADMIN_ACCESS_CHECK_TOKEN}") && nginx.includes("${TRUSTED_PROXY_CIDR}"), "Nginx template must receive access token and trusted proxy CIDR at runtime");
check(nginx.includes('add_header Content-Security-Policy'), "Nginx must provide CSP");
check(!nginx.includes("upgrade-insecure-requests"), "HTTP staging host must not upgrade assets before HTTPS SNI is ready");
check(nginx.includes('add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'), "Nginx must provide HSTS");
check(nginx.includes('add_header Permissions-Policy "camera=(), geolocation=(), microphone=(), payment=(), usb=()" always;'), "Nginx must provide Permissions-Policy");

for (const [name, content] of [["docker-compose.yml", compose], ["docker-compose.oracle.yml", oracleCompose]]) {
  check(!content.includes("VITE_PROXY_TARGET"), `${name} must not inject the development proxy target`);
  check(!content.includes("VITE_API_BASE_URL"), `${name} must not inject a browser API environment value`);
}

check(apiSource.includes('const defaultApiBase = "/api/v1";'), "browser API default must remain same-origin");
check(!/https?:\/\/(?:server|localhost|127\.0\.0\.1)(?::\d+)?/i.test(apiSource), "browser API source must not expose an internal absolute URL");

console.log(`PASS admin-web production security contract (${assertions} assertions)`);
