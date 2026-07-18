import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // 開発時はローカルデーモンの API を使う
    proxy: {
      "/api": "http://127.0.0.1:7350",
    },
  },
});
