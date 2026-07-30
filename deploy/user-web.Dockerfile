FROM node:24.18.0-alpine3.23 AS build

WORKDIR /app

COPY frontend/user-web/package.json frontend/user-web/package-lock.json frontend/user-web/tsconfig.json frontend/user-web/vite.config.ts /app/
RUN npm ci

COPY frontend/user-web /app
RUN npm run build

FROM nginx:1.28.3-alpine3.23 AS runtime

COPY deploy/user-web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3520

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3520/ > /dev/null || exit 1
