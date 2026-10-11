import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { unzipSync, zipSync, type Zippable } from "fflate";
import { z } from "zod";

import { createPluginArchive } from "./package-plugin";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templateRoot = path.join(repositoryRoot, "plugins/grok-bot");
export const grokBotOutputRoot = path.join(repositoryRoot, "dist/grok-bot");

const sourceManifestSchema = z.object({
  name: z.literal("eat-or-yeet"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
  keywords: z.array(z.string()),
});

function encodeJson(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function readTemplate(name: "README.md" | "LICENSE"): Promise<Uint8Array<ArrayBuffer>> {
  const filename = path.join(templateRoot, name);
  const status = await lstat(filename);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Invalid package template: ${name}`);
  return new Uint8Array(await readFile(filename));
}

// Reuse the existing validated allowlist, credential checks, schemas and skills.
// Export a Cursor manifest for the documented logo and publisher fields.
export async function createGrokBotPackage(): Promise<Record<string, Uint8Array>> {
  const files = unzipSync(await createPluginArchive());
  const source = sourceManifestSchema.parse(JSON.parse(Buffer.from(files["plugin.json"]).toString("utf8")));
  delete files["plugin.json"];
  files[".cursor-plugin/plugin.json"] = encodeJson({
    name: source.name,
    version: source.version,
    description: source.description,
    author: { name: "Lexio Apps Ltd.", email: "anthony@lexio.app" },
    homepage: "https://www.eatoryeet.app",
    repository: "https://github.com/anthonyhumphreys/eat-or-yeet",
    license: "MIT",
    keywords: source.keywords,
    logo: "assets/icon.svg",
    skills: "./skills/",
    mcpServers: "./mcp.json",
  });
  // Cursor infers the remote transport from the URL in its native format.
  files["mcp.json"] = encodeJson({
    mcpServers: { "eat-or-yeet": { url: "https://www.eatoryeet.app/mcp" } },
  });
  files["README.md"] = await readTemplate("README.md");
  files["LICENSE"] = await readTemplate("LICENSE");
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export function archiveGrokBotPackage(files: Record<string, Uint8Array>): Buffer {
  const entries: Zippable = {};
  const epoch = new Date(1980, 0, 1, 0, 0, 0);
  for (const [filename, bytes] of Object.entries(files)) {
    entries[`eat-or-yeet/${filename}`] = [bytes, { mtime: epoch, os: 3, attrs: 0o100644 << 16 }];
  }
  return Buffer.from(zipSync(entries, { level: 9, mtime: epoch, os: 3, attrs: 0o100644 << 16 }));
}

export async function writeGrokBotPackage(): Promise<{ directory: string; archivePath: string; sha256: string }> {
  const files = await createGrokBotPackage();
  const directory = path.join(grokBotOutputRoot, "eat-or-yeet");
  // This managed export must not silently reuse a directory containing old files.
  if (await lstat(directory).catch(() => null)) {
    throw new Error(`Export directory already exists. Move it aside before rebuilding: ${directory}`);
  }
  await mkdir(directory, { recursive: true });
  for (const [filename, bytes] of Object.entries(files)) {
    const destination = path.join(directory, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const archive = archiveGrokBotPackage(files);
  const archivePath = path.join(grokBotOutputRoot, "eat-or-yeet-grok-bot.zip");
  await writeFile(archivePath, archive);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await writeFile(`${archivePath}.sha256`, `${sha256}  ${path.basename(archivePath)}\n`);
  return { directory, archivePath, sha256 };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  writeGrokBotPackage().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
