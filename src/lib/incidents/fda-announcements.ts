import { z } from "zod";

import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";

const FDA_ORIGIN = "https://www.fda.gov";
const INDEX_PATH = "/safety/recalls-market-withdrawals-safety-alerts";
const FOOD_PRODUCT_TYPE = "2323";
const PAGE_SIZE = 50;
const FDA_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${FDA_ORIGIN}${INDEX_PATH}`,
  "User-Agent": "Mozilla/5.0 (compatible; EatOrYeet/1.0; +https://eat-or-yeet.vercel.app)",
};

const dataTableSchema = z.object({
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
  terminated: boolean;
};

const htmlEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => htmlEntities[name.toLowerCase()] ?? entity);
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function linkFromHtml(value: string): { path: string; label: string } | null {
  const match = /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(value);
  return match ? { path: decodeHtml(match[1]), label: textFromHtml(match[2]) } : null;
}

export function parseFdaAnnouncementRows(input: unknown): AnnouncementListing[] {
  const parsed = dataTableSchema.parse(input);
  return parsed.data.flatMap((row) => {
    const link = linkFromHtml(row[1]);
    const dateValue = /datetime="([^"]+)"/i.exec(row[0])?.[1];
    const publishedAt = dateValue ? new Date(dateValue) : new Date(Number.NaN);
    const productType = textFromHtml(row[3]);
    if (!link || Number.isNaN(publishedAt.getTime()) || !productType.includes("Food & Beverages")) return [];
    return [{
      path: link.path,
      publishedAt,
      brand: link.label,
      product: textFromHtml(row[2]),
      productType,
      reason: textFromHtml(row[4]),
      company: textFromHtml(row[5]),
      terminated: Boolean(textFromHtml(row[6])),
    }];
  });
}

function announcementText(html: string): { body: string; paragraphs: string[] } {
  const section = /<h2[^>]*id="recall-announcement"[^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|<section\b|<div\s+class="field\s+field--name-field-contact)/i.exec(html)?.[1] ?? "";
  const paragraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
  return { body: paragraphs.join(" "), paragraphs };
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
  const advice = paragraphs.filter((paragraph) => /\bconsumers?\b/i.test(paragraph) && /\b(?:should|do not|dispose|return|avoid|stop)\b/i.test(paragraph));
  return advice.slice(0, 2).join(" ").slice(0, 1_500) || "Check the official FDA announcement and follow its consumer instructions.";
}

export function parseFdaAnnouncementDetail(listing: AnnouncementListing, html: string): NormalisedIncident {
  const announcement = announcementText(html);
  const fullText = textFromHtml(html);
  const gtins = extractGtins(fullText);
  const lots = extractLots(announcement.body);
  const targets: NormalisedTarget[] = [
    { type: "product", value: listing.product, weight: 38, confidence: 1 },
    { type: "producer", value: listing.company, weight: 45, confidence: 1 },
    ...listing.brand.split(/[,;]/).map((brand) => brand.trim()).filter(Boolean).map((brand) => ({ type: "brand" as const, value: brand, weight: 28, confidence: 1 })),
    ...gtins.map((gtin) => ({ type: "gtin" as const, value: gtin, weight: 75, confidence: 1 })),
    ...lots.map((lot) => ({ type: "lot" as const, value: lot, weight: 62, confidence: 1 })),
  ];
  const pathogen = pathogenFrom(listing.reason);
  const endsAt = new Date(listing.publishedAt);
  endsAt.setUTCDate(endsAt.getUTCDate() + 180);
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
    endsAt,
    severity: pathogen || /undeclared|allergen/i.test(listing.reason) ? "high" : "medium",
    confidence: 1,
    originalSourceData: {
      brand: listing.brand,
      company: listing.company,
      product: listing.product,
      productType: listing.productType,
      reason: listing.reason,
      terminated: listing.terminated,
      gtins,
      lots,
    },
    targets,
  };
}

async function fetchText(url: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers: FDA_HEADERS, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (response.ok) return response.text();
    lastStatus = response.status;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(`FDA announcements returned HTTP ${lastStatus} for ${url}`);
}

function dataTableRequest(indexHtml: string): URL {
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
  url.searchParams.set("draw", "1");
  url.searchParams.set("start", "0");
  url.searchParams.set("length", String(PAGE_SIZE));
  return url;
}

async function fetchListings(): Promise<AnnouncementListing[]> {
  const indexHtml = await fetchText(new URL(INDEX_PATH, FDA_ORIGIN).toString());
  const response = await fetch(dataTableRequest(indexHtml), {
    headers: FDA_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`FDA announcements data returned HTTP ${response.status}`);
  return parseFdaAnnouncementRows(await response.json());
}

export const fdaAnnouncementsSource: IncidentSource = {
  id: "fda-announcements",
  name: "FDA recall announcements",
  url: new URL(INDEX_PATH, FDA_ORIGIN).toString(),
  async fetchIncidents() {
    const listings = await fetchListings();
    const results: NormalisedIncident[] = [];
    const failures: string[] = [];
    for (let index = 0; index < listings.length; index += 2) {
      const group = listings.slice(index, index + 2);
      const details = await Promise.allSettled(group.map((listing) => fetchText(new URL(listing.path, FDA_ORIGIN).toString())));
      details.forEach((detail, itemIndex) => {
        if (detail.status === "fulfilled") results.push(parseFdaAnnouncementDetail(group[itemIndex], detail.value));
        else failures.push(detail.reason instanceof Error ? detail.reason.message : String(detail.reason));
      });
    }
    if (!results.length && failures.length) throw new Error(failures[0]);
    if (failures.length) console.warn(`FDA announcement importer skipped ${failures.length} page(s): ${failures.join(" | ")}`);
    return results;
  },
};
