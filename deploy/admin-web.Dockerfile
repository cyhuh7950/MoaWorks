FROM node:24.18.0-alpine3.23 AS build

WORKDIR /app

COPY frontend/admin-web/package.json frontend/admin-web/package-lock.json frontend/admin-web/tsconfig.json frontend/admin-web/tsconfig.app.json frontend/admin-web/vite.config.ts /app/
RUN npm ci

COPY frontend/admin-web /app
RUN npm run build

FROM nginx:1.28.3-alpine3.23 AS runtime

COPY deploy/admin-web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3510

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3510/health > /dev/null || exit 1
