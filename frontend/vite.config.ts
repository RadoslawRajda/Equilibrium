import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/bundler": {
        target: process.env.VITE_BUNDLER_PROXY_TARGET || "http://paymaster:4337",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bundler/, "")
      }
    }
  }
});
