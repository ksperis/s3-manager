import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || "localhost")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const apiUrl = env.VITE_API_URL || "/api";
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:8000";
  const shouldProxyApi = apiUrl.startsWith("/");

  return {
    plugins: [react()],
    build: {
      manifest: true,
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("@aws-sdk")) return "aws-sdk";
            if (id.includes("recharts")) return "charts";
            if (id.includes("jszip") || id.includes("@zip.js")) return "zip";
            if (id.includes("react-router-dom")) return "router";
            if (id.includes("react")) return "react-vendor";
            return "vendor";
          },
        },
      },
    },
    server: {
      host: env.VITE_DEV_HOST || true,
      port: Number(env.VITE_DEV_PORT) || 5173,
      allowedHosts,
      proxy: shouldProxyApi
        ? {
            [apiUrl]: {
              target: apiProxyTarget,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
  };
});
