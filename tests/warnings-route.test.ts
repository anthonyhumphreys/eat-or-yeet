import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, restart } = vi.hoisted(() => ({ query: vi.fn(), restart: vi.fn(() => false) }));
vi.mock("@/db/browse", () => ({ getBrowsePage: query, browseRestart: restart }));
import { GET } from "@/app/api/warnings/route";

beforeEach(() => { vi.resetAllMocks(); restart.mockReturnValue(false); });

describe("public indexed browse response", () => {
  it("rejects unsupported regions before reading a page", async () => {
    expect((await GET(new Request("https://example.test/api/warnings?region=CA"))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("forwards bounded filters and a cursor without allowing response reuse", async () => {
    query.mockResolvedValue({ rows: [], total: 0 });
    const response = await GET(new Request("https://example.test/api/warnings?region=US&q=milk&type=Food&cursor=next-page"));
    expect(query).toHaveBeenCalledWith("US", expect.objectContaining({ q: "milk", type: "Food" }), "next-page");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("reports an outage without returning an empty successful result", async () => {
    query.mockRejectedValue(new Error("private datastore details"));
    const response = await GET(new Request("https://example.test/api/warnings?region=US"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Warnings are temporarily unavailable." });
  });
  it("asks the browser to restart when a snapshot revision changes", async () => {
    query.mockRejectedValue(new Error("changed")); restart.mockReturnValue(true);
    expect((await GET(new Request("https://example.test/api/warnings?region=US"))).status).toBe(409);
  });
});
