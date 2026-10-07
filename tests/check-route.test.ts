import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries", () => ({
  getCheckDataset: vi.fn(async () => ({
    incidents: [],
    status: { healthy: true, checkedAt: new Date().toISOString(), regions: ["UK"], sources: [] },
  })),
}));
vi.mock("@/lib/products/enrich", () => ({ enrichObservation: vi.fn(async (observation) => observation) }));
vi.mock("@/lib/security/anonymous", () => ({
  anonymousSubject: vi.fn(() => ({ id: "test-user" })),
  attachAnonymousCookie: vi.fn(),
  trustedNetworkSubject: vi.fn(() => null),
}));
vi.mock("@/lib/security/rate-limit", () => ({ takeRateLimit: vi.fn(async () => ({ allowed: true, limit: 120, remaining: 119, resetAt: new Date() })) }));

import { getCheckDataset } from "@/db/queries";
import { POST } from "@/app/api/check/route";
import { emptyObservation } from "@/lib/domain/schemas";
import { takeRateLimit } from "@/lib/security/rate-limit";

const healthyDataset = {
  incidents: [],
  status: { healthy: true, checkedAt: "2026-10-07T12:00:00.000Z", regions: ["UK" as const], sources: [] },
};

describe("POST /api/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCheckDataset).mockResolvedValue(healthyDataset);
  });

  it("returns NO_CLUE when no useful evidence is supplied", async () => {
    const request = new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: emptyObservation(), region: "UK" }) });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ verdict: "NO_CLUE", matchLevel: "none" });
    expect(getCheckDataset).toHaveBeenCalledWith("UK");
  });

  it("rejects malformed observations", async () => {
    const request = new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: { barcode: 12 }, region: "UK" }) });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });

  it("rejects bodies above the byte limit before JSON validation", async () => {
    const request = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: emptyObservation(), region: "UK", padding: "x".repeat(16 * 1024) }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(413);
    expect(getCheckDataset).not.toHaveBeenCalled();
  });

  it("returns JSON 503 when the rate-limit datastore is unavailable", async () => {
    vi.mocked(takeRateLimit).mockRejectedValueOnce(new Error("Convex unavailable"));
    const request = new Request("http://localhost/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: emptyObservation(), region: "UK" }),
    });
    const response = await POST(request as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(getCheckDataset).not.toHaveBeenCalled();
  });
});
