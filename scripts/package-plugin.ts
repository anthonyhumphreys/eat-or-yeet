import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import { zipSync, type Zippable } from "fflate";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptDirectory);
export const pluginRoot = path.join(repositoryRoot, "plugins/eat-or-yeet");
export const defaultArchivePath = path.join(repositoryRoot, "dist/eat-or-yeet-plugin.zip");

const schemaDirectory = path.join(pluginRoot, "schemas/1.0.0");
const schemaFiles = {
  plugin: path.join(schemaDirectory, "plugin.schema.json"),
  mcp: path.join(schemaDirectory, "mcp.schema.json"),
} as const;
const schemaHashes = {
  "plugin.schema.json": "0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883",
  "mcp.schema.json": "6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb",
} as const;

// fflate writes ZIP timestamps using local Date getters, so use a fixed local
// wall-clock date to get identical DOS timestamps regardless of machine TZ.
const archiveEpoch = new Date(1980, 0, 1, 0, 0, 0);
const maxAssetBytes = 5 * 1024 * 1024;
const maxPackageBytes = 10 * 1024 * 1024;
const assetNamePattern = /^[a-z0-9][a-z0-9._-]*\.(?:svg|png|jpe?g|webp)$/i;
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{24,}/i,
];

type JsonObject = Record<string, unknown>;
type PackageFile = { archivePath: string; bytes: Buffer };

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

