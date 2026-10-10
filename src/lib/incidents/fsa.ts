import { z } from "zod";

import { parseDateBounds } from "@/lib/incidents/date-bounds";
import { fetchOfficialJson } from "@/lib/incidents/official-source-http";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";

const FSA_API = "https://data.food.gov.uk/food-alerts/id";
const FSA_PAGE_SIZE = 100;
const DETAIL_CONCURRENCY = 5;
const MAX_LIST_PAGES = 100;
const LISTING_SNAPSHOT_ATTEMPTS = 3;

const listPageSchema = z.object({
  meta: z.object({ limit: z.number().optional(), offset: z.number().optional() }).passthrough().optional(),
  items: z.array(z.object({ notation: z.string().trim().min(1) }).passthrough()),
}).passthrough();

const looseRecord = z.record(z.string(), z.unknown());

class InconsistentFsaListingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconsistentFsaListingError";
  }
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && Boolean(item.trim()))?.trim() ?? null;
  return null;
}

function linkedLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return stringValue(record.label) ?? stringValue(record.notation);
}

function requiredDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`FSA alert has an invalid ${field}: ${value}`);
  return date;
}

function extractGtins(productCode: string): string[] {
  const values = new Set<string>();
  for (const match of productCode.matchAll(/(?<!\d)(?:\d[\s-]*){8,14}(?!\d)/g)) {
    const value = match[0].replace(/\D/g, "");
    if (isValidGtin(value)) values.add(value);
  }
  return [...values];
}

function exactBatchCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim();
  if (code.length > 40 || !/^[a-z0-9]+(?:[ ./_-][a-z0-9]+){0,5}$/i.test(code)) return null;
  if (/^(?:all|all batches|all lots|various|see|not applicable|n\/a)$/i.test(code)) return null;
  if (!/\d/.test(code) && code.length > 8) return null;
  return code;
}

function detailToIncident(data: Record<string, unknown>): NormalisedIncident | null {
  const notation = stringValue(data.notation);
  const title = stringValue(data.title);
  const created = stringValue(data.created);
  if (!notation || !title || !created) return null;

  const modified = stringValue(data.modified) ?? created;
  const reportingBusiness = looseRecord.safeParse(data.reportingBusiness);
  const producer = reportingBusiness.success ? stringValue(reportingBusiness.data.commonName) : null;
  const problems = Array.isArray(data.problem)
    ? data.problem.filter((item) => looseRecord.safeParse(item).success) as Record<string, unknown>[]
    : [];
  const riskStatement = problems.map((problem) => stringValue(problem.riskStatement)).find(Boolean) ?? "See the official alert for details.";
  const pathogenRisk = problems.map((problem) => problem.pathogenRisk).find(Boolean);
  const pathogenRiskRecord = looseRecord.safeParse(pathogenRisk);
  const pathogenRecord = pathogenRiskRecord.success ? looseRecord.safeParse(pathogenRiskRecord.data.pathogen) : null;
  const pathogen = pathogenRecord?.success ? linkedLabel(pathogenRecord.data) : null;
  const productDetails = Array.isArray(data.productDetails)
    ? data.productDetails.filter((item): item is Record<string, unknown> => looseRecord.safeParse(item).success)
    : [];
  const targets: NormalisedTarget[] = [];

  productDetails.forEach((product, productIndex) => {
    const productName = stringValue(product.productName);
    const productCode = stringValue(product.productCode);
    const gtins = productCode ? extractGtins(productCode) : [];
    const batches = Array.isArray(product.batchDescription)
      ? product.batchDescription.filter((item): item is Record<string, unknown> => looseRecord.safeParse(item).success)
      : [];
    const batchRows = batches.length ? batches : [null];

    batchRows.forEach((batch, batchIndex) => {
      const groupId = `product-${productIndex}-batch-${batchIndex}`;
      const batchCode = exactBatchCode(batch ? stringValue(batch.batchCode) : null);
      const dateNote = batch
        ? stringValue(batch.useByDescription) ?? stringValue(batch.bestBeforeDescription)
        : null;
      const dateBounds = dateNote ? parseDateBounds(dateNote, true) : null;
      const affectedDateNote = dateNote ? `Affected date information: ${dateNote}` : null;

      if (producer) targets.push({ type: "producer", value: producer, groupId, weight: 45, confidence: 0.95 });
      if (productName) {
        targets.push({
          type: "product",
          value: productName,
          groupId,
          ...(dateBounds ?? {}),
          notes: affectedDateNote,
          weight: 38,
          confidence: 1,
        });
      }
      for (const gtin of gtins) {
        targets.push({ type: "gtin", value: gtin, groupId, notes: affectedDateNote, ...(dateBounds ?? {}), weight: 75, confidence: 1 });
      }
      if (batchCode) {
        targets.push({
          type: "batch",
          value: batchCode,
          groupId,
          notes: affectedDateNote,
          ...(dateBounds ?? {}),
          weight: 62,
          confidence: 1,
        });
      } else if (productCode && gtins.length === 0) {
        const productTarget = targets.findLast((target) => target.type === "product" && target.groupId === groupId);
        if (productTarget) productTarget.notes = [productTarget.notes, `Source product code: ${productCode}`].filter(Boolean).join(". ");
      }
    });
  });

  const alertUrlValue = looseRecord.safeParse(data.alertURL);
  const authorityUrl =
    stringValue(data.alertURL) ??
    (alertUrlValue.success ? stringValue(alertUrlValue.data["@id"]) : null) ??
    `https://www.food.gov.uk/news-alerts/alert/${notation}`;
  const publishedAt = requiredDate(created, "created date");
  const updatedAt = requiredDate(modified, "modified date");
  const description = stringValue(data.description) ?? title;
  const consumerAdvice = stringValue(data.consumerAdvice) ?? stringValue(data.actionTaken) ?? "Follow the advice in the official alert.";
  const sourceStatus = linkedLabel(data.status)?.toLowerCase();

  return {
    title,
    slug: slugify(notation),
    region: "UK",
    status: sourceStatus === "withdrawn" ? "resolved" : "active",
    hazard: pathogenRiskRecord.success ? linkedLabel(pathogenRiskRecord.data) ?? riskStatement.slice(0, 200) : riskStatement.slice(0, 200),
    pathogen,
    summary: description,
    consumerAdvice,
    authority: "Food Standards Agency",
    authorityUrl,
    sourceId: notation,
    publishedAt,
    updatedAt,
    startsAt: publishedAt,
    endsAt: null,
    severity: pathogen ? "high" : "medium",
    confidence: 1,
    originalSourceData: data,
    targets,
  };
}

