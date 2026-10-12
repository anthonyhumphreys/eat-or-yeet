import type { Metadata } from "next";
import Link from "next/link";

import { getNotionSetupOrigin, notionTemplateUrl } from "@/lib/integrations/notion-installation";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Install Eat or Yeet in ChatGPT, connect a Notion shopping list, or use OpenClaw, Hermes and other assistants to check published UK and US food warnings.",
};

const mcpUrl = "https://www.eatoryeet.app/mcp";
const chatgptPluginUrl = "https://chatgpt.com/plugins/plugin_asdk_app_6acb7e8271548191a8ffc8c209438357";
const linkClass = "inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const stepsClass = "mt-4 list-decimal space-y-3 pl-6 leading-7 text-muted-foreground";
const promptClass = "mt-4 rounded-xl bg-muted/35 p-4 leading-7";
const summaryClass = "cursor-pointer rounded-sm py-3 font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const sectionClass = "mt-10 scroll-mt-24 border-t pt-8";

export default function IntegrationsPage() {
  const notionReady = Boolean(getNotionSetupOrigin());

  return (
    <div className="page-shell w-full py-8 sm:py-14">
      <div className="mx-auto max-w-[72ch]">
        <h1 className="text-4xl font-black leading-tight tracking-tight text-balance sm:text-5xl">Integrations</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          Check food warnings in your AI assistant, or keep a shopping list in Notion. Choose your app below to get started.
        </p>
        <p className="mt-3 leading-7 text-muted-foreground">Eat or Yeet&apos;s public food checks are free and need no account or API key. Your assistant&apos;s own plan or workspace rules may apply.</p>
        <nav aria-label="Integration guides" className="mt-6 flex flex-wrap gap-x-6 gap-y-1">
          <a className={linkClass} href="#chatgpt">ChatGPT</a>
          <a className={linkClass} href="#notion">Notion</a>
          <a className={linkClass} href="#openclaw">OpenClaw</a>
          <a className={linkClass} href="#hermes">Hermes</a>
          <a className={linkClass} href="#other-tools">Other assistants</a>
        </nav>

        <section aria-labelledby="first-check" className="mt-8 rounded-xl bg-muted/35 p-5 sm:p-6">
          <h2 id="first-check" className="text-xl font-bold">Once connected, try a check</h2>
          <blockquote className="mt-3 leading-7">“Use Eat or Yeet to check barcode 044000061494 against US food warnings. Show the source coverage and explain the result.”</blockquote>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Replace the example with your barcode and choose UK or US. You can give a product name, brand and batch instead. Leave details you don&apos;t know empty.</p>
        </section>

        <section id="chatgpt" aria-labelledby="chatgpt-title" className={sectionClass}>
          <h2 id="chatgpt-title" className="text-2xl font-black tracking-tight">ChatGPT</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Install the Eat or Yeet plugin to check a packet, search food warnings or ask which official sources cover your country.</p>
          <a className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-bold text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href={chatgptPluginUrl}>Install in ChatGPT</a>
          <ol className={stepsClass}>
            <li>Open the plugin page, sign in to ChatGPT and select <strong className="text-foreground">Install plugin</strong>. Follow any setup prompts.</li>
            <li>Start a new chat. Type <strong className="text-foreground">@Eat or Yeet</strong> in the message box and select the plugin from the menu.</li>
            <li>Send the example above with your barcode and UK or US. Add a brand, batch or date from the packet if you know it.</li>
          </ol>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">You need a ChatGPT account, but no separate Eat or Yeet account or API key. If the plugin is unavailable in your workspace, <Link className={linkClass} href="/search">check a product on this site</Link>.</p>
          <a className={`${linkClass} mt-2`} href="https://learn.chatgpt.com/docs/plugins">ChatGPT plugin help</a>
        </section>

        <section id="notion" aria-labelledby="notion-title" className={sectionClass}>
          <h2 id="notion-title" className="text-2xl font-black tracking-tight">Notion shopping list</h2>
          <p className="mt-3 leading-7 text-muted-foreground">{notionReady ? "Connect a list to review items against published food warnings in your chosen country." : "The template is available now. Automatic warning reviews are still being set up."}</p>
          <ol className={stepsClass}>
            <li>{notionReady ? <>Open <Link className={linkClass} href="/integrations/notion">Notion setup</Link> and choose UK or US.</> : <>Open the template and choose <strong className="text-foreground">Duplicate</strong> to add it to your workspace.</>}</li>
            <li>{notionReady ? "Approve access in Notion and choose the Eat or Yeet template to create your connected list." : "Open Shopping list and add an item. Add a brand, barcode or packet details if you know them."}</li>
            <li>{notionReady ? "Add or edit an item. Leave Bought unticked to have it reviewed; results appear beside the row." : "Leave Bought unticked while the item is on your list. Tick it after buying it."}</li>
          </ol>
          <Link className={`${linkClass} mt-3`} href={notionReady ? "/integrations/notion" : notionTemplateUrl}>{notionReady ? "Connect a Notion list" : "Get the Notion template"}</Link>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Copying the template alone does not enable reviews. No Notion AI subscription is needed.</p>
          <details className="mt-4 border-y">
            <summary className={summaryClass}>About automatic reviews</summary>
            <p className="pb-3 leading-7 text-muted-foreground">When connected, adding or changing an unbought item starts a review. Review status, Related warnings and Reviewed at appear beside it. Reviews can take a few minutes.</p>
            <p className="pb-3 leading-7 text-muted-foreground">Connecting gives us access to the configured shopping fields and lets us write review results. We store Notion account and list identifiers, encrypted credentials and review state. We do not save your profile name or email address.</p>
            <p className="pb-3 leading-7 text-muted-foreground">Use the management page to pause reviews, change country or disconnect. Your list stays in Notion after disconnecting. Reviews run when items change; they do not watch for future recalls.</p>
            <p className="pb-3 leading-7 text-muted-foreground">Prefer to keep your list unconnected? <Link className={linkClass} href="/search">Check a product on this site</Link> using its barcode or label details. This gives us no access to your Notion account or list. Results stay on the website unless you copy them into Notion yourself.</p>
            <Link className={`${linkClass} mb-2`} href="/integrations/notion">Notion setup and privacy details</Link>
          </details>
        </section>

        <section id="openclaw" aria-labelledby="openclaw-title" className={sectionClass}>
          <h2 id="openclaw-title" className="text-2xl font-black tracking-tight">OpenClaw</h2>
          <ol className={stepsClass}>
            <li>Open the Control UI, then <strong className="text-foreground">Settings → MCP → Add server</strong>.</li>
            <li>Name it eat-or-yeet, choose <strong className="text-foreground">Streamable HTTP</strong> and paste <code className="select-all break-all text-foreground">{mcpUrl}</code>. No authentication or headers are needed.</li>
            <li>Add the server. Start a chat and try the example above.</li>
          </ol>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">These steps follow OpenClaw&apos;s guide. We haven&apos;t tested Eat or Yeet in this app yet.</p>
          <a className={`${linkClass} mt-2`} href="https://docs.openclaw.ai/tools/mcp">OpenClaw connection help</a>
        </section>

        <section id="hermes" aria-labelledby="hermes-title" className={sectionClass}>
          <h2 id="hermes-title" className="text-2xl font-black tracking-tight">Hermes</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Ask Hermes to add Eat or Yeet with this message:</p>
          <p className={promptClass}>“Add Eat or Yeet as a remote HTTP MCP server at https://www.eatoryeet.app/mcp, with no authentication. Keep my existing MCP connections.”</p>
          <p className="mt-3 leading-7 text-muted-foreground">Start a new chat, or use <code className="text-foreground">/reload-mcp</code>, then try the example above.</p>
          <details className="mt-4 border-y">
            <summary className={summaryClass}>Add the Hermes connection yourself</summary>
            <p className="leading-7 text-muted-foreground">In <code>~/.hermes/config.yaml</code>, add this entry inside <code>mcp_servers</code>. Keep your existing servers.</p>
            <pre className="my-4 overflow-x-auto rounded-lg bg-muted/35 p-4 text-sm"><code>{`mcp_servers:
  eat-or-yeet:
    url: "${mcpUrl}"`}</code></pre>
          </details>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">These steps follow Hermes&apos; guide. We haven&apos;t tested Eat or Yeet in this app yet.</p>
          <a className={`${linkClass} mt-2`} href="https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp">Hermes connection help</a>
        </section>

        <section id="other-tools" aria-labelledby="other-tools-title" className={sectionClass}>
          <h2 id="other-tools-title" className="text-2xl font-black tracking-tight">Other assistants</h2>
          <p className="mt-3 leading-7 text-muted-foreground">If your app supports remote MCP servers, use these settings. MCP is the connection format an assistant uses to ask Eat or Yeet for a check.</p>
          <dl className="mt-4 space-y-3 leading-7">
            <div><dt className="font-bold">Server URL</dt><dd><code className="select-all break-all text-sm">{mcpUrl}</code></dd></div>
            <div><dt className="font-bold">Connection type</dt><dd className="text-muted-foreground">Streamable HTTP</dd></div>
            <div><dt className="font-bold">Authentication</dt><dd className="text-muted-foreground">None. Leave API keys and headers empty.</dd></div>
          </dl>
          <details className="mt-4 border-y">
            <summary className={summaryClass}>Coding tools: Codex, Cursor and Gemini CLI</summary>
            <div className="space-y-5 pb-5 leading-7 text-muted-foreground">
              <p>In Codex, run <code className="break-all text-foreground">codex mcp add eat-or-yeet --url {mcpUrl}</code>, then reload it. <a className={linkClass} href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli">Codex setup guide</a></p>
              <p>In Cursor, add a remote MCP server with the URL above, then enable it. <a className={linkClass} href="https://cursor.com/docs/mcp">Cursor setup guide</a></p>
              <p>In Gemini CLI, run <code className="break-all text-foreground">gemini mcp add --transport http eat-or-yeet {mcpUrl}</code>. Use <code>/mcp</code> to check the connection. <a className={linkClass} href="https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html">Gemini CLI setup guide</a></p>
            </div>
          </details>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Compatibility varies by app. If a connection fails, <Link className={linkClass} href="/search">use the web check</Link> or <Link className={linkClass} href="/support">get help</Link>.</p>
        </section>

        <aside aria-label="Understanding your result" className="mt-10 border-t pt-8">
          <h2 className="text-xl font-bold">Read the warning, check the packet</h2>
          <p className="mt-3 leading-7 text-muted-foreground">No matching warning does not prove that food is safe. Check the source coverage and compare any official notice with your product and batch.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">These integrations check food warnings. They do not provide medical advice or monitor future recalls. Your assistant may retain your conversation under its own privacy policy. <Link className={linkClass} href="/privacy">Read our privacy information</Link>.</p>
        </aside>
      </div>
    </div>
  );
}
