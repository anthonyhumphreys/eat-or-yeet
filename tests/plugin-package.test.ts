import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginArchive, pluginRoot } from "../scripts/package-plugin";

const temporaryDirectories: string[] = [];
const expectedArchiveFiles = [
  "assets/icon.svg",
  "mcp.json",
  "plugin.json",
  "skills/checking/SKILL.md",
  "skills/setup/SKILL.md",
];

async function copyPackageFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "eoy-plugin-test-"));
  temporaryDirectories.push(directory);
  await cp(pluginRoot, directory, { recursive: true });
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("portable plugin package", () => {
  it("validates the pinned Agent Plugins schemas and packages only installable files", async () => {
    const archive = await createPluginArchive();
    const files = unzipSync(archive);

    expect(Object.keys(files)).toEqual(expectedArchiveFiles);
    expect(files["plugin.json"]).toBeDefined();
    expect(files["mcp.json"]).toBeDefined();
    expect(Object.keys(files)).not.toContain("schemas/1.0.0/plugin.schema.json");
    expect(Object.keys(files)).not.toContain("PACKAGE-NOTES.md");

    const plugin = JSON.parse(Buffer.from(files["plugin.json"]!).toString("utf8")) as {
      name: string;
      extensions: { "com.openai": { onboardingSkill: string } };
    };
    const mcp = JSON.parse(Buffer.from(files["mcp.json"]!).toString("utf8")) as {
      mcpServers: Record<string, { type: string; url: string; headers?: unknown }>;
    };
    expect(plugin.name).toBe("eat-or-yeet");
    expect(plugin.extensions["com.openai"].onboardingSkill).toBe("./skills/setup/SKILL.md");
    expect(mcp.mcpServers).toEqual({
      "eat-or-yeet": { type: "streamable-http", url: "https://eatoryeet.app/mcp" },
    });
    for (const skillPath of ["skills/checking/SKILL.md", "skills/setup/SKILL.md"]) {
      expect(Buffer.from(files[skillPath]!).toString("utf8")).toMatch(/^---\nname: [a-z0-9-]+\ndescription: .+\n---\n/);
    }
    expect(await readFile(path.join(pluginRoot, "schemas/1.0.0/README.md"), "utf8")).toContain("Apache-2.0");
    expect(await readFile(path.join(pluginRoot, "schemas/1.0.0/LICENSE-APACHE-2.0.txt"), "utf8")).toContain("Apache License");
  });

  it("produces byte-identical archives with a stable file order and DOS epoch timestamps", async () => {
    const first = await createPluginArchive();
    const second = await createPluginArchive();
    expect(first).toEqual(second);
    expect(first.readUInt16LE(10)).toBe(0);
    expect(first.readUInt16LE(12)).toBe(0x21);
    expect(Object.keys(unzipSync(first))).toEqual(expectedArchiveFiles);
  });

  it("rejects files outside the narrow package allowlist", async () => {
    const fixture = await copyPackageFixture();
    await writeFile(path.join(fixture, "README.md"), "Do not bundle repository documentation.\n");

    await expect(createPluginArchive(fixture)).rejects.toThrow("Unexpected file outside the package allowlist: README.md");
  });

  it("rejects app references, lifecycle hooks, and review material from staging packages", async () => {
    const fixture = await copyPackageFixture();
    const pluginPath = path.join(fixture, "plugin.json");
    const plugin = JSON.parse(await readFile(pluginPath, "utf8")) as {
      extensions: { "com.openai": Record<string, unknown> };
    };
    plugin.extensions["com.openai"].apps = "./.app.json";
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

    await expect(createPluginArchive(fixture)).rejects.toThrow("OpenAI apps metadata is not permitted");
  });

  it("rejects manifest references to source-only files omitted from the final ZIP", async () => {
    const fixture = await copyPackageFixture();
    const pluginPath = path.join(fixture, "plugin.json");
    const plugin = JSON.parse(await readFile(pluginPath, "utf8")) as {
      extensions: { "com.openai": { onboardingSkill: string } };
    };
    plugin.extensions["com.openai"].onboardingSkill = "./schemas/1.0.0/README.md";
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

    await expect(createPluginArchive(fixture)).rejects.toThrow(
      "onboardingSkill references a source file omitted from the plugin archive: ./schemas/1.0.0/README.md",
    );
  });

  it("rejects an onboarding reference to a different valid archived skill", async () => {
    const fixture = await copyPackageFixture();
    const pluginPath = path.join(fixture, "plugin.json");
    const plugin = JSON.parse(await readFile(pluginPath, "utf8")) as {
      extensions: { "com.openai": { onboardingSkill: string } };
    };
    plugin.extensions["com.openai"].onboardingSkill = "./skills/checking/SKILL.md";
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

    await expect(createPluginArchive(fixture)).rejects.toThrow(
      "onboardingSkill must reference ./skills/setup/SKILL.md",
    );
  });

  it("rejects symlinks instead of following paths outside the plugin root", async () => {
    const fixture = await copyPackageFixture();
    const outside = path.join(path.dirname(fixture), `${path.basename(fixture)}-outside.txt`);
    await writeFile(outside, "not part of the plugin\n");
    await symlink(outside, path.join(fixture, "assets/outside.svg"));

    await expect(createPluginArchive(fixture)).rejects.toThrow("Symbolic links are not allowed");
    await rm(outside, { force: true });
  });

  it("rejects credential headers and package references that escape the root", async () => {
    const fixture = await copyPackageFixture();
    const mcpPath = path.join(fixture, "mcp.json");
    const mcp = JSON.parse(await readFile(mcpPath, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    mcp.mcpServers["eat-or-yeet"]!["headers"] = { Authorization: "Bearer test-token" };
    await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);
    await expect(createPluginArchive(fixture)).rejects.toThrow("must not contain credentials, headers");
    delete mcp.mcpServers["eat-or-yeet"]!["headers"];
    await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

    const pluginPath = path.join(fixture, "plugin.json");
    const plugin = JSON.parse(await readFile(pluginPath, "utf8")) as {
      extensions: { "com.openai": { onboardingSkill: string } };
    };
    plugin.extensions["com.openai"].onboardingSkill = "./../../outside/SKILL.md";
    await writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);
    await expect(createPluginArchive(fixture)).rejects.toThrow("contains an unsafe path");
  });

  it("rejects credential-like text in packaged instructions", async () => {
    const fixture = await copyPackageFixture();
    const skillPath = path.join(fixture, "skills/checking/SKILL.md");
    await writeFile(skillPath, `${await readFile(skillPath, "utf8")}\nBearer 01234567890123456789012345\n`);

    await expect(createPluginArchive(fixture)).rejects.toThrow("Credential-like material found");
  });

  it("scans UTF-8 SVG comments for credentials while accepting the current brand SVG", async () => {
    await expect(createPluginArchive()).resolves.toBeInstanceOf(Buffer);

    const fixture = await copyPackageFixture();
    const iconPath = path.join(fixture, "assets/icon.svg");
    await writeFile(iconPath, '<svg xmlns="http://www.w3.org/2000/svg"><!-- Authorization: Bearer 01234567890123456789012345 --></svg>\n');

    await expect(createPluginArchive(fixture)).rejects.toThrow("Credential-like material found in assets/icon.svg");
  });
});
