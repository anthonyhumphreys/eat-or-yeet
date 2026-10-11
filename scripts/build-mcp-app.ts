import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { MAX_APP_HTML_BYTES, MAX_APP_RESPONSE_BYTES } from "../src/lib/integrations/mcp/app-limits";

const root = process.cwd();
const source = join(root, "apps/eat-or-yeet");
const compiled = await build({ entryPoints: [join(source, "src/app.ts")], bundle: true, minify: true,
  write: false, format: "iife", platform: "browser", target: "es2022", legalComments: "eof" });
const script = compiled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const style = await readFile(join(source, "src/styles.css"), "utf8");
const template = await readFile(join(source, "index.html"), "utf8");
if (!template.includes("<!-- APP_SCRIPT -->") || !template.includes("<!-- APP_STYLE -->")) throw new Error("Missing inline app build markers.");
const hash = (value: string) => createHash("sha256").update(value).digest("base64");
const policy = `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; img-src data:; base-uri 'none'; form-action 'none'`;
const html = template.replace("<head>", () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
  .replace("<!-- APP_STYLE -->", () => `<style>${style}</style>`).replace("<!-- APP_SCRIPT -->", () => `<script>${script}</script>`);
if (Buffer.byteLength(html) > MAX_APP_HTML_BYTES || Buffer.byteLength(JSON.stringify(html)) > MAX_APP_RESPONSE_BYTES - 4096) {
  throw new Error(`The embedded app exceeds its static resource budget (${Buffer.byteLength(html)} raw / ${Buffer.byteLength(JSON.stringify(html))} encoded bytes).`);
}
const output = join(root, "public/mcp-app");
await mkdir(output, { recursive: true });
await writeFile(join(output, "result-v1.html"), html);
console.info(`Built inline MCP app: ${Buffer.byteLength(html)} bytes.`);
