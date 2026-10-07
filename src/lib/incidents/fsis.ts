import { z } from "zod";

import { parseDateBounds } from "@/lib/incidents/date-bounds";
import { fetchOfficialJson } from "@/lib/incidents/official-source-http";
import { sourceHtmlParagraphs, sourceHtmlToText } from "@/lib/incidents/source-text";
import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { isValidGtin, slugify } from "@/lib/matching/normalise";

const FSIS_API = "https://www.fsis.usda.gov/fsis/api/recall/v/1";

const recordSchema = z.object({
  field_title: z.string().trim().min(1),
  field_recall_number: z.string(),
  field_recall_number_export: z.string(),
  field_recall_url: z.string().url(),
  field_recall_date: z.string().trim().min(1),
  field_active_notice: z.string(),
  field_last_modified_date: z.string().trim().default(""),
  field_product_items: z.array(z.string()).default([]),
  field_establishment: z.array(z.string()).default([]),
  field_recall_reason: z.array(z.string()).default([]),
  field_summary: z.string(),
  field_risk_level: z.string().default(""),
  field_recall_classification: z.string().default(""),
  field_states: z.array(z.string()).default([]),
  langcode: z.string().trim().min(1),
}).passthrough();

const recordsSchema = z.array(recordSchema).min(1);

function requiredDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`FSIS record has an invalid ${field}: ${value}`);
  return date;
}

function textValues(values: string[]): string[] {
  return values.map(sourceHtmlToText).filter(Boolean);
}

