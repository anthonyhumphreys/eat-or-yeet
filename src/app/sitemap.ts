import type { MetadataRoute } from "next";

import { listActivePublicIncidents } from "@/db/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const rows = await listActivePublicIncidents().catch(() => []);
  return [
    { url: origin, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/incidents`, changeFrequency: "daily", priority: 0.8 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    ...rows.map((incident) => ({ url: `${origin}/incidents/${incident.slug}`, lastModified: incident.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
