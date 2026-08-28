import { z } from "zod";

import type { IncidentSource, NormalisedIncident, NormalisedTarget } from "@/lib/incidents/types";
import { slugify } from "@/lib/matching/normalise";

const listSchema = z.object({
  items: z.array(z.object({ notation: z.string() })),
});

const looseRecord = z.record(z.string(), z.unknown());

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string") ?? null;
  return null;
}

function linkedLabel(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return stringValue((value as Record<string, unknown>).label) ?? stringValue((value as Record<string, unknown>).notation);
}

function detailToIncident(data: Record<string, unknown>): NormalisedIncident | null {
  const notation = stringValue(data.notation);
  const title = stringValue(data.title);
  const created = stringValue(data.created);
  if (!notation || !title || !created) return null;
  const modified = stringValue(data.modified) ?? created;
  const reportingBusiness = looseRecord.safeParse(data.reportingBusiness);
  const producer = reportingBusiness.success ? stringValue(reportingBusiness.data.commonName) : null;
  const problems = Array.isArray(data.problem) ? data.problem.filter((item) => looseRecord.safeParse(item).success) as Record<string, unknown>[] : [];
  const riskStatement = problems.map((problem) => stringValue(problem.riskStatement)).find(Boolean) ?? "See the official alert for details.";
  const pathogenRisk = problems.map((problem) => problem.pathogenRisk).find(Boolean);
  const pathogenRiskRecord = looseRecord.safeParse(pathogenRisk);
  const pathogenRecord = pathogenRiskRecord.success ? looseRecord.safeParse(pathogenRiskRecord.data.pathogen) : null;
  const pathogen = pathogenRecord?.success ? linkedLabel(pathogenRecord.data) : null;
  const hazard = pathogenRiskRecord.success ? linkedLabel(pathogenRiskRecord.data) : null;
  const productDetails = Array.isArray(data.productDetails)
    ? data.productDetails.filter((item): item is Record<string, unknown> => looseRecord.safeParse(item).success)
    : [];
  const targets: NormalisedTarget[] = [];
  if (producer) targets.push({ type: "producer", value: producer, weight: 45, confidence: 0.95 });
  for (const product of productDetails) {
    const productName = stringValue(product.productName);
    if (productName) targets.push({ type: "product", value: productName, weight: 38, confidence: 1 });
    const batches = Array.isArray(product.batchDescription)
      ? product.batchDescription.filter((item): item is Record<string, unknown> => looseRecord.safeParse(item).success)
      : [];
    for (const batch of batches) {
      const batchCode = stringValue(batch.batchCode);
      const dateNote = stringValue(batch.useByDescription) ?? stringValue(batch.bestBeforeDescription);
      if (batchCode) {
        targets.push({
          type: "batch",
          value: batchCode,
          notes: dateNote ? `Affected date information: ${dateNote}` : null,
          weight: 62,
          confidence: 1,
        });
      }
    }
  }
  const alertUrlValue = looseRecord.safeParse(data.alertURL);
  const authorityUrl =
    stringValue(data.alertURL) ??
    (alertUrlValue.success ? stringValue(alertUrlValue.data["@id"]) : null) ??
    `https://www.food.gov.uk/news-alerts/alert/${notation}`;
  const publishedAt = new Date(created);
  const updatedAt = new Date(modified);
  const expires = new Date(updatedAt);
  expires.setUTCDate(expires.getUTCDate() + 180);
  const description = stringValue(data.description) ?? title;
  const consumerAdvice = stringValue(data.consumerAdvice) ?? stringValue(data.actionTaken) ?? "Follow the advice in the official alert.";

  return {
    title,
    slug: slugify(notation),
    region: "UK",
    status: expires > new Date() ? "active" : "resolved",
    hazard: hazard ?? riskStatement.slice(0, 200),
    pathogen,
    summary: description,
    consumerAdvice,
    authority: "Food Standards Agency",
    authorityUrl,
    sourceId: notation,
    publishedAt,
    updatedAt,
    startsAt: publishedAt,
    endsAt: expires,
    severity: pathogen ? "high" : "medium",
    confidence: 1,
    originalSourceData: data,
    targets,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FSA returned HTTP ${response.status}`);
  return response.json();
}

export const fsaSource: IncidentSource = {
  id: "fsa",
  name: "Food Standards Agency",
  url: "https://data.food.gov.uk/food-alerts/",
  async fetchIncidents() {
    const list = listSchema.parse(
      await fetchJson("https://data.food.gov.uk/food-alerts/id?&_sort=-modified&_limit=100"),
    );
    const results: NormalisedIncident[] = [];
    for (let index = 0; index < list.items.length; index += 5) {
      const group = list.items.slice(index, index + 5);
      const details = await Promise.all(
        group.map(({ notation }) =>
          fetchJson(`https://data.food.gov.uk/food-alerts/id/${encodeURIComponent(notation)}`),
        ),
      );
      for (const detail of details) {
        const parsed = z.object({ items: z.array(looseRecord).min(1) }).safeParse(detail);
        if (!parsed.success) continue;
        const incident = detailToIncident(parsed.data.items[0]);
        if (incident) results.push(incident);
      }
    }
    return results;
  },
};
