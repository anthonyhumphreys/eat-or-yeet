import { syncFsis } from "./fsis-sync";
import { syncFdaAnnouncements } from "./fda-sync";

export async function syncFoodSources(env: NodeJS.ProcessEnv, includeFDA: boolean) {
  if (!includeFDA) return syncFsis({ env });
  const [fsis, fda] = await Promise.allSettled([syncFsis({ env }), syncFdaAnnouncements(env)]);
  if (fsis.status === "rejected" || fda.status === "rejected") {
    const failed = [fsis.status === "rejected" ? "USDA" : null, fda.status === "rejected" ? "FDA announcements" : null].filter(Boolean);
    throw new Error(`Food source sync failed for ${failed.join(", ")}; see the ingestion ledgers`);
  }
  return { fsis: fsis.value, fda: fda.value };
}
