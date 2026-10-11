import { readFile } from "node:fs/promises";
import path from "node:path";

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { archiveGrokBotPackage, createGrokBotPackage } from "../scripts/package-grok-bot-plugin";
import { pluginRoot } from "../scripts/package-plugin";

describe("Grok Bot distribution", () => {
  it("exports only the standalone plugin with a native manifest and anonymous connection", async () => {
    const archive = archiveGrokBotPackage(await createGrokBotPackage());
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual([
      "eat-or-yeet/.cursor-plugin/plugin.json",
      "eat-or-yeet/LICENSE",
      "eat-or-yeet/README.md",
      "eat-or-yeet/assets/icon.svg",
      "eat-or-yeet/mcp.json",
      "eat-or-yeet/skills/checking/SKILL.md",
      "eat-or-yeet/skills/setup/SKILL.md",
    ]);
    const manifest = JSON.parse(Buffer.from(files["eat-or-yeet/.cursor-plugin/plugin.json"]).toString("utf8"));
    expect(manifest).toMatchObject({
      name: "eat-or-yeet",
      author: { name: "Lexio Apps Ltd.", email: "anthony@lexio.app" },
      license: "MIT",
      logo: "assets/icon.svg",
      repository: "https://github.com/anthonyhumphreys/eat-or-yeet",
    });
    for (const forbidden of ["extensions", "apps", "hooks"]) {
      expect(manifest).not.toHaveProperty(forbidden);
    }
    expect(files[`eat-or-yeet/${manifest.logo}`]).toBeDefined();
    expect(JSON.parse(Buffer.from(files["eat-or-yeet/mcp.json"]).toString("utf8"))).toEqual({
      mcpServers: { "eat-or-yeet": { url: "https://www.eatoryeet.app/mcp" } },
    });
    for (const skill of ["checking", "setup"]) {
      expect(Buffer.from(files[`eat-or-yeet/skills/${skill}/SKILL.md`])).toEqual(
        await readFile(path.join(pluginRoot, `skills/${skill}/SKILL.md`)),
      );
    }
  });

  it("produces reproducible archives including the hidden manifest", async () => {
    expect(archiveGrokBotPackage(await createGrokBotPackage())).toEqual(
      archiveGrokBotPackage(await createGrokBotPackage()),
    );
  });
});
