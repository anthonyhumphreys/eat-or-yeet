import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/queries", () => ({
  getRegionCoverage: vi.fn(),
  WarningSnapshotLimitError: class extends Error {},
}));
vi.mock("@/lib/checks/service", () => ({ checkProduct: vi.fn() }));
vi.mock("@/lib/incidents/details", () => ({ getWarningDetails: vi.fn(), WarningDetailsCursorError: class extends Error {} }));
vi.mock("@/lib/incidents/search", () => ({
  searchWarnings: vi.fn(),
  WarningSearchCursorError: class extends Error {},
}));
vi.mock("@/lib/security/integration-rate-limit", () => ({ takeIntegrationRateLimits: vi.fn() }));
vi.mock("@/lib/integrations/serialize", () => ({ serializeCoverage: vi.fn((value) => value), serializeCheckResult: vi.fn((value) => value), serializeSearchResult: vi.fn((value) => value), PublicResponseTooLargeError: class extends Error {} }));
vi.mock("@/lib/integrations/shopping/review", () => ({ reviewShoppingItems: vi.fn() }));

import { getRegionCoverage } from "@/db/queries";
import { checkProduct } from "@/lib/checks/service";
import { getWarningDetails } from "@/lib/incidents/details";
import { reviewShoppingItems } from "@/lib/integrations/shopping/review";
import { searchWarnings } from "@/lib/incidents/search";
import { executeTool, untilAborted } from "@/lib/integrations/mcp/services";
import { takeIntegrationRateLimits } from "@/lib/security/integration-rate-limit";
import { WarningSnapshotLimitError } from "@/db/queries";

const context = () => ({ signal: new AbortController().signal, network: "network:ipv4:198.51.100.1" });

describe("MCP application boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(takeIntegrationRateLimits).mockResolvedValue([
      { scope: "global", allowed: true, limit: 1000, remaining: 999, resetAt: new Date(Date.now() + 1000) },
    ]);
  });

  it("rejects omitted region, nested extra fields and oversized arguments before quotas", async () => {
    await expect(executeTool("check_product", { observation: { barcode: "044000061494" } }, context())).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(executeTool("check_product", { region: "US", observation: { dates: { useBy: "2026-10-09", inferred: true } } }, context())).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(executeTool("get_coverage", { region: "US", extra: "x".repeat(17000) }, context())).rejects.toMatchObject({ code: "invalid_arguments" });
    expect(takeIntegrationRateLimits).not.toHaveBeenCalled();
  });

  it("fails closed on exhausted or unavailable counters without a product check", async () => {
    vi.mocked(takeIntegrationRateLimits).mockResolvedValueOnce([
      { scope: "global", allowed: false, limit: 1000, remaining: 0, resetAt: new Date(Date.now() + 10000) },
    ]);
    await expect(executeTool("check_product", { region: "US", observation: { barcode: "044000061494" } }, context())).rejects.toMatchObject({ code: "quota_exceeded", recoverable: true, retryAfterSeconds: expect.any(Number) });
    vi.mocked(takeIntegrationRateLimits).mockRejectedValueOnce(new Error("PRIVATE datastore body"));
    await expect(executeTool("check_product", { region: "US", observation: { barcode: "044000061494" } }, context())).rejects.toMatchObject({ code: "unavailable", message: "The warning service is unavailable. No completed check was returned." });
    expect(checkProduct).not.toHaveBeenCalled();
  });

  it("uses coverage-only reads and distinguishes missing warnings", async () => {
    vi.mocked(getRegionCoverage).mockResolvedValueOnce({ healthy: false } as never);
    await expect(executeTool("get_coverage", { region: "US" }, context())).resolves.toEqual({ healthy: false });
    expect(takeIntegrationRateLimits).toHaveBeenCalledWith("network:ipv4:198.51.100.1", "mcp_coverage");
    expect(getRegionCoverage).toHaveBeenCalledWith("US");
    vi.mocked(getWarningDetails).mockResolvedValueOnce(null);
    await expect(executeTool("get_warning", { slug: "missing-warning" }, context())).rejects.toMatchObject({ code: "not_found" });
    expect(checkProduct).not.toHaveBeenCalled();
  });

  it("charges private shopping quota by item count and requires a connection", async () => {
    const input = { region: "US", items: [{ id: "one", name: "Milk" }, { id: "two", name: "Bread" }] };
    await expect(executeTool("review_shopping_items", input, context())).rejects.toMatchObject({ code: "unavailable" });
    expect(takeIntegrationRateLimits).not.toHaveBeenCalled();

    const connection = { id: "notion-shopping", dailyLimit: 40 };
    vi.mocked(reviewShoppingItems).mockResolvedValueOnce({ items: [] } as never);
    await expect(executeTool("review_shopping_items", input, { ...context(), connection })).resolves.toEqual({ items: [] });
    expect(takeIntegrationRateLimits).toHaveBeenCalledWith(context().network, "mcp_shopping", 2, connection);
    expect(reviewShoppingItems).toHaveBeenCalledWith({ region: "US", items: [
      { id: "one", name: "Milk", bought: false }, { id: "two", name: "Bread", bought: false },
    ] }, { signal: expect.any(AbortSignal) });
  });

  it("does not begin a cancelled check or begin work after cancelled quota consumption", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(executeTool("get_coverage", { region: "US" }, { ...context(), signal: cancelled.signal })).rejects.toMatchObject({ code: "interrupted" });
    expect(takeIntegrationRateLimits).not.toHaveBeenCalled();
    const inFlight = new AbortController();
    vi.mocked(takeIntegrationRateLimits).mockImplementationOnce(async () => { inFlight.abort(); return []; });
    await expect(executeTool("get_coverage", { region: "US" }, { ...context(), signal: inFlight.signal })).rejects.toMatchObject({ code: "interrupted" });
    expect(getRegionCoverage).not.toHaveBeenCalled();
  });

  it("passes request cancellation into searches and returns a qualified snapshot-cap error", async () => {
    const current = context();
    vi.mocked(searchWarnings).mockRejectedValueOnce(new WarningSnapshotLimitError());

    await expect(executeTool("search_warnings", { region: "UK" }, current)).rejects.toMatchObject({
      code: "snapshot_limit",
      recoverable: true,
      message: expect.stringMatching(/complete warning search.*No partial results/i),
    });
    expect(searchWarnings).toHaveBeenCalledWith({ region: "UK", pageSize: 20 }, { signal: current.signal });
  });

  it("settles promptly on abort even while an uncancellable dependency finishes later", async () => {
    const controller = new AbortController();
    let finish: (value: string) => void = () => undefined;
    const work = new Promise<string>((resolve) => { finish = resolve; });
    const waiting = untilAborted(work, controller.signal);
    controller.abort(new Error("stop"));
    await expect(waiting).rejects.toThrow("stop");
    finish("late");
    await expect(work).resolves.toBe("late");
  });
});
