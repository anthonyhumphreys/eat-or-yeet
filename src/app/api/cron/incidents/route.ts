import { NextRequest, NextResponse } from "next/server";
import { fetchAction } from "convex/nextjs";

import { api } from "@convex/_generated/api";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const result = await fetchAction(api.incidents.refreshAll, { secret: process.env.CONVEX_SERVER_SECRET ?? "" });
    return NextResponse.json({ status: "queued", sources: result.queued }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The refresh could not be queued." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
