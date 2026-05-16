import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/v1": {
        target: "https://api.lts4ai.com",
        changeOrigin: true
      },
      "/v1beta": {
        target: "https://api.lts4ai.com",
        changeOrigin: true
      }
    }
  }
});
