import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const privacyPath = {
    name: "privacy-path",
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: unknown, next: () => void) => void) => void } }) {
      server.middlewares.use((request, _response, next) => {
        if (request.url && ["/privacy", "/privacy/"].includes(request.url.split("?", 1)[0])) {
          const queryStart = request.url.indexOf("?");
          request.url = `/privacy/index.html${queryStart === -1 ? "" : request.url.slice(queryStart)}`;
        }
        next();
      });
    },
  };
  return {
    plugins: [react(), privacyPath],
    server: {
      proxy: {
        "/api": {
          target: env.VITE_PROXY_TARGET || "http://127.0.0.1:8510",
          changeOrigin: true,
        },
      },
      host: "0.0.0.0",
    port: 3520,
    allowedHosts: ["user.moaworks.sinsan.kr", "admin.moaworks.sinsan.kr"],
    },
  };
});
