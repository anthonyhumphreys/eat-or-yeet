import { z } from "zod";

import { parseDateBounds } from "@/lib/incidents/date-bounds";
import { fetchOfficialJson } from "@/lib/incidents/official-source-http";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";

const FDA_API = "https://api.fda.gov/food/enforcement.json";
const PAGE_SIZE = 1_000;
const DETAIL_CONCURRENCY = 5;

const recordSchema = z.object({
  status: z.string().trim().min(1),
  classification: z.string().optional().default("Unclassified"),
  country: z.string().optional().default("United States"),
  recalling_firm: z.string(),
  recall_number: z.string().optional().default(""),
  event_id: z.string().optional().default(""),
  product_description: z.string(),
  reason_for_recall: z.string(),
  recall_initiation_date: z.string(),
  report_date: z.string(),
  code_info: z.string().optional().default(""),
  distribution_pattern: z.string().optional().default(""),
}).passthrough();

const pageSchema = z.object({
  meta: z.object({ results: z.object({ skip: z.number(), limit: z.number(), total: z.number() }) }).passthrough(),
  results: z.array(recordSchema),
}).passthrough();

const responseSchema = z.object({ results: z.array(recordSchema) }).passthrough();

function parseFdaDate(value: string, field: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const date = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`FDA recall has an invalid ${field}: ${value}`);
  return date;
}

function pathogenFrom(reason: string): string | null {
  const names = ["Salmonella", "Listeria monocytogenes", "E. coli", "Clostridium botulinum", "Hepatitis A"];
  return names.find((name) => reason.toLowerCase().includes(name.toLowerCase())) ?? null;
}

function dateRestriction(codeInfo: string): { bounds: ReturnType<typeof parseDateBounds>; note: string | null } {
  if (!/\b(?:best\s*before|best\s*by|use\s*by|expiration|expiry|exp\.?|sell\s*by|production\s*date|packed\s*on|date\s+code)\b/i.test(codeInfo)) {
    return { bounds: null, note: null };
  }
  const note = `Affected date information: ${codeInfo.slice(0, 500)}`;
  return { bounds: parseDateBounds(codeInfo, false), note };
}

