import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const managedSource = join(repoRoot, "integrations/notion/managed");
const temporaryRoots: string[] = [];

type Layout = {
  root: string;
  app: string;
  main: string;
  privateDirectory: string;
  stateDirectory: string;
  configPath: string;
  secretPaths: Record<string, string>;
};

async function layout(): Promise<Layout> {
  const root = await mkdtemp(join(tmpdir(), "notion-managed-entrypoint-"));
  temporaryRoots.push(root);
  const app = join(root, "app");
  const privateDirectory = join(root, "private");
  const stateDirectory = join(root, "state");
  const managedDirectory = join(app, "integrations/notion/managed");
  await Promise.all([
    mkdir(managedDirectory, { recursive: true }),
    mkdir(join(app, "integrations/notion/template"), { recursive: true }),
    mkdir(privateDirectory, { mode: 0o700 }),
    mkdir(stateDirectory, { mode: 0o700 }),
  ]);
  await cp(managedSource, managedDirectory, { recursive: true });
  await cp(join(repoRoot, "integrations/notion/shopping-worker.ts"), join(app, "integrations/notion/shopping-worker.ts"));
  await cp(join(repoRoot, "integrations/notion/template/provision.mjs"), join(app, "integrations/notion/template/provision.mjs"));
  const dependencyPath = await realpath(join(repoRoot, "node_modules"));
  await symlink(dependencyPath, join(app, "node_modules"), "dir");
  const secretPaths = {
    clientSecret: join(privateDirectory, "client-secret"),
    encryptionKey: join(privateDirectory, "encryption-key"),
    webhookVerificationToken: join(privateDirectory, "webhook-token"),
    reviewConnectionKey: join(privateDirectory, "review-key"),
  };
  await Promise.all(Object.entries(secretPaths).map(([name, path]) => writeFile(path, name === "encryptionKey" ? Buffer.alloc(32, 7).toString("base64") : `private-${name}-marker`, { mode: 0o600 })));
  const configPath = join(privateDirectory, "notion-managed.json");
  await writeConfig({ configPath, secretPaths, stateDirectory, listenPort: await reservePort() });
  await chmod(configPath, 0o600);
  return { root, app, main: join(managedDirectory, "main.mjs"), privateDirectory, stateDirectory, configPath, secretPaths };
}

