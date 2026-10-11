import { notionRoute } from "@/lib/integrations/notion-hosted";

export const runtime = "nodejs";
export const maxDuration = 30;

export function GET(request: Request) {
  return notionRoute("connect", request);
}
