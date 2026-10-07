import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "@convex": path.join(root, "convex"),
      "server-only": path.join(root, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "json", "html"] },
  },
});