async function readJson(filePath: string): Promise<JsonObject> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${path.relative(pluginRoot, filePath)} as JSON`, { cause: error });
  }
  return asObject(parsed, path.basename(filePath));
}

async function readSchema(filePath: string, fileName: keyof typeof schemaHashes): Promise<AnySchema> {
  const bytes = await readFile(filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== schemaHashes[fileName]) {
    throw new Error(`Vendored schema ${fileName} changed; update its provenance hash intentionally`);
  }
  return asObject(JSON.parse(bytes.toString("utf8")), fileName) as AnySchema;
}

function assertSchemaValid(label: string, validate: ValidateFunction, value: JsonObject): void {
  if (!validate(value)) {
    const errors = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
    throw new Error(`${label} failed Agent Plugins schema validation: ${errors?.join("; ") ?? "unknown schema error"}`);
  }
}

function assertRecord(value: unknown, label: string): JsonObject {
  return asObject(value, label);
}

function resolvePackageReference(packageDirectory: string, reference: unknown, label: string): { absolutePath: string; archivePath: string; reference: string } {
  if (typeof reference !== "string" || !reference.startsWith("./")) {
    throw new Error(`${label} must be a ./-prefixed package-relative path`);
  }
  const parts = reference.slice(2).split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(`${label} contains an unsafe path: ${reference}`);
  }
  const resolved = path.resolve(packageDirectory, ...parts);
  if (!resolved.startsWith(`${packageDirectory}${path.sep}`)) {
    throw new Error(`${label} escapes the plugin package: ${reference}`);
  }
  return { absolutePath: resolved, archivePath: parts.join("/"), reference };
}

function collectReferences(manifest: JsonObject): Array<{ reference: unknown; label: string }> {
  const extensions = assertRecord(manifest.extensions, "plugin.json extensions");
  const openai = assertRecord(extensions["com.openai"], "plugin.json extensions.com.openai");
  for (const key of ["apps", "hooks", "review", "publication"] as const) {
    if (key in openai) throw new Error(`OpenAI ${key} metadata is not permitted in this staging package`);
  }
  for (const key of Object.keys(openai)) {
    if (key !== "onboardingSkill" && key !== "interface") {
      throw new Error(`Unsupported OpenAI plugin metadata is not permitted in this staging package: ${key}`);
    }
  }
  const references: Array<{ reference: unknown; label: string }> = [
    { reference: openai.onboardingSkill, label: "onboardingSkill" },
  ];
  if (openai.interface !== undefined) {
    const pluginInterface = assertRecord(openai.interface, "plugin.json extensions.com.openai.interface");
    for (const field of ["composerIcon", "composerIconDark", "logo", "logoDark"] as const) {
      if (pluginInterface[field] !== undefined) references.push({ reference: pluginInterface[field], label: `interface.${field}` });
    }
    if (pluginInterface.screenshots !== undefined) {
      if (!Array.isArray(pluginInterface.screenshots)) throw new Error("interface.screenshots must be an array");
      pluginInterface.screenshots.forEach((reference, index) => references.push({ reference, label: `interface.screenshots[${index}]` }));
    }
  }
  return references;
}

function isAllowedSourceOnlyFile(relativePath: string): boolean {
  return [
    "schemas/1.0.0/README.md",
    "schemas/1.0.0/LICENSE-APACHE-2.0.txt",
    "schemas/1.0.0/plugin.schema.json",
    "schemas/1.0.0/mcp.schema.json",
  ].includes(relativePath);
}

function isAllowedArchiveFile(relativePath: string): boolean {
  if (relativePath === "plugin.json" || relativePath === "mcp.json") return true;
  const parts = relativePath.split("/");
  if (parts.some((part) => part.startsWith("."))) return false;
  if (parts[0] === "assets" && parts.length === 2) return assetNamePattern.test(parts[1]);
  if (parts[0] === "skills" && parts.length === 3) {
    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(parts[1]) && parts[2] === "SKILL.md";
  }
  return false;
}

async function walkPackage(packageDirectory: string): Promise<PackageFile[]> {
  const archiveFiles: PackageFile[] = [];
  const sourcePaths = new Set<string>();
  let totalBytes = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(packageDirectory, absolutePath).split(path.sep).join("/");
      const status = await lstat(absolutePath);
      if (status.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in plugin packages: ${relativePath}`);
      if (status.isDirectory()) {
        if (entry.name.startsWith(".")) throw new Error(`Hidden directories are not allowed: ${relativePath}`);
        await walk(absolutePath);
        continue;
      }
      if (!status.isFile()) throw new Error(`Only regular files are allowed in plugin packages: ${relativePath}`);
      if (!isAllowedArchiveFile(relativePath) && !isAllowedSourceOnlyFile(relativePath)) {
        throw new Error(`Unexpected file outside the package allowlist: ${relativePath}`);
      }
      sourcePaths.add(relativePath);
      if (relativePath.startsWith("assets/") && status.size > maxAssetBytes) {
        throw new Error(`Asset exceeds the 5 MiB limit: ${relativePath}`);
      }
      totalBytes += status.size;
      if (totalBytes > maxPackageBytes) throw new Error("Plugin package exceeds the 10 MiB source limit");
      const bytes = await readFile(absolutePath);
      const isSvgAsset = relativePath.startsWith("assets/") && relativePath.toLowerCase().endsWith(".svg");
      if (!relativePath.startsWith("assets/") || isSvgAsset) {
        let content: string;
        try {
          content = isSvgAsset ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes.toString("utf8");
        } catch (error) {
          throw new Error(`SVG asset must be valid UTF-8 text: ${relativePath}`, { cause: error });
        }
        if (secretPatterns.some((pattern) => pattern.test(content))) {
          throw new Error(`Credential-like material found in ${relativePath}`);
        }
      }
      const file = { archivePath: relativePath, bytes };
      if (isAllowedArchiveFile(relativePath)) archiveFiles.push(file);
    }
  }

  await walk(packageDirectory);
  for (const required of ["plugin.json", "mcp.json", "skills/checking/SKILL.md", "skills/setup/SKILL.md", "assets/icon.svg"]) {
    if (!archiveFiles.some((file) => file.archivePath === required)) throw new Error(`Required plugin file is missing: ${required}`);
  }
  if (!sourcePaths.has("schemas/1.0.0/README.md")) throw new Error("Vendored schema provenance README is missing");
  return archiveFiles.sort((a, b) => a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0);
}

