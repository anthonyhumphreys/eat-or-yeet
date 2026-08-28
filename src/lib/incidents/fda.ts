import { z } from "zod";

import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { slugify } from "@/lib/matching/normalise";

const recordSchema = z.object({
  status: z.string(),
  classification: z.string().optional().default("Unclassified"),
  country: z.string().optional().default("United States"),
  recalling_firm: z.string(),
  recall_number: z.string(),
  product_description: z.string(),
  reason_for_recall: z.string(),
  recall_initiation_date: z.string(),
  report_date: z.string(),
  code_info: z.string().optional().default(""),
  distribution_pattern: z.string().optional().default(""),
}).passthrough();

const responseSchema = z.object({ results: z.array(recordSchema) });

function parseFdaDate(value: string): Date {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  return match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : new Date(value);
}

function pathogenFrom(reason: string): string | null {
  const names = ["Salmonella", "Listeria monocytogenes", "E. coli", "Clostridium botulinum", "Hepatitis A"];
  return names.find((name) => reason.toLowerCase().includes(name.toLowerCase())) ?? null;
}

function codeTargets(codeInfo: string): NormalisedTarget[] {
  const values = new Set<string>();
  const pattern = /(?:lot|batch|code)\s*(?:number|no\.?|#|:)?\s*([A-Z0-9][A-Z0-9./-]{2,30})/gi;
  for (const match of codeInfo.matchAll(pattern)) values.add(match[1]);
  return [...values].map((value) => ({ type: "lot", value, notes: codeInfo.slice(0, 500), weight: 60, confidence: 0.9 }));
}

export const fdaSource: IncidentSource = {
  id: "fda",
  name: "U.S. Food and Drug Administration",
  url: "https://open.fda.gov/apis/food/enforcement/",
  async fetchIncidents() {
    const url = 'https://api.fda.gov/food/enforcement.json?search=status:%22Ongoing%22&sort=report_date:desc&limit=100';
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`FDA returned HTTP ${response.status}`);
    const parsed = responseSchema.parse(await response.json());
    return parsed.results.map((record): NormalisedIncident => {
      const productName = record.product_description.split(/[;,]/)[0].trim().slice(0, 300);
      const sourceId = record.recall_number.trim() || `unclassified-${record.report_date}-${slugify(`${record.recalling_firm}-${productName}`)}`;
      const targets: NormalisedTarget[] = [
        { type: "producer", value: record.recalling_firm, weight: 45, confidence: 1 },
        { type: "product", value: productName, weight: 35, confidence: 0.9 },
        { type: "country", value: record.country, weight: 10, confidence: 1 },
        ...codeTargets(record.code_info),
      ];
      const publishedAt = parseFdaDate(record.report_date);
      const startsAt = parseFdaDate(record.recall_initiation_date);
      const officialApiUrl = record.recall_number.trim()
        ? `https://api.fda.gov/food/enforcement.json?search=recall_number:%22${encodeURIComponent(record.recall_number)}%22`
        : "https://www.accessdata.fda.gov/scripts/ires/index.cfm#/search/";
      const severity = record.classification === "Class I" ? "critical" : record.classification === "Class II" ? "high" : "medium";
      return {
        title: `${record.recalling_firm} recall: ${productName}`,
        slug: slugify(`fda-${sourceId}`),
        region: "US",
        status: record.status.toLowerCase() === "ongoing" ? "active" : "resolved",
        hazard: record.reason_for_recall,
        pathogen: pathogenFrom(record.reason_for_recall),
        summary: record.product_description,
        consumerAdvice: "Do not consume an affected product. Follow the firm's instructions and the latest FDA enforcement report.",
        authority: "U.S. Food and Drug Administration",
        authorityUrl: officialApiUrl,
        sourceId,
        publishedAt,
        updatedAt: publishedAt,
        startsAt,
        endsAt: null,
        severity,
        confidence: 1,
        originalSourceData: record,
        targets,
      };
    });
  },
};
