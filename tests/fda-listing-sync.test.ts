import { afterEach, describe, expect, it, vi } from "vitest";

import { fdaAnnouncementsSource, fetchFdaAnnouncementListings } from "@/lib/incidents/fda-announcements";
import { syncFdaAnnouncements } from "../scripts/lib/fda-sync";
import { uploadSnapshot } from "../scripts/lib/snapshot-upload";

vi.mock("../src/lib/incidents/fda-announcements", async importOriginal => {
  const original = await importOriginal<typeof import("../src/lib/incidents/fda-announcements")>();
  return { ...original, fetchFdaAnnouncementListings: vi.fn(), fdaAnnouncementsSource: { ...original.fdaAnnouncementsSource, fetchIncidents: vi.fn() } };
});
vi.mock("../scripts/lib/snapshot-upload", () => ({ uploadSnapshot: vi.fn(async () => ({ status: "success" })) }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

const listing = { path: "/safety/recalls-market-withdrawals-safety-alerts/fixture", publishedAt: new Date("2026-10-01"),
  brand: "Fixture", product: "Fixture food", productType: "Food & Beverages", reason: "Milk", company: "Fixture", terminationStatus: "", terminated: false };
const env = { NODE_ENV: "test" as const, BACKEND_URL: "https://backend.example.test", FDA_UPLOAD_TOKEN: "private-fda-upload-token", FDA_ANNOUNCEMENTS_UPLOAD_MODE: "listings" };

describe("FDA listing handoff to Cloudflare", () => {
  it("uploads only the complete validated listing without retrieving detail pages or using a Firecrawl key", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "not-for-the-nas");
    vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue([listing]);
    await syncFdaAnnouncements(env);
    expect(fdaAnnouncementsSource.fetchIncidents).not.toHaveBeenCalled();
    expect(uploadSnapshot).toHaveBeenCalledWith(new URL("https://backend.example.test/admin/fda-announcement-listings"), env.FDA_UPLOAD_TOKEN,
      "FDA announcement listings", [{ ...listing, publishedAt: listing.publishedAt.getTime() }], expect.any(Number), 60);
  });

  it("rejects duplicate notice identifiers before upload", async () => {
    vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue([listing, listing]);
    await expect(syncFdaAnnouncements(env)).rejects.toThrow("repeats");
    expect(uploadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a listing containing a non-FDA notice path", async () => {
    vi.mocked(fetchFdaAnnouncementListings).mockResolvedValue([{ ...listing, path: "https://example.test/recall" }]);
    await expect(syncFdaAnnouncements(env)).rejects.toThrow();
    expect(uploadSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an unknown upload mode before fetching any source", async () => {
    await expect(syncFdaAnnouncements({ ...env, FDA_ANNOUNCEMENTS_UPLOAD_MODE: "firecrawl" })).rejects.toThrow("must be full or listings");
    expect(fetchFdaAnnouncementListings).not.toHaveBeenCalled();
  });
});