async function writeConfig(input: { configPath: string; secretPaths: Record<string, string>; stateDirectory: string; listenPort: number }): Promise<void> {
  await writeFile(input.configPath, JSON.stringify({
    enabled: false,
    publicOrigin: `http://127.0.0.1:${input.listenPort}`,
    websiteOrigin: "https://eat-or-yeet.example",
    listenHost: "127.0.0.1",
    listenPort: input.listenPort,
    stateDirectory: input.stateDirectory,
    clientId: "test-client-id",
    notionIntegrationId: "test-integration-id",
    notionSubscriptionId: "test-subscription-id",
    reviewMcpUrl: "https://review.example/mcp/notion",
    maxInstallations: 5,
    dailyReviewsPerInstallation: 10,
    dailyReviewsGlobal: 50,
    secretFiles: input.secretPaths,
  }), { mode: 0o600 });
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolveListen));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function child(args: string[], options: { cwd: string; env?: Partial<NodeJS.ProcessEnv> }): ChildProcess {
  return spawn(process.execPath, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
}

async function runChild(args: string[], cwd: string, env: Partial<NodeJS.ProcessEnv> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const processChild = child(args, { cwd, env });
  let stdout = "";
  let stderr = "";
  processChild.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  processChild.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const [code] = await once(processChild, "close") as [number | null];
  return { code, stdout, stderr };
}

const importAndStart = `
  const { startManagedService } = await import(process.env.MANAGED_MAIN_URL);
  try {
    const service = await startManagedService(process.env.MANAGED_CONFIG);
    console.log("READY");
    process.on("message", async (message) => {
      if (message === "stop") { await service.stop(); process.exit(0); }
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
`;
const importAndCheck = `
  const { startManagedService } = await import(process.env.MANAGED_MAIN_URL);
  try { await startManagedService(process.env.MANAGED_CONFIG); console.log("STARTED"); }
  catch (error) { console.log(JSON.stringify({ rejected: true, message: error instanceof Error ? error.message : String(error) })); }
`;

function request(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (response) => {
      let body = "";
      response.setEncoding("utf8").on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolveRequest({ status: response.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function startChild(app: Layout): Promise<{ processChild: ChildProcess; output: () => string; errors: () => string }> {
  const processChild = child(["--experimental-strip-types", "--input-type=module", "--eval", importAndStart], {
    cwd: app.app,
    env: { MANAGED_MAIN_URL: pathToFileURL(app.main).href, MANAGED_CONFIG: app.configPath },
  });
  let stdout = "";
  let stderr = "";
  processChild.stdout?.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  processChild.stderr?.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const deadline = Date.now() + 10_000;
  while (!stdout.includes("READY") && !processChild.killed && Date.now() < deadline) {
    if (processChild.exitCode !== null) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (!stdout.includes("READY")) {
    processChild.kill("SIGTERM");
    throw new Error(`Child did not become ready. stdout=${stdout} stderr=${stderr}`);
  }
  return { processChild, output: () => stdout, errors: () => stderr };
}

afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("managed Notion deployment entrypoint", () => {
  it("starts under Node native TypeScript imports, serves disabled routes, and stops cleanly", async () => {
    const app = await layout();
    const { processChild, output, errors } = await startChild(app);
    try {
      expect(output()).toContain("READY");
      const config = JSON.parse(await readFile(app.configPath, "utf8")) as { listenPort: number };
      expect(await request(config.listenPort, "/health"))
        .toMatchObject({ status: 200, body: JSON.stringify({ enabled: false }) });
      const unavailable = await request(config.listenPort, "/connect?region=UK");
      expect(unavailable.status).toBe(503);
      expect(unavailable.body).toContain("Notion setup is not available yet");
      processChild.kill("SIGTERM");
      const [exitCode] = await once(processChild, "close") as [number | null];
      expect(exitCode).toBe(0);
      expect(errors()).not.toContain("private-");
    } finally {
      if (processChild.exitCode === null) processChild.kill("SIGTERM");
    }
  });

  it("rejects config inside the copied checkout and any non-owner-only config or secret", async () => {
    const app = await layout();
    const nodeArgs = ["--experimental-strip-types", "--input-type=module", "--eval", importAndCheck];
    const check = async (configPath = app.configPath) => runChild(nodeArgs, app.app, {
      MANAGED_MAIN_URL: pathToFileURL(app.main).href,
      MANAGED_CONFIG: configPath,
    });
    const insideCheckout = join(app.app, "insecure-config.json");
    await cp(app.configPath, insideCheckout);
    await chmod(insideCheckout, 0o600);
    const checkoutResult = await check(insideCheckout);
    expect(JSON.parse(checkoutResult.stdout)).toMatchObject({ rejected: true, message: "Keep private configuration outside the checkout." });

    await chmod(app.configPath, 0o644);
    const configResult = await check();
    expect(configResult.code).toBe(0);
    expect(JSON.parse(configResult.stdout)).toMatchObject({ rejected: true, message: "Private files must have owner-only permissions." });

    await chmod(app.configPath, 0o600);
    await chmod(app.secretPaths.clientSecret, 0o644);
    const secretResult = await check();
    expect(secretResult.code).toBe(0);
    expect(JSON.parse(secretResult.stdout)).toMatchObject({ rejected: true, message: "Private files must have owner-only permissions." });
  });

  it("prints only a generic startup error when private operator data is invalid", async () => {
    const app = await layout();
    const sensitiveMarker = "do-not-print-managed-config-marker";
    await writeFile(app.configPath, `{"sensitive":"${sensitiveMarker}"`, { mode: 0o600 });
    const result = await runChild(["--experimental-strip-types", app.main], app.app, { NOTION_MANAGED_CONFIG: app.configPath });
    expect(result.code, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(1);
    expect(result.stderr).toContain("Managed Notion service could not start; check private operator configuration.");
    expect(`${result.stdout}${result.stderr}`).not.toContain(sensitiveMarker);
    expect(`${result.stdout}${result.stderr}`).not.toContain("SyntaxError");
  });
});
