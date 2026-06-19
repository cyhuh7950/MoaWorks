FROM node:20-alpine

WORKDIR /app

COPY frontend/admin-web/package.json frontend/admin-web/tsconfig.json frontend/admin-web/tsconfig.app.json frontend/admin-web/vite.config.ts /app/
RUN npm install

COPY frontend/admin-web /app

CMD ["npm", "run", "dev"]
