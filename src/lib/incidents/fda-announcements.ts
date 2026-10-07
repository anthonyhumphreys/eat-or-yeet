import { z } from "zod";

import { parseDateBounds } from "@/lib/incidents/date-bounds";
import { fetchOfficialJson, fetchOfficialText } from "@/lib/incidents/official-source-http";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";
import { sourceHtmlParagraphs, sourceHtmlToText } from "@/lib/incidents/source-text";

const FDA_ORIGIN = "https://www.fda.gov";
const INDEX_PATH = "/safety/recalls-market-withdrawals-safety-alerts";
const FOOD_PRODUCT_TYPE = "2323";
const INITIAL_LISTING_LIMIT = 1_000;
const MAX_LISTING_ROWS = 5_000;
const LISTING_ATTEMPTS = 3;
const DETAIL_CONCURRENCY = 8;
const FDA_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${FDA_ORIGIN}${INDEX_PATH}`,
  "User-Agent": "Mozilla/5.0 (compatible; EatOrYeet/1.0; +https://eat-or-yeet.vercel.app)",
};

const rowsSchema = z.object({ data: z.array(z.array(z.string()).min(8)) });
const tablePageSchema = z.object({
  draw: z.number(),
  recordsTotal: z.number().int().nonnegative(),
  recordsFiltered: z.number().int().nonnegative(),
  data: z.array(z.array(z.string()).min(8)),
});

type AnnouncementListing = {
  path: string;
  publishedAt: Date;
  brand: string;
  product: string;
  productType: string;
  reason: string;
  company: string;
  terminationStatus: string;
  terminated: boolean;
};

function linkFromHtml(value: string): { path: string; label: string } | null {
  const match = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(value);
  return match ? { path: match[1], label: sourceHtmlToText(match[2]) } : null;
}

function parseAnnouncementRows(input: unknown): AnnouncementListing[] {
  const parsed = rowsSchema.parse(input);
  return parsed.data.flatMap((row) => {
    const productType = sourceHtmlToText(row[3]);
    if (!productType.includes("Food & Beverages")) return [];

    const link = linkFromHtml(row[1]);
    const dateValue = /datetime="([^"]+)"/i.exec(row[0])?.[1];
    const publishedAt = dateValue ? new Date(dateValue) : new Date(Number.NaN);
    if (!link || Number.isNaN(publishedAt.getTime())) {
      throw new Error("FDA announcements listing contained a food row without a valid link or date");
    }
    const pageUrl = new URL(link.path, FDA_ORIGIN);
    if (pageUrl.origin !== FDA_ORIGIN) throw new Error(`FDA announcements listing contained an external detail link: ${link.path}`);

    const terminationStatus = sourceHtmlToText(row[6]);
    return [{
      path: pageUrl.pathname,
      publishedAt,
      brand: link.label,
      product: sourceHtmlToText(row[2]),
      productType,
      reason: sourceHtmlToText(row[4]),
      company: sourceHtmlToText(row[5]),
      terminationStatus,
      terminated: /\bterminated\b/i.test(terminationStatus),
    }];
  });
}

export function parseFdaAnnouncementRows(input: unknown): AnnouncementListing[] {
  return parseAnnouncementRows(input);
}

function announcementText(html: string): { body: string; paragraphs: string[] } {
  const section = /<h2\b[^>]*id="recall-announcement"[^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|<section\b|<div\s+class="field\s+field--name-field-contact|$)/i.exec(html)?.[1];
  if (!section) throw new Error("FDA announcement detail page did not include the recall announcement section");
  const paragraphs = sourceHtmlParagraphs(section);
  const listItems = [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => sourceHtmlToText(match[1]))
    .filter(Boolean);
  const blocks = [...paragraphs, ...listItems];
  if (!blocks.length) throw new Error("FDA announcement detail page had no recall text");
  return { body: sourceHtmlToText(section), paragraphs: blocks };
}

function extractGtins(text: string): string[] {
  const values = new Set<string>();
  const contexts = text.matchAll(/\b(?:UPC|GTIN|bar\s*codes?|barcode)\b[\s#:]*(.{0,240})/gi);
  for (const context of contexts) {
    for (const match of context[1].matchAll(/(?<!\d)(?:\d[\s-]*){8,14}(?!\d)/g)) {
      const digits = match[0].replace(/\D/g, "");
      if (isValidGtin(digits)) values.add(digits);
    }
  }
  return [...values];
}

function extractLots(text: string): string[] {
  const values = new Set<string>();
  const ignored = new Set(["AND", "NO", "NOS", "NUMBER", "NUMBERS"]);
  for (const context of text.matchAll(/\b(?:lots?|batches?)(?:\s+(?:numbers?|nos?\.?))?\s*#?\s*:?\s*([^.;]{1,180})/gi)) {
    for (const match of context[1].matchAll(/\b[A-Z0-9][A-Z0-9./-]{1,30}\b/gi)) {
      const value = match[0].toUpperCase();
      if (/\d/.test(value) && !ignored.has(value)) values.add(value);
    }
  }
  return [...values];
}

function pathogenFrom(reason: string): string | null {
  const names = ["Salmonella", "Listeria monocytogenes", "E. coli", "Clostridium botulinum", "Hepatitis A"];
  return names.find((name) => reason.toLowerCase().includes(name.toLowerCase())) ?? null;
}

function consumerAdvice(paragraphs: string[]): string {
  const advice = paragraphs.filter((paragraph) => /\bconsumers?\b/i.test(paragraph) && /\b(?:should|do not|dispose|return|avoid|stop|throw away)\b/i.test(paragraph));
  return advice.slice(0, 2).join(" ").slice(0, 1_500) || "Check the official FDA announcement and follow its consumer instructions.";
}

function singleProduct(listing: AnnouncementListing): boolean {
  return !/[,;]|\band\b|&/i.test(listing.product);
}

function singleBrand(listing: AnnouncementListing): boolean {
  return !/[,;]|\band\b|&/i.test(listing.brand);
}

function listingTargets(listing: AnnouncementListing): NormalisedTarget[] {
  const isSingleProduct = singleProduct(listing);
  return [
    {
      type: "product",
      value: listing.product,
      groupId: isSingleProduct ? "announcement-product" : undefined,
      weight: isSingleProduct ? 38 : 25,
      confidence: isSingleProduct ? 0.9 : 0.55,
      notes: isSingleProduct ? null : "Affected product information: this FDA announcement lists multiple products.",
    },
    {
      type: "producer",
      value: listing.company,
      groupId: isSingleProduct ? "announcement-product" : undefined,
      weight: 45,
      confidence: 1,
    },
    ...listing.brand.split(/[,;]/).map((brand) => brand.trim()).filter(Boolean).map((brand) => ({
      type: "brand" as const,
      value: brand,
      groupId: isSingleProduct && singleBrand(listing) ? "announcement-product" : undefined,
      weight: 28,
      confidence: singleBrand(listing) ? 0.9 : 0.6,
    })),
  ];
}

function detailCodeTargets(listing: AnnouncementListing, paragraphs: string[]): NormalisedTarget[] {
  const targets: NormalisedTarget[] = [];
  const isSingleProduct = singleProduct(listing);
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const gtins = extractGtins(paragraph);
    const lots = extractLots(paragraph);
    const identifierCount = gtins.length + lots.length;
    const dateBounds = parseDateBounds(paragraph, false);
    const hasDateRestriction = /\b(?:best\s*before|best\s*by|use\s*by|expiration|expiry|exp\.?|sell\s*by|production\s*date|packed\s*on|date\s+code)\b/i.test(paragraph);
    const dateNotes = hasDateRestriction ? `Affected date information: ${paragraph.slice(0, 500)}` : null;

    const addIdentifier = (type: "gtin" | "lot", value: string, identifierIndex: number) => {
      const groupId = `detail-${paragraphIndex}-${type}-${identifierIndex}`;
      const canAssociateDate = identifierCount === 1 ? dateBounds : null;
      if (isSingleProduct) {
        targets.push({
          type: "product",
          value: listing.product,
          groupId,
          ...(canAssociateDate ?? {}),
          notes: dateNotes,
          weight: 38,
          confidence: 0.9,
        });
        targets.push({ type: "producer", value: listing.company, groupId, weight: 45, confidence: 1 });
        if (singleBrand(listing)) {
          targets.push({ type: "brand", value: listing.brand, groupId, weight: 28, confidence: 0.9 });
        }
      }
      targets.push({
        type,
        value,
        groupId,
        ...(type === "lot" && canAssociateDate ? canAssociateDate : {}),
        notes: dateNotes,
        weight: type === "gtin" ? 75 : 62,
        confidence: type === "gtin" ? 0.95 : 0.8,
      });
    };

    gtins.forEach((gtin, index) => addIdentifier("gtin", gtin, index));
    lots.forEach((lot, index) => addIdentifier("lot", lot, index));

    if (!identifierCount && hasDateRestriction && isSingleProduct) {
      targets.push({
        type: "product",
        value: listing.product,
        groupId: `detail-${paragraphIndex}-date`,
        ...(dateBounds ?? {}),
        notes: dateNotes,
        weight: 32,
        confidence: 0.75,
      });
    }
  });
  return targets;
}

export function parseFdaAnnouncementDetail(listing: AnnouncementListing, html: string): NormalisedIncident {
  const announcement = announcementText(html);
  const productTargets = listingTargets(listing);
  const pathogen = pathogenFrom(listing.reason);
  const pathSlug = listing.path.split("/").filter(Boolean).at(-1) ?? `${listing.company}-${listing.product}`;

  return {
    title: `${listing.company} recall: ${listing.product}`,
    slug: slugify(`fda-announcement-${pathSlug}`),
    region: "US",
    status: listing.terminated ? "resolved" : "active",
    hazard: listing.reason,
    pathogen,
    summary: (announcement.paragraphs[0] || `${listing.brand} ${listing.product}. ${listing.reason}`).slice(0, 1_500),
    consumerAdvice: consumerAdvice(announcement.paragraphs),
    authority: "U.S. Food and Drug Administration",
    authorityUrl: new URL(listing.path, FDA_ORIGIN).toString(),
    sourceId: `announcement:${listing.path}`,
    publishedAt: listing.publishedAt,
    updatedAt: listing.publishedAt,
    startsAt: listing.publishedAt,
    endsAt: null,
    severity: pathogen || /undeclared|allergen/i.test(listing.reason) ? "high" : "medium",
    confidence: 1,
    originalSourceData: {
      brand: listing.brand,
      company: listing.company,
      product: listing.product,
      productType: listing.productType,
      reason: listing.reason,
      terminationStatus: listing.terminationStatus,
      terminated: listing.terminated,
      announcementParagraphs: announcement.paragraphs,
    },
    targets: [...productTargets, ...detailCodeTargets(listing, announcement.paragraphs)],
  };
}

function dataTableRequest(indexHtml: string, draw: number, length: number): URL {
  const settingsText = /<script\s+type="application\/json"\s+data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/i.exec(indexHtml)?.[1];
  if (!settingsText) throw new Error("FDA announcements page did not include its data configuration");
  const settings = z.object({ datatables: z.record(z.string(), z.unknown()) }).parse(JSON.parse(settingsText));
  const config = Object.values(settings.datatables).find((value) => {
    const item = value as { ajax?: { data?: { view_name?: string } } };
    return item.ajax?.data?.view_name === "recall_solr_index";
  }) as { ajax?: { data?: Record<string, string | number> } } | undefined;
  if (!config?.ajax?.data) throw new Error("FDA announcements data configuration was not recognised");

  const url = new URL("/datatables/views/ajax", FDA_ORIGIN);
  for (const [key, value] of Object.entries(config.ajax.data)) url.searchParams.set(key, String(value));
  url.searchParams.set("field_regulated_product_field", FOOD_PRODUCT_TYPE);
  url.searchParams.set("draw", String(draw));
  url.searchParams.set("start", "0");
  url.searchParams.set("length", String(length));
  return url;
}

async function fetchListings(): Promise<AnnouncementListing[]> {
  const indexHtml = await fetchOfficialText(new URL(INDEX_PATH, FDA_ORIGIN).toString(), {
    sourceName: "FDA announcements",
    headers: FDA_HEADERS,
    timeoutMs: 20_000,
    cache: "no-store",
  });
  let requestedLimit = INITIAL_LISTING_LIMIT;
  let lastError = "response row count did not match its reported total";
  for (let attempt = 1; attempt <= LISTING_ATTEMPTS; attempt += 1) {
    const payload = await fetchOfficialJson(dataTableRequest(indexHtml, attempt, requestedLimit).toString(), {
      sourceName: "FDA announcements data",
      headers: FDA_HEADERS,
      timeoutMs: 20_000,
      cache: "no-store",
    });
    const parsed = tablePageSchema.safeParse(payload);
    if (!parsed.success) throw new Error(`FDA announcements full listing response was invalid: ${parsed.error.message}`);
    if (parsed.data.draw !== attempt) throw new Error(`FDA announcements full listing response had the wrong draw number on attempt ${attempt}`);

    const { data, recordsFiltered, recordsTotal } = parsed.data;
    const reportedRows = Math.max(recordsFiltered, recordsTotal);
    if (reportedRows > MAX_LISTING_ROWS || data.length > MAX_LISTING_ROWS) {
      throw new Error(`FDA announcements listing exceeded the ${MAX_LISTING_ROWS}-row safety limit`);
    }
    if (reportedRows > requestedLimit) {
      requestedLimit = reportedRows;
      lastError = `reported ${reportedRows} rows beyond the requested limit; retrying with the reported total`;
      continue;
    }

    if (data.length === recordsFiltered && recordsFiltered === recordsTotal) {
      const listings = parseAnnouncementRows({ data });
      if (listings.length !== recordsFiltered) {
        throw new Error(`FDA announcements returned ${listings.length} food rows for ${recordsFiltered} reported rows`);
      }
      const paths = new Set<string>();
      for (const listing of listings) {
        if (paths.has(listing.path)) throw new Error(`FDA announcements full listing repeated ${listing.path}`);
        paths.add(listing.path);
      }
      return listings;
    }

    lastError = `received ${data.length} rows, recordsFiltered=${recordsFiltered}, recordsTotal=${recordsTotal}, requested limit=${requestedLimit}`;
  }

  throw new Error(`FDA announcements full listing remained incomplete after ${LISTING_ATTEMPTS} attempts: ${lastError}`);
}

async function fetchDetail(listing: AnnouncementListing): Promise<NormalisedIncident> {
  const url = new URL(listing.path, FDA_ORIGIN).toString();
  const html = await fetchOfficialText(url, {
    sourceName: "FDA announcement detail",
    headers: FDA_HEADERS,
    timeoutMs: 20_000,
    cache: "no-store",
  });
  return parseFdaAnnouncementDetail(listing, html);
}

export const fdaAnnouncementsSource: IncidentSource = {
  id: "fda-announcements",
  name: "FDA recall announcements",
  url: new URL(INDEX_PATH, FDA_ORIGIN).toString(),
  region: "US",
  scope: "Food and beverage notices on FDA Recalls, Market Withdrawals & Safety Alerts current listing (three-year page window; announcement subset, not all FDA recalls).",
  async fetchIncidents() {
    const listings = await fetchListings();
    const results: NormalisedIncident[] = [];
    for (let index = 0; index < listings.length; index += DETAIL_CONCURRENCY) {
      const group = listings.slice(index, index + DETAIL_CONCURRENCY);
      const details = await Promise.allSettled(group.map(fetchDetail));
      const failures = details.filter((detail): detail is PromiseRejectedResult => detail.status === "rejected");
      if (failures.length) {
        const reason = failures[0].reason;
        throw new Error(`FDA announcement detail import failed for ${failures.length} of ${group.length} pages: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
      results.push(...details.map((detail) => (detail as PromiseFulfilledResult<NormalisedIncident>).value));
    }

    if (results.length !== listings.length) {
      throw new Error(`FDA announcement import returned ${results.length} of ${listings.length} detail pages`);
    }
    return results;
  },
};
