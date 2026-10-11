import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getIncidentBySlug } from "@/db/queries";
import { rowSuperCategories } from "@/lib/incidents/browse";
import type { MatchableIncident } from "@/lib/domain/types";
import { groupAffectedTargets, serializeWarningDetails, serializeWarningSummary } from "@/lib/integrations/serialize";
import type { GetWarningInput, PublicWarningDetails } from "@/lib/integrations/contracts";
import { securitySecret } from "@/lib/security/config";

const MAX_PAGE_SIZE = 20;
const CURSOR_TTL_MS = 10 * 60 * 1_000;
const CURSOR_PURPOSE = "eat-or-yeet:warning-details-cursor:v2:";

type CursorPayload = {
  v: 2;
  slug: string;
  incidentRevision: string;
  pageSize: number;
  offset: number;
  asOf: number;
  expiresAt: number;
};

export type WarningDetailsCursorErrorCode = "invalid" | "expired" | "input_changed" | "revision_changed";

/** Cursor errors are recoverable by restarting warning details from page one. */
export class WarningDetailsCursorError extends Error {
  readonly recoverable = true;

  constructor(readonly code: WarningDetailsCursorErrorCode) {
    super("This warning details page has expired or changed. Restart from the warning details page.");
    this.name = "WarningDetailsCursorError";
  }
}

function signature(encoded: string): Buffer {
  return createHmac("sha256", securitySecret()).update(CURSOR_PURPOSE).update(encoded).digest();
}

function signCursor(payload: CursorPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

function readCursor(value: string): CursorPayload {
  try {
    if (value.length > 2048) throw new Error("too_large");
    const [encoded, suppliedSignature, extra] = value.split(".");
    if (!encoded || !suppliedSignature || extra !== undefined) throw new Error("malformed");
    const actual = Buffer.from(suppliedSignature, "base64url");
    const expected = signature(encoded);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("signature");
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("payload");
    const payload = parsed as Partial<CursorPayload>;
    if (payload.v !== 2 || typeof payload.slug !== "string" ||
        typeof payload.incidentRevision !== "string" || !/^[a-f0-9]{64}$/.test(payload.incidentRevision) ||
        !Number.isSafeInteger(payload.pageSize) ||
        (payload.pageSize as number) < 1 || (payload.pageSize as number) > MAX_PAGE_SIZE ||
        !Number.isSafeInteger(payload.offset) || (payload.offset as number) < 1 ||
        !Number.isSafeInteger(payload.asOf) || !Number.isSafeInteger(payload.expiresAt)) throw new Error("payload");
    return payload as CursorPayload;
  } catch {
    throw new WarningDetailsCursorError("invalid");
  }
}

function revisionOf(incident: MatchableIncident, groups: ReturnType<typeof groupAffectedTargets>) {
  const publicPayload = {
    warning: serializeWarningSummary(incident),
    consumerAdvice: incident.consumerAdvice,
    affectedGroups: groups,
  };
  return createHash("sha256").update(JSON.stringify(publicPayload)).digest("hex");
}

/** Returns complete affected groups a page at a time for any published warning. */
export async function getWarningDetails(input: GetWarningInput): Promise<PublicWarningDetails | null> {
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(input.pageSize ?? MAX_PAGE_SIZE)));
  const cursor = input.cursor ? readCursor(input.cursor) : null;
  if (cursor && (cursor.slug !== input.slug || cursor.pageSize !== pageSize)) {
    throw new WarningDetailsCursorError("input_changed");
  }

  const incident = await getIncidentBySlug(input.slug);
  if (!incident || !rowSuperCategories(incident).includes("Food")) return null;

  const groups = groupAffectedTargets(incident.targets);
  const incidentRevision = revisionOf(incident, groups);
  const now = Date.now();
  let offset = 0;
  let asOf = now;
  let expiresAt = now + CURSOR_TTL_MS;

  if (cursor) {
    if (cursor.incidentRevision !== incidentRevision) throw new WarningDetailsCursorError("revision_changed");
    if (now >= cursor.expiresAt) throw new WarningDetailsCursorError("expired");
    offset = cursor.offset;
    asOf = cursor.asOf;
    expiresAt = cursor.expiresAt;
  }

  const page = groups.slice(offset, offset + pageSize);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < groups.length
    ? signCursor({ v: 2, slug: input.slug, incidentRevision, pageSize, offset: nextOffset, asOf, expiresAt })
    : null;
  return serializeWarningDetails(incident, page, groups.length, nextCursor);
}
