import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => { const env = loadEnv(mode, process.cwd(), ""); return {
  plugins: [react()],
  server: {
    proxy: { "/api": { target: env.VITE_PROXY_TARGET || "http://127.0.0.1:8510", changeOrigin: true } },
    host: "0.0.0.0",
    port: 3510,
    allowedHosts: ["admin.moaworks.sinsan.kr", "user.moaworks.sinsan.kr"],
  },
}; });
