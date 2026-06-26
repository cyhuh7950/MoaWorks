import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3510,
    allowedHosts: ["admin.moaworks.sinsan.kr", "user.moaworks.sinsan.kr"],
  },
});
