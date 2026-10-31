import { fdaAnnouncementsSource, fetchFdaAnnouncementListings } from "../../src/lib/incidents/fda-announcements";
import { fdaListingSnapshotSchema } from "../../src/lib/incidents/fda-listing-snapshot";
import { serialiseSourceIncident } from "../../src/lib/incidents/serialise";
import { uploadSnapshot } from "./snapshot-upload";

export async function syncFdaAnnouncements(env: NodeJS.ProcessEnv) {
  if (!env.BACKEND_URL || !env.FDA_UPLOAD_TOKEN) throw new Error("BACKEND_URL and FDA_UPLOAD_TOKEN are required");
  const mode = env.FDA_ANNOUNCEMENTS_UPLOAD_MODE ?? "full";
  if (mode !== "full" && mode !== "listings") throw new Error("FDA_ANNOUNCEMENTS_UPLOAD_MODE must be full or listings");
  const url = new URL(mode === "listings" ? "/admin/fda-announcement-listings" : "/admin/fda-announcements", env.BACKEND_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("The backend requires HTTPS");
  if (mode === "listings") {
    const listings = fdaListingSnapshotSchema.parse((await fetchFdaAnnouncementListings()).map(item => ({ ...item, publishedAt: item.publishedAt.getTime() })));
    return uploadSnapshot(url, env.FDA_UPLOAD_TOKEN, "FDA announcement listings", listings, Date.now(), 60);
  }
  const incidents = await fdaAnnouncementsSource.fetchIncidents();
  if (!incidents.length) throw new Error("FDA announcements archive was empty");
  console.log(`Validated ${incidents.length} FDA food and supplement announcements.`);
  return uploadSnapshot(url, env.FDA_UPLOAD_TOKEN, "FDA announcements", incidents.map(serialiseSourceIncident), Date.now());
}