function productNames(line: string): string[] {
  const values = [...line.matchAll(/[“"]([^”"]{2,200})[”"]/g)]
    .map((match) => match[1].trim().replace(/[.,;]+$/, ""))
    .filter((value) => value && !/^\d+(?:[./-]\d+)*$/.test(value) && !/^(?:lot|batch|case code|item|est\.?\s*(?:no\.?)?)\b/i.test(value));
  return [...new Set(values)];
}

function lotCodes(line: string): string[] {
  const values = new Set<string>();
  const pattern = /\b(?:lot|batch)(?:\s+code)?(?:\s+(?:number|no\.?|numbers|nos?\.?))?\s*#?\s*:?[ \t]*([A-Z0-9][A-Z0-9./-]{2,30}(?:\s+[A-Z0-9][A-Z0-9./-]{1,20}){0,2})/gi;
  for (const match of line.matchAll(pattern)) {
    const value = match[1]
      .replace(/\s+(?:and|with|for|best|use|exp\.?|expiration|date|dates|item|case)\b.*$/i, "")
      .trim()
      .replace(/[,;]+$/, "");
    if (/\d/.test(value)) values.add(value.toUpperCase());
  }
  return [...values];
}

function gtins(line: string): string[] {
  const values = new Set<string>();
  for (const context of line.matchAll(/\b(?:UPC|GTIN|bar\s*codes?|barcode)\b[\s#:]*(.{0,180})/gi)) {
    for (const match of context[1].matchAll(/(?<!\d)(?:\d[\s-]*){8,14}(?!\d)/g)) {
      const value = match[0].replace(/\D/g, "");
      if (isValidGtin(value)) values.add(value);
    }
  }
  return [...values];
}

function establishmentCodes(line: string): string[] {
  const values = new Set<string>();
  for (const match of line.matchAll(/\b(?:EST(?:ABLISHMENT)?\.?\s*(?:NO\.?|NUMBER)?\s*#?\s*)([A-Z0-9-]{2,20})/gi)) {
    if (/\d/.test(match[1])) values.add(match[1].toUpperCase());
  }
  return [...values];
}

function hasDateRestriction(value: string): boolean {
  return /\b(?:best\s*before|best\s*by|use\s*by|expiration|expiry|exp\.?|sell\s*by|production\s*date|packed\s*on|date\s+code|date\s+stamp)\b/i.test(value);
}

function dateNote(value: string): string | null {
  return hasDateRestriction(value) ? `Affected date information: ${value.slice(0, 500)}` : null;
}

function productItemTargets(
  line: string,
  index: number,
  producers: string[],
): NormalisedTarget[] {
  const text = sourceHtmlToText(line);
  const products = productNames(text);
  const oneProduct = products.length === 1;
  const lots = lotCodes(text);
  const productGtins = gtins(text);
  const establishments = establishmentCodes(text);
  const identifierCount = lots.length + productGtins.length + establishments.length;
  const dateBounds = parseDateBounds(text, false);
  const notes = dateNote(text);
  const targets: NormalisedTarget[] = [];

  const addGroup = (
    suffix: string,
    identifier?: { type: "lot" | "gtin" | "establishment"; value: string },
    applyDate: boolean = false,
  ) => {
    const groupId = `product-item-${index}-${suffix}`;
    if (oneProduct) {
      targets.push({
        type: "product",
        value: products[0],
        groupId,
        ...(applyDate && dateBounds ? dateBounds : {}),
        notes,
        weight: 38,
        confidence: 0.9,
      });
      for (const producer of producers) {
        targets.push({ type: "producer", value: producer, groupId, weight: 45, confidence: 0.9 });
      }
    }
    if (identifier) {
      targets.push({
        type: identifier.type,
        value: identifier.value,
        groupId,
        ...(applyDate && dateBounds && identifier.type !== "gtin" ? dateBounds : {}),
        notes,
        weight: identifier.type === "gtin" ? 75 : identifier.type === "establishment" ? 55 : 62,
        confidence: identifier.type === "gtin" ? 0.95 : 0.85,
      });
    }
  };

  const onlyOneIdentifier = identifierCount === 1;
  if (lots.length) lots.forEach((value, lotIndex) => addGroup(`lot-${lotIndex}`, { type: "lot", value }, onlyOneIdentifier));
  if (productGtins.length) productGtins.forEach((value, gtinIndex) => addGroup(`gtin-${gtinIndex}`, { type: "gtin", value }, onlyOneIdentifier));
  if (establishments.length) establishments.forEach((value, establishmentIndex) => addGroup(`establishment-${establishmentIndex}`, { type: "establishment", value }, onlyOneIdentifier));

  if (!identifierCount) {
    if (oneProduct) addGroup("product", undefined, Boolean(dateBounds));
    else if (products.length) {
      for (const product of products) targets.push({
        type: "product",
        value: product,
        groupId: `product-item-${index}`,
        notes: `Affected product information: ${text.slice(0, 500)}${notes ? `. ${notes}` : ""}`,
        weight: 25,
        confidence: 0.55,
      });
    }
  }

  return targets;
}

function pathogenFrom(value: string): string | null {
  const names = ["Salmonella", "Listeria monocytogenes", "Escherichia coli", "E. coli", "Campylobacter", "Clostridium botulinum", "Hepatitis A"];
  return names.find((name) => value.toLowerCase().includes(name.toLowerCase())) ?? null;
}

function statusFromActiveNotice(value: string): "active" | "resolved" {
  return value.trim().toLowerCase() === "false" ? "resolved" : "active";
}

function severityFrom(classification: string): NormalisedIncident["severity"] {
  switch (classification.trim().toLowerCase()) {
    case "class i": return "critical";
    case "class ii": return "high";
    case "class iii": return "medium";
    default: return "medium";
  }
}

function incidentFromRecord(record: z.infer<typeof recordSchema>): NormalisedIncident {
  const recallNumber = record.field_recall_number_export.trim() || record.field_recall_number.trim();
  const recallUrl = new URL(record.field_recall_url);
  if (recallUrl.hostname !== "www.fsis.usda.gov" && recallUrl.hostname !== "fsis.usda.gov") {
    throw new Error(`FSIS record linked outside fsis.usda.gov: ${record.field_recall_url}`);
  }
  recallUrl.protocol = "https:";

  const productItems = textValues(record.field_product_items);
  const establishmentNames = textValues(record.field_establishment);
  const reasons = textValues(record.field_recall_reason);
  const summaryParagraphs = sourceHtmlParagraphs(record.field_summary);
  const summary = summaryParagraphs.join(" ") || sourceHtmlToText(record.field_summary);
  const title = sourceHtmlToText(record.field_title);
  const pathogen = pathogenFrom(`${reasons.join(" ")} ${summary}`);
  const publishedAt = requiredDate(record.field_recall_date, "recall date");
  // The official archive leaves this field blank for older recalls. Retain those
  // records and use the source's recall date as the best available update time.
  const updatedAt = record.field_last_modified_date
    ? requiredDate(record.field_last_modified_date, "last-modified date")
    : publishedAt;
  const targets: NormalisedTarget[] = [];
  productItems.forEach((item, index) => targets.push(...productItemTargets(item, index, establishmentNames)));

  if (!productItems.length && establishmentNames.length) {
    targets.push(...establishmentNames.map((value) => ({ type: "producer" as const, value, weight: 45, confidence: 0.85 })));
  }

  const advice = summaryParagraphs.filter((paragraph) =>
    /\b(?:consumers?|anyone who purchased|product should be|products should be)\b/i.test(paragraph)
    && /\b(?:do not|not to|should|discard|throw away|thrown away|return|dispose|avoid)\b/i.test(paragraph));

  return {
    title,
    slug: slugify(`fsis-${recallUrl.pathname.split("/").filter(Boolean).at(-1) ?? recallNumber}`),
    region: "US",
    status: statusFromActiveNotice(record.field_active_notice),
    hazard: reasons.join(", ").slice(0, 300) || null,
    pathogen,
    summary: summary.slice(0, 1_500),
    consumerAdvice: advice.slice(0, 2).join(" ").slice(0, 1_500) || "Check the official USDA FSIS notice and follow its consumer instructions.",
    authority: "U.S. Department of Agriculture, Food Safety and Inspection Service",
    authorityUrl: recallUrl.toString(),
    sourceId: recallUrl.pathname,
    publishedAt,
    updatedAt,
    startsAt: publishedAt,
    endsAt: null,
    severity: severityFrom(record.field_recall_classification),
    confidence: 1,
    originalSourceData: record,
    targets,
  };
}

export function parseFsisRecords(input: unknown): NormalisedIncident[] {
  const parsed = recordsSchema.parse(input);
  const englishRecords = parsed.filter((record) => record.langcode.toLowerCase() === "english");
  if (!englishRecords.length) throw new Error("FSIS API returned no English-language records");

  const incidents = englishRecords.map(incidentFromRecord);
  const sourceIds = new Set<string>();
  for (const incident of incidents) {
    if (sourceIds.has(incident.sourceId)) throw new Error(`FSIS API repeated recall URL ${incident.sourceId}`);
    sourceIds.add(incident.sourceId);
  }
  return incidents;
}

export const fsisSource: IncidentSource = {
  id: "fsis",
  name: "U.S. Department of Agriculture Food Safety and Inspection Service",
  url: FSIS_API,
  region: "US",
  scope: "English-language records in the full USDA FSIS Recall API archive, covering FSIS-regulated meat, poultry, and egg recalls and public health alerts.",
  async fetchIncidents() {
    const payload = await fetchOfficialJson(FSIS_API, {
      sourceName: "FSIS Recall API",
      headers: { Accept: "application/json" },
      timeoutMs: 30_000,
      cache: "no-store",
    });
    return parseFsisRecords(payload);
  },
};
