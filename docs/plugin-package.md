# Eat or Yeet portable plugin package

The portable package lives in [`plugins/eat-or-yeet/`](../plugins/eat-or-yeet/). It contains an Agent Plugins root manifest, one remote Streamable HTTP MCP configuration, checking and setup skills, and the app-icon SVG. The OpenAI-specific `onboardingSkill` points to the setup skill. The manifest and connection use the Agent Plugins 1.0.0 format.

The configured endpoint is `https://www.eatoryeet.app/mcp`, with no auth headers. Use the canonical `www` hostname: the bare domain returns a cross-origin redirect that MCP clients can refuse. The MCP route remains subject to the server's feature flag and production safeguards. The package build does not call it or prove host compatibility. Do not claim a live host installation, public submission, or marketplace approval until those are separately tested and completed.

## Build and contents

Run `pnpm package:plugin` from the repository root. It writes `dist/eat-or-yeet-plugin.zip` for local review; `/dist/` is gitignored.

The archive has these root-relative entries in bytewise lexical order:

```text
assets/icon.svg
mcp.json
plugin.json
skills/checking/SKILL.md
skills/setup/SKILL.md
```

The builder fixes each ZIP timestamp to 1980-01-01 UTC, normalizes file attributes, sorts paths, validates the package before writing, and rejects symlinks, path escapes, hidden/unexpected files, credential-like content, extra MCP servers, MCP auth headers, and unsupported transport or endpoint changes. It deliberately excludes the vendored schemas and provenance README, repository notes, review attachments, `.app.json`, and lifecycle hooks. Only regular image assets under `assets/` and `SKILL.md` files directly under skill folders are packageable; broaden that allowlist only when a reviewed package component needs it.

The JSON manifests are checked with Ajv 2020 against the vendored canonical schemas in `plugins/eat-or-yeet/schemas/1.0.0/`. Their upstream URLs, Apache-2.0 source notice, and SHA-256 pins are recorded beside the copies. This keeps validation offline and makes schema updates explicit. OpenAI-specific extension fields are separately checked for package-relative references and the expected onboarding path.

The skills require the user to select UK or US, let a barcode alone trigger a check after that choice, and forbid inferring unobserved packet details. They preserve the server's qualified result and coverage, treat incomplete coverage as inconclusive, distinguish warning search from a product verdict, accept declined sharing, and avoid claiming that Eat or Yeet stores a check history or provides ongoing monitoring. They also disclose that the connected host may retain conversation/tool data under its own policy.

## Distribution status

This is a credential-free build artifact, not the public-submission ZIP. OpenAI's current MCP review uses verified publisher identity and listing support, privacy and terms URLs; initial review also requires five positive cases, three negative cases and an accessible walkthrough. Those values must come from the real publisher and completed review materials, not placeholders. Public publishing is a separate authorized action. OpenAI also currently rejects plugin ZIPs containing `.app.json`/registered app references or lifecycle hooks for public submission. See [package format](https://developers.openai.com/plugins/build/plugins) and [submission requirements](https://developers.openai.com/plugins/deploy/submission).

Follow the [publication preparation guide](operators/chatgpt-plugin-publication.md) for the current gaps, draft review cases and publishing steps.

The standard JSON schemas validate portable structure, not every semantic requirement or target-host behavior. Test installation and tool selection in each intended client, and test MCP Apps UI support host by host. No host smoke tests or public submission are represented by this package build.

## Grok Bot distribution

Run `pnpm package:plugin:grok-bot` to export a standalone Cursor-format package to `dist/grok-bot/eat-or-yeet/`, with an archive at `dist/grok-bot/eat-or-yeet-grok-bot.zip` and a SHA-256 sidecar. The ZIP includes the `eat-or-yeet/` directory and its hidden `.cursor-plugin/plugin.json`.

The exporter reuses the validated portable files, preserves both skills and the icon byte-for-byte, and writes a native Cursor manifest with Lexio publisher details and a relative logo reference. It includes the Grok Bot README and the MIT licence approved for this standalone distribution. The application repository is not relicensed. OpenAI-specific metadata, registered App bindings, schemas and application code are not exported. The existing portable source and the ChatGPT submission are not changed.

The export directory must not already exist. Move an earlier export aside before rebuilding; this prevents stale files or local edits from silently entering a release. The command prepares local files only. It does not create a repository, install a plugin, submit a listing or deploy the service.

See [Grok Bot publication preparation](operators/grok-bot-plugin-publication.md) for the test cases, listing copy and remaining publication steps.
