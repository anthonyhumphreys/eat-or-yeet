import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Use Eat or Yeet with Grok Bot, OpenClaw, Meta Muse, Hermes, ChatGPT and Notion. Follow simple setup steps to check published UK and US food warnings.",
};

const mcpUrl = "https://www.eatoryeet.app/mcp";
const templateUrl = "https://carnelian-airedale-eb7.notion.site/Eat-or-Yeet-shopping-list-3f57b822339680b99d06f6c687dd87e8";
const linkClass = "inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const stepsClass = "mt-4 list-decimal space-y-3 pl-6 leading-7 text-muted-foreground";
const promptClass = "mt-4 rounded-xl border bg-muted/35 p-4 leading-7";
const summaryClass = "cursor-pointer rounded-sm py-3 font-bold focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export default function IntegrationsPage() {
  return (
    <div className="page-shell w-full py-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-bold text-muted-foreground">Eat or Yeet where you need it</p>
        <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight sm:text-5xl">Integrations</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          Check published food warnings from your AI assistant, or start a shopping list in Notion. Choose UK or US and share only the details you can read on the packet.
        </p>
        <nav aria-label="Integration guides" className="mt-6 flex flex-wrap gap-x-6 gap-y-1">
          <a className={linkClass} href="#grok-bot">Grok Bot</a>
          <a className={linkClass} href="#openclaw">OpenClaw</a>
          <a className={linkClass} href="#muse">Meta Muse</a>
          <a className={linkClass} href="#hermes">Hermes</a>
          <a className={linkClass} href="#chatgpt">ChatGPT</a>
          <a className={linkClass} href="#notion">Notion</a>
        </nav>

        <section id="grok-bot" aria-labelledby="grok-bot-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="grok-bot-title" className="text-2xl font-black tracking-tight">Grok Bot</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Use a custom connection while our marketplace listing is being prepared. No Eat or Yeet account or API key is needed.</p>
          <ol className={stepsClass}>
            <li>Download the Eat or Yeet ZIP from the <a className={linkClass} href="https://github.com/anthonyhumphreys/eat-or-yeet-plugin/releases">plugin releases</a>.</li>
            <li>Attach it in a chat with your Bot and send the setup message below.</li>
            <li>Open Connect apps → Your plugins → Private skills and look for setup and checking.</li>
            <li>Choose UK or US once per chat, then ask it to check your barcode or packet details. You can change the region at any time.</li>
          </ol>
          <p className={promptClass}>&quot;Add a custom Remote HTTPS MCP server named eat-or-yeet at https://www.eatoryeet.app/mcp with no authentication or headers. Keep my existing connections. Install the ZIP&apos;s setup and checking SKILL.md files as private skills, preserving their contents. Confirm the connection and four discovered tools.&quot;</p>
          <p className={promptClass}>&quot;Check barcode 044000061494 against US food warnings and show the source coverage.&quot;</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">The custom connection and both private skills were installed in Grok Bot for macOS on 11 October 2026. The app cannot import the marketplace manifest directly. Team administrators may restrict custom connections. The other guides below have not all been tested with Eat or Yeet.</p>
          <a className={`${linkClass} mt-2`} href="https://cursor.com/help/grok-bot/connect-plugins">Grok Bot plugin guide</a>
          <details className="mt-5 rounded-xl border px-5">
            <summary className={summaryClass}>Use the website through your Bot&apos;s browser</summary>
            <ol className={stepsClass}>
              <li>Open a chat with your Bot.</li>
              <li>Tell it to visit Eat or Yeet, choose your country and check your barcode or packet details.</li>
              <li>Read the result and open any related official warning to compare the product and batch.</li>
            </ol>
            <p className={promptClass}>
              &quot;Open https://www.eatoryeet.app/search in your browser. Choose US and check barcode 044000061494. Show me the result, source coverage and any official warning links.&quot;
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Replace US and the example barcode with your country and packet. This browser workflow has not yet been tested in Grok Bot.</p>
            <a className={`${linkClass} mt-2`} href="https://docs.x.ai/grok-bot/computer-and-apps">Grok Bot browser guide</a>
          </details>
          <details className="mt-5 rounded-xl border px-5">
            <summary className={summaryClass}>Using Grok on the web?</summary>
            <ol className={`${stepsClass} mt-1`}>
              <li>Open <a className={linkClass} href="https://grok.com/connectors">Grok connectors</a>.</li>
              <li>Choose New Connector, then Custom. Name it Eat or Yeet and enter <code className="break-all text-foreground">{mcpUrl}</code>. No Eat or Yeet login or API key is needed.</li>
              <li>Start a chat and ask Eat or Yeet to check your product in UK or US.</li>
            </ol>
            <p className="my-4 text-sm leading-6 text-muted-foreground">For work accounts, your administrator may need to enable the connector. This custom connection has not yet been tested in Grok.</p>
            <a className={`${linkClass} mb-2`} href="https://docs.x.ai/grok/connectors">Grok connector guide</a>
          </details>
        </section>

        <section id="openclaw" aria-labelledby="openclaw-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="openclaw-title" className="text-2xl font-black tracking-tight">OpenClaw</h2>
          <ol className={stepsClass}>
            <li>Open the Control UI, then Settings → MCP.</li>
            <li>Under Configured servers, choose Add server. Name it eat-or-yeet and choose Streamable HTTP.</li>
            <li>Enter <code className="break-all text-foreground">{mcpUrl}</code>, leave authentication empty and add the server.</li>
            <li>Start a chat and ask Eat or Yeet to check your packet in UK or US.</li>
          </ol>
          <a className={`${linkClass} mt-2`} href="https://docs.openclaw.ai/tools/mcp">OpenClaw MCP guide</a>
        </section>

        <section id="muse" aria-labelledby="muse-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="muse-title" className="text-2xl font-black tracking-tight">Meta Muse</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Ask Muse to create a custom connector. It will guide you through the setup.</p>
          <p className={promptClass}>&quot;Help me create a custom connector for Eat or Yeet, a remote MCP server at https://www.eatoryeet.app/mcp. It uses Streamable HTTP and needs no authentication. I want to check published UK or US food warnings.&quot;</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Review what Muse proposes before connecting. We have not verified this server in Muse yet. If it requires a sign-in or cannot connect, <Link className={linkClass} href="/search">use Eat or Yeet on the web</Link>. No Eat or Yeet credentials are required.</p>
          <a className={`${linkClass} mt-2`} href="https://www.meta.com/help/artificial-intelligence/1687253048996149/">Meta Muse connector guide</a>
        </section>

        <section id="hermes" aria-labelledby="hermes-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="hermes-title" className="text-2xl font-black tracking-tight">Hermes</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Ask Hermes to add Eat or Yeet to its MCP connections, then start a new chat or use /reload-mcp.</p>
          <p className={promptClass}>&quot;Add Eat or Yeet as a remote HTTP MCP server at https://www.eatoryeet.app/mcp, with no authentication. Keep my existing MCP connections. Then check my product against UK or US food warnings.&quot;</p>
          <details className="mt-5 rounded-xl border px-5">
            <summary className={summaryClass}>Add the connection yourself</summary>
            <p className="leading-7 text-muted-foreground">Add eat-or-yeet inside mcp_servers in ~/.hermes/config.yaml. Keep any existing servers.</p>
            <pre className="my-4 overflow-x-auto rounded-lg bg-muted/35 p-4 text-sm"><code>{`mcp_servers:
  eat-or-yeet:
    url: "${mcpUrl}"`}</code></pre>
          </details>
          <a className={`${linkClass} mt-2`} href="https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp">Hermes MCP guide</a>
        </section>

        <section id="chatgpt" aria-labelledby="chatgpt-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="chatgpt-title" className="text-2xl font-black tracking-tight">ChatGPT plugin</h2>
          <p className="mt-3 leading-7 text-muted-foreground">The Eat or Yeet directory listing is coming soon. You can try a custom connection if your ChatGPT account allows it.</p>
          <ol className={stepsClass}>
            <li>Open <a className={linkClass} href="https://chatgpt.com/plugins">ChatGPT Plugins</a>, choose Add, then Add custom MCP server.</li>
            <li>Name it Eat or Yeet. Enter <code className="break-all text-foreground">{mcpUrl}</code> and choose No authentication.</li>
            <li>Read the connection notice, then choose Create as a plugin and Connect Eat or Yeet.</li>
            <li>Start a new chat. Type @, select Eat or Yeet, and ask it to check your barcode in UK or US.</li>
          </ol>
          <p className={promptClass}>&quot;Check barcode 044000061494 against US food warnings. Show me the source coverage and explain the result.&quot;</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">If Add custom MCP server is missing, your account or workspace may not allow custom connections. You can <Link className={linkClass} href="/search">check your product on this site</Link> instead. This creates a personal connection while the public listing is being prepared.</p>
          <a className={`${linkClass} mt-2`} href="https://developers.openai.com/plugins/deploy/connect-chatgpt">ChatGPT connection guide</a>
        </section>

        <section id="notion" aria-labelledby="notion-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="notion-title" className="text-2xl font-black tracking-tight">Notion shopping list</h2>
          <p className="mt-3 leading-7 text-muted-foreground">The shopping-list template is available now. Automatic warning reviews are still being set up.</p>
          <ol className={stepsClass}>
            <li>Open the template and choose Duplicate to add it to your Notion workspace.</li>
            <li>Open Shopping list and add an item. Enter a brand, barcode or packet details if you know them. Leave unknown fields empty.</li>
            <li>Leave Bought unticked while an item is on your shopping list. Tick it after buying the item.</li>
          </ol>
          <a className={`${linkClass} mt-3`} href={templateUrl}>Get the Notion template</a>
          <details className="mt-5 rounded-xl border px-5">
            <summary className={summaryClass}>How automatic reviews will work</summary>
            <ol className={`${stepsClass} mt-1`}>
              <li>Choose UK or US on the Notion setup page, then select Add to Notion.</li>
              <li>Approve the requested access and add the Eat or Yeet template to your workspace.</li>
              <li>Add or edit an unbought item. Eat or Yeet will write related warnings, the review status and review time beside it.</li>
            </ol>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">Copying the template alone does not enable reviews. No Notion AI subscription is needed. Once connected, use the management page to pause reviews, change country or disconnect. Reviews run when items change; they do not monitor for future recalls.</p>
            <Link className={`${linkClass} my-2`} href="/integrations/notion">About Notion reviews</Link>
          </details>
        </section>

        <section id="other-tools" aria-labelledby="other-tools-title" className="mt-10 scroll-mt-24 border-t pt-8">
          <h2 id="other-tools-title" className="text-2xl font-black tracking-tight">More MCP apps</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Apps that support remote MCP connections can use the same address. MCP is the connection format that lets an assistant ask Eat or Yeet for a check.</p>
          <div className="mt-5 rounded-xl border bg-muted/35 p-5">
            <p className="font-bold">Connection address</p>
            <code className="mt-2 block select-all break-all text-sm">{mcpUrl}</code>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Name: Eat or Yeet. Connection type: Streamable HTTP. Authentication: None. No Eat or Yeet API key is needed for these read-only checks.</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">These setup recipes follow each app&apos;s documentation. They have not yet been tested in every app. If a connection fails, use the website while we check compatibility.</p>
          <details className="mt-5 rounded-xl border px-5">
            <summary className={summaryClass}>Coding tools: Codex, Cursor and Gemini CLI</summary>
            <details className="mt-3 rounded-xl border px-5">
              <summary className={summaryClass}>Codex</summary>
              <p className="leading-7 text-muted-foreground">Run this command in your terminal, then reload Codex and start a new chat.</p>
              <pre className="my-4 overflow-x-auto rounded-lg bg-muted/35 p-4 text-sm"><code>{`codex mcp add eat-or-yeet --url ${mcpUrl}`}</code></pre>
              <a className={`${linkClass} mb-2`} href="https://learn.chatgpt.com/docs/extend/mcp?surface=cli">Codex setup guide</a>
            </details>
            <details className="mt-3 rounded-xl border px-5">
              <summary className={summaryClass}>Cursor</summary>
              <p className="leading-7 text-muted-foreground">Add this connection to ~/.cursor/mcp.json. If that file already has connections, keep them and add Eat or Yeet inside mcpServers. Reload Cursor and enable Eat or Yeet.</p>
              <pre className="my-4 overflow-x-auto rounded-lg bg-muted/35 p-4 text-sm"><code>{JSON.stringify({ mcpServers: { "eat-or-yeet": { url: mcpUrl } } }, null, 2)}</code></pre>
              <a className={`${linkClass} mb-2`} href="https://cursor.com/docs/mcp">Cursor setup guide</a>
            </details>
            <details className="mt-3 rounded-xl border px-5">
              <summary className={summaryClass}>Gemini CLI</summary>
              <p className="leading-7 text-muted-foreground">Run this command in your terminal. Start Gemini and use /mcp to check that Eat or Yeet is connected.</p>
              <pre className="my-4 overflow-x-auto rounded-lg bg-muted/35 p-4 text-sm"><code>{`gemini mcp add --transport http eat-or-yeet ${mcpUrl}`}</code></pre>
              <a className={`${linkClass} mb-2`} href="https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html">Gemini CLI setup guide</a>
            </details>
          </details>
          <p className={promptClass}>&quot;Use Eat or Yeet to check this product in the UK. The item is [product name], the brand is [brand], and the batch code is [code].&quot;</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Replace the bracketed details with what is on your packet, or just give a barcode and country.</p>
        </section>

        <aside aria-label="Understanding your result" className="mt-10 rounded-2xl border p-5 sm:p-6">
          <h2 className="text-xl font-bold">Read the warning, check the packet</h2>
          <p className="mt-3 leading-7 text-muted-foreground">A missing warning match does not prove that food is safe. Check the result&apos;s source coverage and compare any official notice with your product and batch. Eat or Yeet does not provide medical advice.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Your AI provider may keep your conversation and tool results under its own policy. <Link className={linkClass} href="/privacy">Read our privacy information</Link>.</p>
          <Link className={`${linkClass} mt-2`} href="/support">Get help with a connection</Link>
        </aside>
      </div>
    </div>
  );
}
