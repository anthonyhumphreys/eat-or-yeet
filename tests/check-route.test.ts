import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries", () => ({ getActiveIncidents: vi.fn(async () => []) }));
vi.mock("@/lib/products/enrich", () => ({ enrichObservation: vi.fn(async (observation) => observation) }));
vi.mock("@/lib/security/anonymous", () => ({ anonymousSubject: vi.fn(() => ({ id: "test-user" })), attachAnonymousCookie: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ takeRateLimit: vi.fn(async () => ({ allowed: true, limit: 120, remaining: 119, resetAt: new Date() })) }));

import { POST } from "@/app/api/check/route";
import { emptyObservation } from "@/lib/domain/schemas";

describe("POST /api/check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NO_CLUE when no useful evidence is supplied", async () => {
    const request = new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: emptyObservation(), region: "UK" }) });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ verdict: "NO_CLUE", matchLevel: "none" });
  });

  it("rejects malformed observations", async () => {
    const request = new Request("http://localhost/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: { barcode: 12 }, region: "UK" }) });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
  });
});
