import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDatabasePayload, buildWorkerConfig, provisionTemplate } from "../integrations/notion/template/provision.mjs";

const workflowPath = new URL("../integrations/notion/template/notion-webhook-relay.n8n.json", import.meta.url);

type SchemaProperty = Record<string, unknown> & {
  select?: { options: Array<{ name: string }> };
};

type WorkerConfig = {
  notionProperties: Record<string, { id: string; kind: string }>;
  secretFiles: Record<string, string>;
};

type RelayParameters = {
  options?: {
    rawBody?: boolean;
    response?: { response?: Record<string, unknown> };
    redirect?: { redirect?: { followRedirects?: boolean } };
    responseCode?: string;
  };
  contentType?: string;
  inputDataFieldName?: string;
  headerParameters?: { parameters: Array<{ name: string }> };
  responseBody?: string;
};

type RelayWorkflow = {
  nodes: Array<{ type: string; name: string; parameters: RelayParameters }>;
  settings: Record<string, unknown>;
};

describe("Notion shopping-list template", () => {
  it("defines the watched packet inputs with the agreed Notion types", () => {
    const payload = buildDatabasePayload("parent-page", "Pantry list");
    const properties = payload.initial_data_source.properties as Record<string, SchemaProperty>;

    expect(properties.Item).toEqual({ title: {} });
    expect(properties.Bought).toEqual({ checkbox: {} });
    for (const name of ["Batch code", "Lot code", "Producer", "Country of origin", "Establishment number", "Approval number", "Retailer"]) {
      expect(properties[name]).toEqual({ rich_text: {} });
    }
    for (const name of ["Use by", "Best before", "Production date", "Reviewed at"]) {
      expect(properties[name]).toEqual({ date: {} });
    }
    const reviewStatus = properties["Review status"] as { select: { options: Array<{ name: string }> } };
    expect(reviewStatus.select.options.map((option) => option.name)).toEqual([
      "Related warnings found",
      "No related warnings found in covered data",
      "Unable to review",
    ]);
  });

  it("captures returned Notion property IDs into worker config without inline secrets", () => {
    const schema = buildDatabasePayload("page").initial_data_source.properties as Record<string, SchemaProperty>;
    const properties = Object.fromEntries(Object.entries(schema).map(([name, value], index) => [
      name,
      { id: `notion-property-${index}`, type: Object.keys(value)[0] },
    ]));
    const config = buildWorkerConfig({ databaseId: "database-1", dataSourceId: "source-1", properties }) as unknown as WorkerConfig;

    expect(config.notionProperties.batchCode).toEqual({ id: "notion-property-4", kind: "rich_text" });
    expect(config.notionProperties.useBy).toEqual({ id: "notion-property-11", kind: "date" });
    expect(config.notionProperties.inputFingerprint).toEqual({ id: "notion-property-17", kind: "rich_text" });
    expect(config.secretFiles).toEqual({
      notionApiToken: "/run/secrets/notion_api_token",
      notionWebhookVerificationToken: "/run/secrets/notion_webhook_verification_token",
      reviewConnectionKey: "/run/secrets/eoy_connection_key",
    });
    expect(JSON.stringify(config)).not.toContain("NOTION_API_TOKEN");
  });

  it("rejects an invalid region before creating a database or reserving the config path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "notion-template-test-"));
    const tokenFile = join(directory, "notion-token");
    const outputPath = join(directory, "worker-config.json");
    await writeFile(tokenFile, "test-token", { mode: 0o600 });
    let requests = 0;
    try {
      await expect(provisionTemplate({
        parentPageId: "parent-page",
        title: "Pantry list",
        tokenFile,
        outputPath,
        region: "invalid",
        fetchImpl: async () => {
          requests += 1;
          throw new Error("Unexpected request");
        },
      })).rejects.toThrow("Region must be UK or US");
      expect(requests).toBe(0);
      await expect(stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a complete private config from the three Notion API responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "notion-template-test-"));
    const tokenFile = join(directory, "notion-token");
    const outputPath = join(directory, "worker-config.json");
    await writeFile(tokenFile, "test-token", { mode: 0o600 });
    const schema = buildDatabasePayload("page").initial_data_source.properties as Record<string, SchemaProperty>;
    const notionProperties = Object.fromEntries(Object.entries(schema).map(([name, value], index) => [
      name,
      { id: `returned-property-${index}`, type: Object.keys(value)[0] },
    ]));
    const apiResponses = [
      { id: "created-database" },
      { data_sources: [{ id: "created-data-source" }] },
      { properties: notionProperties },
    ];
    let requests = 0;
    try {
      await provisionTemplate({
        parentPageId: "parent-page",
        title: "Pantry list",
        tokenFile,
        outputPath,
        region: "UK",
        fetchImpl: async () => {
          requests += 1;
          const body = apiResponses.shift();
          if (!body) throw new Error("Unexpected extra request");
          return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        },
      });

      const [configText, configStats] = await Promise.all([
        readFile(outputPath, "utf8"),
        stat(outputPath),
      ]);
      const config = JSON.parse(configText) as WorkerConfig & { notionDatabaseId: string; notionDataSourceId: string };
      expect(requests).toBe(3);
      expect(configStats.mode & 0o777).toBe(0o600);
      expect(config.notionDatabaseId).toBe("created-database");
      expect(config.notionDataSourceId).toBe("created-data-source");
      expect(config.notionProperties.batchCode).toEqual({ id: "returned-property-4", kind: "rich_text" });
      expect(config.notionProperties.productionDate).toEqual({ id: "returned-property-13", kind: "date" });
      expect(config.secretFiles).toBeDefined();
      expect(configText).not.toContain("test-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a private recovery checkpoint when the created database cannot be read back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "notion-template-test-"));
    const tokenFile = join(directory, "notion-token");
    const outputPath = join(directory, "worker-config.json");
    await writeFile(tokenFile, "test-token", { mode: 0o600 });
    let requests = 0;
    try {
      await expect(provisionTemplate({
        parentPageId: "parent-page",
        title: "Pantry list",
        tokenFile,
        outputPath,
        region: "UK",
        fetchImpl: async () => {
          requests += 1;
          const body = requests === 1 ? { id: "created-database" } : { data_sources: [] };
          return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        },
      })).rejects.toThrow("inspect the database before retrying");

      const recoveryText = await readFile(outputPath, "utf8");
      expect(JSON.parse(recoveryText)).toMatchObject({
        provisioning: "incomplete",
        databaseId: "created-database",
      });
      expect(recoveryText).not.toContain("test-token");
      expect(requests).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("relays the raw body and signature and returns worker status without saving executions", async () => {
    const workflow = JSON.parse(await readFile(workflowPath, "utf8")) as RelayWorkflow;
    const webhook = workflow.nodes.find((node) => node.type === "n8n-nodes-base.webhook");
    const relay = workflow.nodes.find((node) => node.name === "Forward signed bytes to worker");
    const respond = workflow.nodes.find((node) => node.type === "n8n-nodes-base.respondToWebhook");
    if (!webhook || !relay || !respond) throw new Error("Workflow is missing a relay node.");

    expect(webhook.parameters.options?.rawBody).toBe(true);
    expect(relay.parameters.contentType).toBe("binaryData");
    expect(relay.parameters.inputDataFieldName).toBe("data");
    expect(relay.parameters.headerParameters?.parameters).toContainEqual(expect.objectContaining({ name: "X-Notion-Signature" }));
    expect(relay.parameters.options?.response?.response).toMatchObject({ fullResponse: true, neverError: true, responseFormat: "json" });
    expect(relay.parameters.options?.redirect?.redirect?.followRedirects).toBe(false);
    expect(respond.parameters.options?.responseCode).toContain("$json.statusCode");
    expect(respond.parameters.responseBody).toContain("$json.body");
    expect(workflow.settings).toMatchObject({
      saveDataErrorExecution: "none",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
      saveExecutionProgress: false,
    });

    // n8n's rawBody option exposes base64 binary data; the n8n Binary File body
    // option decodes it to bytes for HTTP transmission. This keeps HMAC input exact.
    const raw = Buffer.from('{ "é": "milk" }\n', "utf8");
    const encoded = raw.toString("base64");
    const forwarded = Buffer.from(encoded, "base64");
    const signature = createHmac("sha256", "private-test-secret").update(raw).digest("hex");
    expect(forwarded).toEqual(raw);
    expect(createHmac("sha256", "private-test-secret").update(forwarded).digest("hex")).toBe(signature);
  });
});