function codeTargets(record: z.infer<typeof recordSchema>): NormalisedTarget[] {
  const targets: NormalisedTarget[] = [];
  const info = record.code_info;
  const dates = dateRestriction(info);
  const lotValues = new Set<string>();
  const lotPattern = /\b(?:lot|batch)(?:\s+(?:code|number|no\.?|#))?\s*:?[ \t]*([A-Z0-9][A-Z0-9./-]{2,30})|\bcode\s*(?:number|no\.?|#)?\s*:?[ \t]*([A-Z0-9][A-Z0-9./-]{2,30})/gi;
  for (const match of info.matchAll(lotPattern)) lotValues.add(match[1] ?? match[2]);

  [...lotValues].forEach((value, index) => {
    const uniqueLotDate = lotValues.size === 1 ? dates.bounds : null;
    targets.push({
      type: "lot",
      value,
      groupId: `lot-${index}`,
      notes: dates.note,
      ...(uniqueLotDate ?? {}),
      weight: 60,
      confidence: 0.9,
    });
  });

  const gtinValues = new Set<string>();
  const codeText = `${record.product_description} ${info}`;
  for (const context of codeText.matchAll(/\b(?:UPC|GTIN|bar\s*codes?|barcode)\b[\s#:]*(.{0,240})/gi)) {
    for (const match of context[1].matchAll(/(?<!\d)(?:\d[\s-]*){8,14}(?!\d)/g)) {
      const value = match[0].replace(/\D/g, "");
      if (isValidGtin(value)) gtinValues.add(value);
    }
  }
  [...gtinValues].forEach((value, index) => {
    targets.push({ type: "gtin", value, groupId: `gtin-${index}`, notes: dates.note, weight: 70, confidence: 0.95 });
  });

  if (!lotValues.size && dates.bounds) {
    targets.push({
      type: "product",
      value: record.product_description.slice(0, 300),
      groupId: "date-restricted-product",
      notes: dates.note,
      ...dates.bounds,
      weight: 32,
      confidence: 0.75,
    });
  }
  return targets;
}

function incidentStatus(sourceStatus: string): "active" | "resolved" {
  switch (sourceStatus.trim().toLowerCase()) {
    case "completed":
    case "terminated":
      return "resolved";
    case "ongoing":
    case "pending":
    default:
      // Unknown and pending statuses remain visible until FDA explicitly closes them.
      return "active";
  }
}

function syntheticSourceId(record: z.infer<typeof recordSchema>, productName: string): string {
  return `unclassified-${record.report_date}-${slugify(`${record.recalling_firm}-${productName}`)}`;
}

function legacySourceIds(record: z.infer<typeof recordSchema>): string[] {
  const productNames = new Set([
    record.product_description.trim().slice(0, 300),
    record.product_description.split(/[;,]/)[0].trim().slice(0, 300),
  ]);
  return [...new Set([...productNames].map((productName) => syntheticSourceId(record, productName)))];
}

function legacySourceId(record: z.infer<typeof recordSchema>): string {
  return legacySourceIds(record)[0];
}

function sourceIdForRecord(record: z.infer<typeof recordSchema>): string {
  return record.recall_number.trim() || legacySourceId(record);
}

export function parseFdaRecord(value: unknown): NormalisedIncident {
  const record = recordSchema.parse(value);
  const productName = record.product_description.trim().slice(0, 300);
  const recallNumber = record.recall_number.trim();
  const sourceId = sourceIdForRecord(record);
  const reportedAt = parseFdaDate(record.report_date, "report date");
  const startsAt = parseFdaDate(record.recall_initiation_date, "recall initiation date");
  const officialApiUrl = recallNumber
    ? `${FDA_API}?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`
    : "https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/";
  const severity = record.classification === "Class I" ? "critical" : record.classification === "Class II" ? "high" : "medium";
  const eventGroup = "record-product";
  const targets: NormalisedTarget[] = [
    { type: "producer", value: record.recalling_firm, groupId: eventGroup, weight: 45, confidence: 1 },
    { type: "product", value: productName, groupId: eventGroup, weight: 35, confidence: 0.8 },
    ...codeTargets(record),
  ];

  return {
    title: `${record.recalling_firm} recall: ${productName}`,
    slug: slugify(`fda-${sourceId}`),
    region: "US",
    status: incidentStatus(record.status),
    hazard: record.reason_for_recall,
    pathogen: pathogenFrom(record.reason_for_recall),
    summary: record.product_description,
    consumerAdvice: "Do not consume an affected product. Follow the firm's instructions and the latest FDA enforcement report.",
    authority: "U.S. Food and Drug Administration",
    authorityUrl: officialApiUrl,
    sourceId,
    publishedAt: reportedAt,
    updatedAt: reportedAt,
    startsAt,
    endsAt: null,
    severity,
    confidence: 1,
    originalSourceData: record,
    targets,
  };
}

async function fetchStatusPage(status: string, skip: number, requestedLimit: number) {
  const url = new URL(FDA_API);
  url.searchParams.set("search", `status:\"${status}\"`);
  url.searchParams.set("sort", "report_date:desc");
  url.searchParams.set("limit", String(requestedLimit));
  url.searchParams.set("skip", String(skip));
  const payload = await fetchOfficialJson(url.toString(), {
    sourceName: "FDA openFDA",
    headers: { Accept: "application/json" },
    timeoutMs: 20_000,
    cache: "no-store",
  });
  const parsed = pageSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`FDA ${status} page at offset ${skip} had an invalid response: ${parsed.error.message}`);
  if (parsed.data.meta.results.skip !== skip || parsed.data.meta.results.limit !== requestedLimit) {
    throw new Error(`FDA ${status} page metadata did not match the requested offset and limit`);
  }
  return parsed.data;
}

async function fetchAllWithStatus(status: string): Promise<NormalisedIncident[]> {
  const firstPage = await fetchStatusPage(status, 0, PAGE_SIZE);
  const total = firstPage.meta.results.total;
  const pages = [firstPage.results];
  for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, total - skip);
    const page = await fetchStatusPage(status, skip, limit);
    if (page.meta.results.total !== total) throw new Error(`FDA ${status} total changed while paging (${total} to ${page.meta.results.total})`);
    pages.push(page.results);
  }

  const records = pages.flat();
  if (records.length !== total) throw new Error(`FDA ${status} import received ${records.length} of ${total} records`);
  const ids = new Set<string>();
  for (const record of records) {
    const id = sourceIdForRecord(record);
    if (ids.has(id)) throw new Error(`FDA ${status} query repeated recall ${id}`);
    ids.add(id);
  }
  return records.map(parseFdaRecord);
}

async function fetchRecallByNumber(recallNumber: string): Promise<NormalisedIncident> {
  const url = new URL(FDA_API);
  url.searchParams.set("search", `recall_number:\"${recallNumber}\"`);
  url.searchParams.set("limit", "2");
  const payload = await fetchOfficialJson(url.toString(), {
    sourceName: "FDA openFDA status lookup",
    headers: { Accept: "application/json" },
    timeoutMs: 20_000,
    cache: "no-store",
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.results.length !== 1) {
    throw new Error(`FDA status lookup for ${recallNumber} was missing or ambiguous`);
  }
  const incident = parseFdaRecord(parsed.data.results[0]);
  if (incident.sourceId !== recallNumber) throw new Error(`FDA status lookup returned a different recall for ${recallNumber}`);
  return incident;
}

async function resolvePreviouslyActive(existingSourceIds: string[], current: NormalisedIncident[]): Promise<NormalisedIncident[]> {
  const currentIds = new Set(current.map((incident) => incident.sourceId));
  const missingIds = [...new Set(existingSourceIds)].filter((sourceId) => !currentIds.has(sourceId));
  const needsLegacyAliases = missingIds.some((sourceId) => sourceId.startsWith("unclassified-"));
  const legacyAliases = new Map<string, Set<NormalisedIncident>>();

  if (needsLegacyAliases) {
    for (const incident of current) {
      const parsedRecord = recordSchema.safeParse(incident.originalSourceData);
      if (!parsedRecord.success) {
        throw new Error(`FDA could not verify the legacy source ID for current recall ${incident.sourceId}`);
      }
      for (const legacyId of legacySourceIds(parsedRecord.data)) {
        const aliases = legacyAliases.get(legacyId) ?? new Set<NormalisedIncident>();
        aliases.add(incident);
        legacyAliases.set(legacyId, aliases);
      }
    }
  }

  const lookupIds: string[] = [];
  for (const sourceId of missingIds) {
    if (sourceId.startsWith("unclassified-")) {
      const matches = [...(legacyAliases.get(sourceId) ?? [])];
      if (matches.length === 1 && matches[0].status === "active") continue;
      if (matches.length > 1) {
        throw new Error(`FDA legacy source ID ${sourceId} ambiguously matches multiple ongoing recalls`);
      }
      throw new Error("FDA cannot safely status-check a previously active recall without its official recall number");
    }
    lookupIds.push(sourceId);
  }

  const lookedUp: NormalisedIncident[] = [];

  for (let index = 0; index < lookupIds.length; index += DETAIL_CONCURRENCY) {
    const group = lookupIds.slice(index, index + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(group.map(fetchRecallByNumber));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) {
      const reason = failures[0].reason;
      throw new Error(`FDA status lookup failed for ${failures.length} of ${group.length} previously active recalls: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    lookedUp.push(...results.map((result) => (result as PromiseFulfilledResult<NormalisedIncident>).value));
  }
  return lookedUp;
}

export const fdaSource: IncidentSource = {
  id: "fda",
  name: "U.S. Food and Drug Administration",
  url: FDA_API,
  region: "US",
  scope: "All openFDA Food Enforcement Reports with status Ongoing, plus explicit status checks for previously active recalls absent from that set.",
  async fetchIncidents(existingSourceIds = []) {
    const ongoing = await fetchAllWithStatus("Ongoing");
    const statusChecks = await resolvePreviouslyActive(existingSourceIds, ongoing);
    const combined = [...ongoing, ...statusChecks];
    const byId = new Map<string, NormalisedIncident>();
    for (const incident of combined) {
      const existing = byId.get(incident.sourceId);
      if (existing && existing.status !== incident.status) {
        throw new Error(`FDA returned conflicting statuses for recall ${incident.sourceId}`);
      }
      byId.set(incident.sourceId, incident);
    }
    return [...byId.values()];
  },
};
