import { afterEach, describe, expect, it, vi } from "vitest";
import { syncFsis } from "../scripts/lib/fsis-sync";
import { syncFdaAnnouncements } from "../scripts/lib/fda-sync";
import { syncFoodSources } from "../scripts/lib/food-source-sync";
vi.mock("../scripts/lib/fsis-sync", () => ({ syncFsis: vi.fn() }));
vi.mock("../scripts/lib/fda-sync", () => ({ syncFdaAnnouncements: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const success = { status: "success", found: 1, created: 0, updated: 0, errors: [] };
describe("independent NAS source syncs", () => {
  it.each(["USDA", "FDA announcements"])("attempts both sources when %s fails without exposing transport details", async source => {
    vi.mocked(syncFsis).mockImplementation(async () => { if (source === "USDA") throw new Error("secret token"); return success; });
    vi.mocked(syncFdaAnnouncements).mockImplementation(async () => { if (source === "FDA announcements") throw new Error("secret token"); return success; });
    await expect(syncFoodSources({ NODE_ENV: "test" }, true)).rejects.toThrow(`Food source sync failed for ${source}; see the ingestion ledgers`);
    expect(syncFsis).toHaveBeenCalledOnce(); expect(syncFdaAnnouncements).toHaveBeenCalledOnce();
  });
  it("retains both results after both imports succeed", async () => {
    vi.mocked(syncFsis).mockResolvedValue(success); vi.mocked(syncFdaAnnouncements).mockResolvedValue(success);
    await expect(syncFoodSources({ NODE_ENV: "test" }, true)).resolves.toEqual({ fsis: success, fda: success });
  });
});
