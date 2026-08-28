import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";

import { api } from "@convex/_generated/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const results = await fetchAction(api.incidents.refreshAll, { secret: process.env.CONVEX_SERVER_SECRET ?? "" });
  const failed = results.some((result) => result.errors.length > 0);
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 207 : 200 });
}