async function fetchListPage(offset: number): Promise<z.infer<typeof listPageSchema>> {
  const url = new URL(FSA_API);
  url.searchParams.set("_sort", "-modified");
  url.searchParams.set("_limit", String(FSA_PAGE_SIZE));
  url.searchParams.set("_offset", String(offset));
  const parsed = listPageSchema.safeParse(await fetchOfficialJson(url.toString(), {
    sourceName: "FSA",
    headers: { Accept: "application/json" },
    timeoutMs: 15_000,
  }));
  if (!parsed.success) throw new Error(`FSA list page at offset ${offset} had an invalid response: ${parsed.error.message}`);
  if (parsed.data.meta?.offset !== undefined && parsed.data.meta.offset !== offset) {
    throw new Error(`FSA list page offset mismatch: requested ${offset}, received ${parsed.data.meta.offset}`);
  }
  if (parsed.data.meta?.limit !== undefined && parsed.data.meta.limit !== FSA_PAGE_SIZE) {
    throw new Error(`FSA list page limit mismatch: requested ${FSA_PAGE_SIZE}, received ${parsed.data.meta.limit}`);
  }
  if (parsed.data.items.length > FSA_PAGE_SIZE) throw new Error(`FSA returned more than ${FSA_PAGE_SIZE} alerts in one page`);
  return parsed.data;
}

async function fetchNotationScan(): Promise<string[]> {
  const notations: string[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const response = await fetchListPage(offset);
    for (const { notation } of response.items) {
      if (seen.has(notation)) throw new InconsistentFsaListingError(`FSA pagination repeated alert ${notation}`);
      seen.add(notation);
      notations.push(notation);
    }
    if (response.items.length < FSA_PAGE_SIZE) return notations;
    offset += response.items.length;
  }

  throw new InconsistentFsaListingError(`FSA listing did not reach a terminal page within ${MAX_LIST_PAGES} pages`);
}

async function fetchAllNotations(): Promise<string[]> {
  let lastError: InconsistentFsaListingError | null = null;
  for (let attempt = 1; attempt <= LISTING_SNAPSHOT_ATTEMPTS; attempt += 1) {
    try {
      const first = await fetchNotationScan();
      const second = await fetchNotationScan();
      if (JSON.stringify(first) === JSON.stringify(second)) return first;
      lastError = new InconsistentFsaListingError("FSA alert list changed between complete pagination scans");
    } catch (error) {
      if (!(error instanceof InconsistentFsaListingError)) throw error;
      lastError = error;
    }
    if (attempt < LISTING_SNAPSHOT_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }

  throw new Error(
    `FSA listing remained inconsistent after ${LISTING_SNAPSHOT_ATTEMPTS} attempts: ${lastError?.message ?? "unknown pagination error"}`,
    { cause: lastError },
  );
}

async function fetchIncident(notation: string): Promise<NormalisedIncident> {
  const url = `${FSA_API}/${encodeURIComponent(notation)}`;
  const payload = await fetchOfficialJson(url, {
    sourceName: "FSA",
    headers: { Accept: "application/json" },
    timeoutMs: 15_000,
  });
  const parsed = z.object({ items: z.array(looseRecord).length(1) }).safeParse(payload);
  if (!parsed.success) throw new Error(`FSA detail ${notation} had an invalid response: ${parsed.error.message}`);
  return parseFsaDetail(parsed.data.items[0]);
}

export function parseFsaDetail(data: Record<string, unknown>): NormalisedIncident {
  const incident = detailToIncident(data);
  if (!incident) throw new Error("FSA detail is missing required incident fields");
  return incident;
}

export const fsaSource: IncidentSource = {
  id: "fsa",
  name: "Food Standards Agency",
  url: "https://data.food.gov.uk/food-alerts/",
  region: "UK",
  superCategory: "Food",
  scope: "All records returned by the FSA Food Alerts API, including allergy alerts and product recall information notices.",
  async fetchIncidents() {
    const notations = await fetchAllNotations();

    const incidents: NormalisedIncident[] = [];
    for (let index = 0; index < notations.length; index += DETAIL_CONCURRENCY) {
      const group = notations.slice(index, index + DETAIL_CONCURRENCY);
      const details = await Promise.allSettled(group.map(fetchIncident));
      const failures = details.filter((detail): detail is PromiseRejectedResult => detail.status === "rejected");
      if (failures.length) {
        const reason = failures[0].reason;
        throw new Error(`FSA detail import failed for ${failures.length} of ${group.length} alerts: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
      incidents.push(...details.map((detail) => (detail as PromiseFulfilledResult<NormalisedIncident>).value));
    }

    if (incidents.length !== notations.length) {
      throw new Error(`FSA returned ${incidents.length} incidents for ${notations.length} listed alerts`);
    }
    return incidents;
  },
};
