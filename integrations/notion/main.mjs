import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { McpReviewClient, NotionRestClient, SqliteWorkerStore, createShoppingWebhookWorker } from "./shopping-worker.ts";

async function readSecret(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("A secret file is missing or has group/other permissions.");
  const value = (await readFile(path, "utf8")).trim();
  if (!value) throw new Error("A required secret file is empty.");
  return value;
}

async function start() {
  process.umask(0o077);
  const configPath = process.env.NOTION_WORKER_CONFIG ?? "/etc/eat-or-yeet/notion-worker.json";
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const [notionApiToken, notionWebhookVerificationToken, reviewConnectionKey] = await Promise.all([
    readSecret(parsed.secretFiles.notionApiToken),
    readSecret(parsed.secretFiles.notionWebhookVerificationToken),
    readSecret(parsed.secretFiles.reviewConnectionKey),
  ]);
  const config = { ...parsed };
  delete config.secretFiles;
  Object.assign(config, { notionApiToken, notionWebhookVerificationToken, reviewConnectionKey });
  const notion = new NotionRestClient(notionApiToken);
  const reviewer = new McpReviewClient(config.reviewMcpUrl, reviewConnectionKey, config.reviewToolName);
  await reviewer.connect();
  const worker = createShoppingWebhookWorker({ config, notion, reviewer, store: new SqliteWorkerStore(config.statePath) });
  await worker.start();
  console.info(`Notion shopping webhook listening on ${config.listenHost}:${config.listenPort}/webhooks/notion`);
  const stop = () => { void worker.stop().finally(() => process.exit(0)); };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void start().catch(() => {
    // SDK/network exceptions can include request context; do not print them.
    console.error("Notion shopping worker could not start; check owner-managed configuration and secret files.");
    process.exitCode = 1;
  });
}
