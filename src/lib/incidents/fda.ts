import { z } from "zod";

import { parseDateBounds } from "@/lib/incidents/date-bounds";
import { fetchOfficialJson } from "@/lib/incidents/official-source-http";
import type { IncidentSource, NormalisedIncident, NormalisedTarget, TrackedSourceNotice } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";

const FDA_API = "https://api.fda.gov/food/enforcement.json";
const FDA_DRUG_API = "https://api.fda.gov/drug/enforcement.json";
const PAGE_SIZE = 1_000;
const DETAIL_CONCURRENCY = 5;

/** One openFDA enforcement-report endpoint. Food and drug reports share the same record shape. */
type EnforcementEndpoint = {
  api: string;
  label: string;
  consumerAdvice: string;
  historicalReports?: boolean;
  extraTargets?: (record: z.infer<typeof recordSchema>) => NormalisedTarget[];
};

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

function parseEnforcementRecord(value: unknown, endpoint: EnforcementEndpoint): NormalisedIncident {
  const record = recordSchema.parse(value);
  const productName = record.product_description.trim().slice(0, 300);
  const recallNumber = record.recall_number.trim();
  const sourceId = sourceIdForRecord(record);
  const reportedAt = parseFdaDate(record.report_date, "report date");
  const startsAt = parseFdaDate(record.recall_initiation_date, "recall initiation date");
  const officialApiUrl = recallNumber
    ? `${endpoint.api}?search=recall_number:%22${encodeURIComponent(recallNumber)}%22`
    : "https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/";
  const severity = record.classification === "Class I" ? "critical" : record.classification === "Class II" ? "high" : "medium";
  const eventGroup = "record-product";
  const targets: NormalisedTarget[] = [
    { type: "producer", value: record.recalling_firm, groupId: eventGroup, weight: 45, confidence: 1 },
    { type: "product", value: productName, groupId: eventGroup, weight: 35, confidence: 0.8 },
    ...codeTargets(record),
    ...(endpoint.extraTargets?.(record) ?? []),
  ];

  return {
    title: `${record.recalling_firm} recall: ${productName}`,
    slug: slugify(`fda-${sourceId}`),
    region: "US",
    status: endpoint.historicalReports ? "reported" : incidentStatus(record.status),
    hazard: record.reason_for_recall,
    pathogen: pathogenFrom(record.reason_for_recall),
    summary: record.product_description,
    consumerAdvice: endpoint.consumerAdvice,
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

export function parseFdaRecord(value: unknown): NormalisedIncident {
  return parseEnforcementRecord(value, foodEndpoint);
}

export function parseFdaDrugRecord(value: unknown): NormalisedIncident {
  return parseEnforcementRecord(value, drugEndpoint);
}

// The key is optional: without one openFDA allows 1,000 requests a day per IP.
// It goes in a header so it never appears in URLs, which are logged in errors.
function openFdaHeaders(): Record<string, string> {
  const key = process.env.OPENFDA_API_KEY?.trim();
  return key
    ? { Accept: "application/json", Authorization: `Basic ${btoa(`${key}:`)}` }
    : { Accept: "application/json" };
}

async function fetchStatusPage(endpoint: EnforcementEndpoint, status: string, skip: number, requestedLimit: number) {
  const url = new URL(endpoint.api);
  url.searchParams.set("search", `status:\"${status}\"`);
  url.searchParams.set("sort", "report_date:desc");
  url.searchParams.set("limit", String(requestedLimit));
  url.searchParams.set("skip", String(skip));
  const payload = await fetchOfficialJson(url.toString(), {
    sourceName: endpoint.label,
    headers: openFdaHeaders(),
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

async function fetchAllWithStatus(endpoint: EnforcementEndpoint, status: string): Promise<NormalisedIncident[]> {
  const firstPage = await fetchStatusPage(endpoint, status, 0, PAGE_SIZE);
  const total = firstPage.meta.results.total;
  const pages = [firstPage.results];
  for (let skip = PAGE_SIZE; skip < total; skip += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, total - skip);
    const page = await fetchStatusPage(endpoint, status, skip, limit);
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
  return records.map((record) => parseEnforcementRecord(record, endpoint));
}

async function fetchRecallByNumber(endpoint: EnforcementEndpoint, recallNumber: string): Promise<NormalisedIncident> {
  const url = new URL(endpoint.api);
  url.searchParams.set("search", `recall_number:\"${recallNumber}\"`);
  url.searchParams.set("limit", "2");
  const payload = await fetchOfficialJson(url.toString(), {
    sourceName: `${endpoint.label} status lookup`,
    headers: openFdaHeaders(),
    timeoutMs: 20_000,
    cache: "no-store",
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.results.length !== 1) {
    throw new Error(`FDA status lookup for ${recallNumber} was missing or ambiguous`);
  }
  const incident = parseEnforcementRecord(parsed.data.results[0], endpoint);
  if (incident.sourceId !== recallNumber) throw new Error(`FDA status lookup returned a different recall for ${recallNumber}`);
  return incident;
}

function sameEventProduct(a: z.infer<typeof recordSchema>, b: z.infer<typeof recordSchema>): boolean {
  const text = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  return !!a.event_id.trim() && a.event_id === b.event_id
    && a.recall_initiation_date === b.recall_initiation_date
    && text(a.recalling_firm) === text(b.recalling_firm)
    && text(a.product_description) === text(b.product_description);
}

async function fetchRecallEvent(endpoint: EnforcementEndpoint, eventId: string) {
  if (!/^\d+$/.test(eventId)) throw new Error("FDA unnumbered report has no valid event identifier");
  const url = new URL(endpoint.api);
  url.searchParams.set("search", `event_id:\"${eventId}\"`);
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("skip", "0");
  const payload = await fetchOfficialJson(url.toString(), {
    sourceName: `${endpoint.label} event lookup`, headers: openFdaHeaders(), timeoutMs: 20_000,
    cache: "no-store", allowNotFound: true,
  });
  if (z.object({ error: z.object({ code: z.literal("NOT_FOUND"), message: z.string() }) }).safeParse(payload).success) return [];
  const page = pageSchema.parse(payload);
  if (page.meta.results.skip !== 0 || page.meta.results.limit !== PAGE_SIZE
    || page.results.length !== page.meta.results.total || page.results.some(record => record.event_id !== eventId)) {
    throw new Error(`FDA event lookup for ${eventId} was incomplete or returned a different event`);
  }
  return page.results.map(record => parseEnforcementRecord(record, endpoint));
}

async function reconcileUnnumbered(
  endpoint: EnforcementEndpoint, tracked: TrackedSourceNotice, current: NormalisedIncident[],
): Promise<NormalisedIncident> {
  const prior = recordSchema.parse(tracked.originalSourceData);
  if (incidentStatus(prior.status) !== "active") throw new Error("Tracked FDA report is not active");
  const matchesPrior = (incident: NormalisedIncident) => {
    const record = recordSchema.parse(incident.originalSourceData);
    return prior.recall_number.trim()
      ? prior.recall_number.trim() === record.recall_number.trim()
      : sameEventProduct(prior, record);
  };
  let candidates = current.filter(matchesPrior);
  if (!candidates.length) {
    candidates = prior.recall_number.trim()
      ? [await fetchRecallByNumber(endpoint, prior.recall_number.trim())]
      : (await fetchRecallEvent(endpoint, prior.event_id)).filter(matchesPrior);
  }
  if (candidates.length > 1) throw new Error(`FDA unnumbered report ${tracked.sourceId} ambiguously matches multiple recalls`);
  if (candidates.length === 1) return candidates[0];

  // An unclassified report can disappear before FDA assigns a recall number.
  // Absence is not a closure: retain its evidence and keep matching it, while
  // continuing to import the complete, validated current feed.
  const retained = parseEnforcementRecord(prior, endpoint);
  retained.consumerAdvice += " This earlier report is no longer returned by openFDA. Its current status is unverified; it remains listed until FDA confirms a closure.";
  return retained;
}

async function resolvePreviouslyActive(endpoint: EnforcementEndpoint, existingSourceIds: string[], current: NormalisedIncident[], trackedNotices: TrackedSourceNotice[]): Promise<NormalisedIncident[]> {
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
  const lookedUp: NormalisedIncident[] = [];
  const trackedById = new Map(trackedNotices.map(notice => [notice.sourceId, notice]));
  const trackedIds = new Set(existingSourceIds);
  for (const sourceId of missingIds) {
    if (sourceId.startsWith("unclassified-")) {
      const tracked = trackedById.get(sourceId);
      if (tracked) {
        const matched = await reconcileUnnumbered(endpoint, tracked, current);
        // Keep the existing warning URL and database identity even after FDA
        // changes its report date or assigns an official recall number.
        const incident = { ...matched, sourceId, slug: tracked.slug };
        const position = current.indexOf(matched);
        if (position >= 0 && !trackedIds.has(matched.sourceId)) current[position] = incident;
        // Older imports can already contain both a numbered report and one
        // or more synthetic aliases. Refresh each existing link from the same
        // verified report without creating another numbered copy.
        else lookedUp.push(incident);
        continue;
      }
      const matches = [...(legacyAliases.get(sourceId) ?? [])];
      if (matches.length === 1 && matches[0].status === "active") continue;
      if (matches.length > 1) {
        throw new Error(`FDA legacy source ID ${sourceId} ambiguously matches multiple ongoing recalls`);
      }
      throw new Error("FDA cannot safely status-check a previously active recall without its official recall number");
    }
    lookupIds.push(sourceId);
  }

  for (let index = 0; index < lookupIds.length; index += DETAIL_CONCURRENCY) {
    const group = lookupIds.slice(index, index + DETAIL_CONCURRENCY);
    const results = await Promise.allSettled(group.map((recallNumber) => fetchRecallByNumber(endpoint, recallNumber)));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) {
      const reason = failures[0].reason;
      throw new Error(`FDA status lookup failed for ${failures.length} of ${group.length} previously active recalls: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    lookedUp.push(...results.map((result) => (result as PromiseFulfilledResult<NormalisedIncident>).value));
  }
  return lookedUp;
}

async function fetchEnforcementIncidents(endpoint: EnforcementEndpoint, existingSourceIds: string[], trackedNotices: TrackedSourceNotice[]): Promise<NormalisedIncident[]> {
  const ongoing = await fetchAllWithStatus(endpoint, "Ongoing");
  const statusChecks = await resolvePreviouslyActive(endpoint, existingSourceIds, ongoing, trackedNotices);
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
}

const foodEndpoint: EnforcementEndpoint = {
  api: FDA_API,
  label: "FDA openFDA",
  consumerAdvice: "Do not consume an affected product. Follow the firm's instructions and the latest FDA enforcement report.",
};

const openFdaFieldsSchema = z.object({
  brand_name: z.array(z.string()).optional().default([]),
  upc: z.array(z.string()).optional().default([]),
}).passthrough();

// openFDA adds harmonised brand names and package barcodes to drug reports
// when it can link them to a listed product.
function drugTargets(record: z.infer<typeof recordSchema>): NormalisedTarget[] {
  const parsed = openFdaFieldsSchema.safeParse(record.openfda ?? {});
  if (!parsed.success) return [];
  const brands = [...new Set(parsed.data.brand_name.map((brand) => brand.trim()).filter(Boolean))];
  const gtins = [...new Set(parsed.data.upc.map((upc) => upc.replace(/\D/g, "")).filter(isValidGtin))];
  return [
    ...brands.map((value): NormalisedTarget => ({ type: "brand", value, groupId: "record-product", weight: 28, confidence: 0.9 })),
    ...gtins.map((value, index): NormalisedTarget => ({ type: "gtin", value, groupId: `openfda-upc-${index}`, weight: 70, confidence: 0.9 })),
  ];
}

const drugEndpoint: EnforcementEndpoint = {
  api: FDA_DRUG_API,
  label: "FDA openFDA drugs",
  // FDA freezes drug-enforcement status after publication. This is evidence
  // of a published recall, not evidence that the recall is still ongoing.
  historicalReports: true,
  consumerAdvice: "Check the lot number on your pack against this recall and follow the firm's instructions. Do not stop taking a prescribed medicine without talking to a pharmacist or doctor first.",
  extraTargets: drugTargets,
};

export const fdaSource: IncidentSource = {
  id: "fda",
  name: "U.S. Food and Drug Administration",
  url: FDA_API,
  region: "US",
  superCategory: "Food",
  scope: "All openFDA Food Enforcement Reports with status Ongoing, plus status checks for previously active recalls. Missing unnumbered reports remain active with an unverified-current-status notice until FDA confirms a closure.",
  fetchIncidents: (existingSourceIds = [], trackedNotices = []) => fetchEnforcementIncidents(foodEndpoint, existingSourceIds, trackedNotices),
};

export const fdaDrugSource: IncidentSource = {
  id: "fda-drugs",
  name: "FDA drug recalls",
  url: FDA_DRUG_API,
  region: "US",
  superCategory: "Medical",
  scope: "Published openFDA Drug Enforcement Reports marked Ongoing at publication. Current recall status is unverified because FDA does not update this field after publication.",
  fetchIncidents: () => fetchAllWithStatus(drugEndpoint, "Ongoing"),
};
