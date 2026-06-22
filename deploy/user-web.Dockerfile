FROM node:20-alpine

WORKDIR /app

COPY frontend/user-web/package.json frontend/user-web/tsconfig.json frontend/user-web/vite.config.ts /app/
RUN npm install

COPY frontend/user-web /app

CMD ["npm", "run", "dev"]
