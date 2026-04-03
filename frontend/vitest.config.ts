import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const reactRouterDomTestShim = fileURLToPath(new URL("./src/test/react-router-dom.tsx", import.meta.url));
const reactRouterDomReal = fileURLToPath(new URL("./node_modules/react-router-dom/dist/index.js", import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    include: ["src/**/*.test.{ts,tsx}"],
    alias: {
      "react-router-dom": reactRouterDomTestShim,
      "react-router-dom-real": reactRouterDomReal,
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
