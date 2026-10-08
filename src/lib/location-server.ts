import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { parseRegion, regionFromCountryCode, REGION_COOKIE } from "@/lib/location";

export const getSavedRegion = cache(async () => {
  return parseRegion((await cookies()).get(REGION_COOKIE)?.value);
});

export const getPreferredRegion = cache(async () => (await getSavedRegion()) ?? "UK");

export const getSuggestedRegion = cache(async () => {
  return regionFromCountryCode((await headers()).get("x-vercel-ip-country"));
});