export async function createPluginArchive(packageDirectory = pluginRoot): Promise<Buffer> {
  const absoluteRoot = path.resolve(packageDirectory);
  const rootStatus = await lstat(absoluteRoot).catch(() => null);
  if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink()) throw new Error("Plugin root must be a real directory");

  const pluginSchema = await readSchema(schemaFiles.plugin, "plugin.schema.json");
  const mcpSchema = await readSchema(schemaFiles.mcp, "mcp.schema.json");
  const manifest = await readJson(path.join(absoluteRoot, "plugin.json"));
  const mcpConfiguration = await readJson(path.join(absoluteRoot, "mcp.json"));
  const jsonSchema = new Ajv2020({ allErrors: true, strict: false });
  const validatePlugin = jsonSchema.compile(pluginSchema);
  const validateMcp = jsonSchema.compile(mcpSchema);
  assertSchemaValid("plugin.json", validatePlugin, manifest);
  assertSchemaValid("mcp.json", validateMcp, mcpConfiguration);

  if (manifest.name !== "eat-or-yeet") throw new Error("Plugin name must remain eat-or-yeet");
  const resolvedReferences: Array<{ reference: string; label: string; archivePath: string }> = [];
  for (const { reference, label } of collectReferences(manifest)) {
    const { absolutePath: target, archivePath, reference: packageReference } = resolvePackageReference(absoluteRoot, reference, label);
    const status = await lstat(target).catch(() => null);
    if (!status?.isFile() || status.isSymbolicLink()) throw new Error(`${label} does not reference a regular file in the package`);
    resolvedReferences.push({
      reference: packageReference,
      label,
      archivePath,
    });
  }

  const serverEntries = Object.entries(assertRecord(mcpConfiguration.mcpServers, "mcpServers"));
  if (serverEntries.length !== 1) throw new Error("The initial plugin package must declare exactly one MCP server");
  const [serverName, serverConfiguration] = serverEntries[0]!;
  const server = assertRecord(serverConfiguration, `mcpServers.${serverName}`);
  if (serverName !== "eat-or-yeet" || server.type !== "streamable-http" || typeof server.url !== "string" || server.url !== "https://www.eatoryeet.app/mcp") {
    throw new Error("The MCP server must be the anonymous Streamable HTTP endpoint https://www.eatoryeet.app/mcp");
  }
  if (Object.keys(server).some((key) => key !== "type" && key !== "url")) {
    throw new Error("The initial MCP server entry must not contain credentials, headers, or extra configuration");
  }
  const endpoint = new URL(server.url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("The MCP endpoint must be a plain HTTPS URL without embedded credentials or query parameters");
  }

  const files = await walkPackage(absoluteRoot);
  const archivePaths = new Set(files.map((file) => file.archivePath));
  for (const { reference, label, archivePath } of resolvedReferences) {
    if (!archivePaths.has(archivePath)) {
      throw new Error(`${label} references a source file omitted from the plugin archive: ${reference}`);
    }
  }
  const onboardingReference = resolvedReferences.find((reference) => reference.label === "onboardingSkill")?.reference;
  if (onboardingReference !== "./skills/setup/SKILL.md") {
    throw new Error("onboardingSkill must reference ./skills/setup/SKILL.md");
  }

  const zippable: Zippable = {};
  for (const file of files) {
    zippable[file.archivePath] = [new Uint8Array(file.bytes), {
      mtime: archiveEpoch,
      os: 3,
      attrs: 0o100644 << 16,
      extra: {},
      comment: "",
    }];
  }
  return Buffer.from(zipSync(zippable, { level: 9, mtime: archiveEpoch, os: 3, attrs: 0o100644 << 16, extra: {}, comment: "" }));
}

export async function writePluginArchive(outputPath = defaultArchivePath): Promise<string> {
  const absoluteOutput = path.resolve(outputPath);
  if (absoluteOutput === pluginRoot || absoluteOutput.startsWith(`${pluginRoot}${path.sep}`)) {
    throw new Error("Archive output must be outside the plugin source directory");
  }
  const archive = await createPluginArchive();
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, archive);
  return absoluteOutput;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  writePluginArchive().then((archivePath) => {
    process.stdout.write(`Wrote ${archivePath}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
