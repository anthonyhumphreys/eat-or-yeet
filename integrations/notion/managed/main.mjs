import { chmod, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ManagedStore } from "./store.ts";
import { NotionOAuthApi } from "./notion-api.ts";
import { ManagedRuntime, createManagedReviewer, pacedNotionFetch } from "./runtime.ts";
import { createManagedServer } from "./server.ts";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function insideCheckout(actual) {
  const fromCheckout = relative(checkout, actual);
  return fromCheckout === "" || (!fromCheckout.startsWith(`..${sep}`) && fromCheckout !== ".." && !isAbsolute(fromCheckout));
}

async function privateFile(path) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Private files require an absolute path.");
  const actual = await realpath(path);
  if (insideCheckout(actual)) throw new Error("Keep private configuration outside the checkout.");
  const metadata = await stat(actual);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("Private files must have owner-only permissions.");
  const value = (await readFile(actual, "utf8")).trim();
  if (!value) throw new Error("A private file is empty.");
  return value;
}

function origin(value) {
  if (typeof value !== "string") throw new Error("An origin is required.");
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Use a fixed HTTPS origin.");
  return url.origin;
}
function positive(value, fallback, maximum) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) throw new Error("A managed pilot limit is invalid.");
  return selected;
}

export async function startManagedService(path = process.env.NOTION_MANAGED_CONFIG ?? "/etc/eat-or-yeet/notion-managed.json") {
  process.umask(0o077);
  const parsed = JSON.parse(await privateFile(path));
  if (!parsed.secretFiles || typeof parsed.secretFiles !== "object") throw new Error("Managed secrets are missing.");
  const [clientSecret, key, webhookVerificationToken, reviewConnectionKey] = await Promise.all([
    privateFile(parsed.secretFiles.clientSecret), privateFile(parsed.secretFiles.encryptionKey),
    privateFile(parsed.secretFiles.webhookVerificationToken), privateFile(parsed.secretFiles.reviewConnectionKey),
  ]);
  const encryptionKey = Buffer.from(key, "base64");
  if (encryptionKey.length !== 32 || encryptionKey.toString("base64") !== key) throw new Error("Use a canonical base64-encoded 32-byte encryption key.");
  if (typeof parsed.stateDirectory !== "string" || !isAbsolute(parsed.stateDirectory)) throw new Error("A private persistent state directory is required.");
  if (typeof parsed.clientId !== "string" || !parsed.clientId || typeof parsed.notionIntegrationId !== "string" || !parsed.notionIntegrationId || typeof parsed.notionSubscriptionId !== "string" || !parsed.notionSubscriptionId) throw new Error("Notion application identifiers are missing.");
  const reviewUrl = new URL(parsed.reviewMcpUrl);
  const localReview = process.env.NODE_ENV !== "production" && reviewUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(reviewUrl.hostname);
  if ((!localReview && reviewUrl.protocol !== "https:") || reviewUrl.username || reviewUrl.password || reviewUrl.search || reviewUrl.hash || reviewUrl.pathname !== "/mcp/notion") throw new Error("Use the fixed private MCP endpoint.");
  const config = {
    enabled: parsed.enabled === true,
    publicOrigin: origin(parsed.publicOrigin), websiteOrigin: origin(parsed.websiteOrigin),
    listenHost: parsed.listenHost ?? "127.0.0.1", listenPort: positive(parsed.listenPort, 3000, 65_535),
    stateDirectory: parsed.stateDirectory, clientId: parsed.clientId, clientSecret, encryptionKey,
    webhookVerificationToken, notionIntegrationId: parsed.notionIntegrationId, notionSubscriptionId: parsed.notionSubscriptionId,
    reviewMcpUrl: reviewUrl.href, reviewConnectionKey,
    maxInstallations: positive(parsed.maxInstallations, 20, 100),
    dailyReviewsPerInstallation: positive(parsed.dailyReviewsPerInstallation, 100, 1_000),
    dailyReviewsGlobal: positive(parsed.dailyReviewsGlobal, 1_000, 10_000),
  };
  if (insideCheckout(resolve(config.stateDirectory))) throw new Error("Keep private state outside the checkout.");
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  if (insideCheckout(await realpath(config.stateDirectory))) throw new Error("Keep private state outside the checkout.");
  await chmod(config.stateDirectory, 0o700);
  const store = new ManagedStore(join(config.stateDirectory, "installations.sqlite"), encryptionKey, config.maxInstallations);
  const fetcher = pacedNotionFetch();
  const api = new NotionOAuthApi(config.clientId, clientSecret, `${config.publicOrigin}/oauth/callback`, fetcher);
  const reviewer = createManagedReviewer(config.reviewMcpUrl, reviewConnectionKey);
  const runtime = new ManagedRuntime(config, store, api, reviewer, fetcher);
  const server = createManagedServer(config, store, api, runtime);
  // Only one process may own this database/queue. Docker runs one replica.
  try {
    if (config.enabled) { await reviewer.connect(); await runtime.start(); }
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.listenPort, config.listenHost, () => { server.removeListener("error", reject); resolve(); });
    });
  } catch {
    server.closeAllConnections();
    await runtime.stop().catch(() => undefined);
    store.close();
    throw new Error("Managed Notion service startup failed.");
  }
  console.info("Managed Notion service started.");
  let stopping;
  const stop = () => stopping ??= (async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await runtime.stop();
    store.close();
  })();
  process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
  return { server, stop };
}

const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void startManagedService().catch(() => {
    // OAuth/network exceptions may contain request context. Never print them.
    console.error("Managed Notion service could not start; check private operator configuration.");
    process.exitCode = 1;
  });
}
