import { notionRoute } from "@/lib/integrations/notion-hosted";

export const runtime = "nodejs";
export const maxDuration = 30;

export function POST(request: Request) {
  return notionRoute("manage", request);
}
