export const NOTION_API_VERSION = "2025-09-03";

const PROPERTY_DEFINITIONS = [
  ["Item", "item", "title", { title: {} }],
  ["Brand", "brand", "rich_text", { rich_text: {} }],
  ["Barcode", "barcode", "rich_text", { rich_text: {} }],
  ["Bought", "bought", "checkbox", { checkbox: {} }],
  ["Batch code", "batchCode", "rich_text", { rich_text: {} }],
  ["Lot code", "lotCode", "rich_text", { rich_text: {} }],
  ["Producer", "producer", "rich_text", { rich_text: {} }],
  ["Country of origin", "countryOfOrigin", "rich_text", { rich_text: {} }],
  ["Establishment number", "establishmentNumber", "rich_text", { rich_text: {} }],
  ["Approval number", "approvalNumber", "rich_text", { rich_text: {} }],
  ["Retailer", "retailer", "rich_text", { rich_text: {} }],
  ["Use by", "useBy", "date", { date: {} }],
  ["Best before", "bestBefore", "date", { date: {} }],
  ["Production date", "productionDate", "date", { date: {} }],
  ["Related warnings", "relatedWarnings", "rich_text", { rich_text: {} }],
  ["Review status", "reviewStatus", "select", {
    select: {
      options: [
        { name: "Related warnings found", color: "red" },
        { name: "No related warnings found in covered data", color: "gray" },
        { name: "Unable to review", color: "gray" },
      ],
    },
  }],
  ["Reviewed at", "reviewedAt", "date", { date: {} }],
  ["Input fingerprint", "inputFingerprint", "rich_text", { rich_text: {} }],
];

export function buildDatabasePayload(parentPageId, title = "Shopping list") {
  if (typeof parentPageId !== "string" || !parentPageId.trim()) throw new Error("A parent Notion page ID is required.");
  if (typeof title !== "string" || !title.trim() || title.length > 100) throw new Error("The database title must be between 1 and 100 characters.");

  const properties = Object.fromEntries(PROPERTY_DEFINITIONS.map(([name, , , schema]) => [name, schema]));
  return {
    parent: { type: "page_id", page_id: parentPageId.trim() },
    title: [{ type: "text", text: { content: title.trim() } }],
    initial_data_source: { properties },
  };
}

export function buildWorkerConfig({ databaseId, dataSourceId, properties, region = "UK" }) {
  if (typeof databaseId !== "string" || !databaseId || typeof dataSourceId !== "string" || !dataSourceId) {
    throw new Error("The Notion database and data source IDs are required.");
  }
  if (!properties || typeof properties !== "object") throw new Error("The returned data source properties are missing.");

  const notionProperties = {};
  for (const [displayName, configKey, expectedKind] of PROPERTY_DEFINITIONS.map(([name, key, kind]) => [name, key, kind])) {
    const property = properties[displayName];
    if (!property || typeof property.id !== "string" || property.type !== expectedKind) {
      throw new Error(`Notion returned a missing or unexpected property: ${displayName}.`);
    }
    notionProperties[configKey] = { id: property.id, kind: expectedKind };
  }

  if (!new Set(["UK", "US"]).has(region)) throw new Error("Region must be UK or US.");

  return {
    listenHost: "0.0.0.0",
    listenPort: 3000,
    statePath: "/data/notion-shopping.sqlite",
    notionDataSourceId: dataSourceId,
    notionDatabaseId: databaseId,
    notionProperties,
    reviewMcpUrl: "https://YOUR-EAT-OR-YEET-MCP/mcp/notion",
    reviewToolName: "review_shopping_items",
    region,
    statusLabels: {
      found: "Related warnings found",
      none: "No related warnings found in covered data",
      unable: "Unable to review",
    },
    secretFiles: {
      notionApiToken: "/run/secrets/notion_api_token",
      notionWebhookVerificationToken: "/run/secrets/notion_webhook_verification_token",
      reviewConnectionKey: "/run/secrets/eoy_connection_key",
    },
  };
}

