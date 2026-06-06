import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone vitest config (does NOT extend vite.config.ts, which roots at client/
// for the React build). Server-side unit tests live alongside source in server/.
export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["server/**/*.{test,spec}.{ts,tsx}", "shared/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "client"],
    globals: false,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
});
