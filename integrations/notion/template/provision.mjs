import { open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

export async function provisionTemplate({ parentPageId, title, tokenFile, outputPath, region, fetchImpl = fetch }) {
  if (!tokenFile || !outputPath) throw new Error("A private token file and a new config output path are required.");
  if (!new Set([undefined, "UK", "US"]).has(region)) throw new Error("Region must be UK or US.");
  const databasePayload = buildDatabasePayload(parentPageId, title);
  const tokenPath = resolve(tokenFile);
  const destination = resolve(outputPath);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  if (!isAbsolute(tokenFile) || !isAbsolute(outputPath)) throw new Error("Use absolute token-file and config-output paths.");
  if (isWithin(tokenPath, repositoryRoot)) throw new Error("Keep the API token outside the repository checkout.");
  if (isWithin(destination, repositoryRoot)) throw new Error("Keep the generated config outside the repository checkout.");
  let outputExists = false;
  try { await stat(destination); outputExists = true; } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (outputExists) throw new Error("The config output path already exists; refusing to overwrite it or create another database.");
  const tokenStats = await stat(tokenPath);
  if (!tokenStats.isFile() || (tokenStats.mode & 0o077) !== 0) throw new Error("The token file must be a regular file with mode 0400 or 0600.");
  const token = (await readFile(tokenPath, "utf8")).trim();
  if (!token) throw new Error("The token file is empty.");

  const file = await open(destination, "wx", 0o600);
  let createAttempted = false;
  let databaseId;
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    };
    createAttempted = true;
    const databaseResponse = await notionRequest("https://api.notion.com/v1/databases", {
      method: "POST", headers, body: JSON.stringify(databasePayload),
    }, fetchImpl);
    databaseId = databaseResponse.id;
    await writePrivateFile(file, {
      provisioning: "incomplete",
      ...(typeof databaseId === "string" ? { databaseId } : {}),
      recovery: "A database creation request was accepted. Inspect the parent Notion page before retrying; do not rerun blindly.",
    });
    if (typeof databaseId !== "string") throw new Error("Notion did not return a database ID; inspect the parent page before retrying.");

    const database = await notionRequest(`https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`, { headers }, fetchImpl);
    const dataSourceId = Array.isArray(database.data_sources) ? database.data_sources[0]?.id : undefined;
    if (typeof dataSourceId !== "string") throw new Error("Notion did not return the new data source ID; inspect the database before retrying.");

    const dataSource = await notionRequest(`https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}`, { headers }, fetchImpl);
    const config = buildWorkerConfig({ databaseId, dataSourceId, properties: dataSource.properties, region });
    await writePrivateFile(file, config);
    return { databaseId, dataSourceId, outputPath: destination };
  } catch (error) {
    if (createAttempted) {
      await writePrivateFile(file, {
        provisioning: "incomplete",
        ...(typeof databaseId === "string" ? { databaseId } : {}),
        recovery: "Check the parent Notion page/database and this file before retrying. The create request may have succeeded; do not rerun blindly.",
      });
    } else {
      await file.close();
      await unlink(destination);
      throw error;
    }
    throw error;
  } finally {
    await file.close();
  }
}

async function writePrivateFile(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten === 0) throw new Error("Could not write the private config file.");
    offset += bytesWritten;
  }
  await file.truncate(bytes.length);
  await file.sync();
}

async function notionRequest(url, init, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("Notion API request failed; check network access and retry only after checking whether the database was created.");
  }
  if (!response.ok) throw new Error(`Notion API request failed with HTTP ${response.status}; no response body was written to the console.`);
  try {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 256 * 1024) throw new Error("large response");
    if (!response.body) throw new Error("empty response");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) {
        await reader.cancel();
        throw new Error("large response");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Notion returned an unreadable response; check the database before retrying.");
  }
}

function isWithin(candidatePath, parentPath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!["--parent-page", "--title", "--token-file", "--output", "--region"].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    values[key] = value;
    index += 1;
  }
  for (const key of ["--parent-page", "--token-file", "--output"]) {
    if (!values[key]) throw new Error(`Required argument missing: ${key}`);
  }
  return {
    parentPageId: values["--parent-page"],
    title: values["--title"] ?? "Shopping list",
    tokenFile: values["--token-file"],
    outputPath: values["--output"],
    region: values["--region"] ?? "UK",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  try {
    const result = await provisionTemplate(parseArgs(process.argv.slice(2)));
    console.log(`Created shopping-list database ${result.databaseId}; worker config: ${result.outputPath}`);
    console.log("Add only the Notion connection to this database, then review the generated config before starting the worker.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Template provisioning failed.");
    process.exitCode = 1;
  }
}
