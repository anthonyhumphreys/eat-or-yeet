import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/incidents/route";

const action = vi.hoisted(() => vi.fn());
vi.mock("@backend/client", () => ({ fetchAction: action }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
});
afterEach(() => vi.unstubAllEnvs());

it("rejects an unauthorised refresh before queueing jobs", async () => {
  const response = await GET(new NextRequest("http://localhost/api/cron/incidents"));
  expect(response.status).toBe(401);
  expect(action).not.toHaveBeenCalled();
});

it("reports accepted jobs without claiming the import completed", async () => {
  action.mockResolvedValue({ queued: ["fsa", "fda"] });
  const response = await GET(new NextRequest("http://localhost/api/cron/incidents", { headers: { authorization: "Bearer test-cron-secret" } }));
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: "queued", sources: ["fsa", "fda"] });
});

it("returns JSON when the queue backend is unavailable", async () => {
  action.mockRejectedValue(new Error("offline"));
  const response = await GET(new NextRequest("http://localhost/api/cron/incidents", { headers: { authorization: "Bearer test-cron-secret" } }));
  expect(response.status).toBe(503);
  expect(await response.json()).toHaveProperty("error");
});
