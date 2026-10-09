import { convexTest } from "convex-test";

import schema from "@convex/schema";

const modules = {
  "../convex/_generated/api.js": () => import("@convex/_generated/api"),
  "../convex/incidents.ts": () => import("@convex/incidents"),
  "../convex/products.ts": () => import("@convex/products"),
  "../convex/rateLimits.ts": () => import("@convex/rateLimits"),
  "../convex/seed.ts": () => import("@convex/seed"),
};

export function createBackend() {
  return convexTest(schema, modules);
}
