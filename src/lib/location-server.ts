import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { parseRegion, REGION_COOKIE } from "@/lib/location";

export const getPreferredRegion = cache(async () => {
  return parseRegion((await cookies()).get(REGION_COOKIE)?.value) ?? "UK";
});
