import { describe, expect, it, vi } from "vitest";
import { createCredentialSession } from "../backend/notionActions";

describe("hosted Notion credential request wrapper", () => {
  it("pins requests to the Notion API and replaces caller authorization", async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-current");
      return new Response("{}", { status: 200 });
    });
    const session = createCredentialSession("access-current", async () => null, fetcher);

    await expect(session.fetcher("https://api.notion.com/v1/pages/page-1", {
      headers: { authorization: "Bearer attacker-value" },
    })).resolves.toMatchObject({ status: 200 });
    await expect(session.fetcher("https://api.notion.com.attacker.test/v1/pages/page-1")).rejects.toThrow("target is invalid");
    await expect(session.fetcher("https://api.notion.com/v2/pages/page-1")).rejects.toThrow("target is invalid");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rotates once after a GET 401 and retries only that idempotent request", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("private error body", { status: 401 }))
      .mockImplementationOnce(async (_input: string | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-rotated");
        return new Response("{}", { status: 200 });
      });
    const rotate = vi.fn(async () => "access-rotated");
    const session = createCredentialSession("access-old", rotate, fetcher);
    const signal = AbortSignal.timeout(1_000);

    await expect(session.fetcher("https://api.notion.com/v1/pages/page-1", { method: "GET", signal })).resolves.toMatchObject({ status: 200 });
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(session.refreshSucceeded).toBe(true);
  });

  it("rotates credentials after a write 401 but never repeats the write", async () => {
    const fetcher = vi.fn(async () => new Response("private error body", { status: 401 }));
    const rotate = vi.fn(async () => "access-rotated");
    const session = createCredentialSession("access-old", rotate, fetcher);

    const response = await session.fetcher("https://api.notion.com/v1/pages/page-1", {
      method: "PATCH", body: JSON.stringify({ properties: { Bought: { checkbox: false } } }),
      signal: AbortSignal.timeout(1_000),
    });
    expect(response.status).toBe(401);
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(session.refreshSucceeded).toBe(true);
  });
});
