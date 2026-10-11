import type { Metadata } from "next";
import Link from "next/link";

import { getNotionSetupOrigin, notionTemplateUrl } from "@/lib/integrations/notion-installation";
import { NotionConnectControls } from "@/components/notion-connect-controls";

export const metadata: Metadata = {
  title: "Notion shopping list",
  description: "Get the Eat or Yeet shopping-list template and learn how connected food-warning reviews work.",
};

const linkClass = "inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const oauthErrors: Record<string, string> = {
  cancelled: "You cancelled this Notion setup. Any existing connection is unchanged. Try again when you are ready.",
  expired: "This setup link expired or has already been used. Start again to connect your list.",
  setup_unavailable: "We could not connect your list. Try again in a few minutes. If it still fails, contact support.",
};

export default async function NotionInstallationPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const ready = Boolean(getNotionSetupOrigin());

  return (
    <div className="page-shell w-full py-8 sm:py-14">
      <div className="mx-auto max-w-[72ch]">
        <Link className={linkClass} href="/integrations#notion">Back to integrations</Link>
        <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-[-0.035em] text-balance sm:text-5xl">Your Notion shopping list</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">Keep your shopping items in Notion. Connect the list to review items against published food warnings for UK or US.</p>
        {oauthErrors[errorCode] && <div className="mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 leading-6" role="alert"><p>{oauthErrors[errorCode]}</p>{errorCode === "setup_unavailable" && <Link className={linkClass} href="/support">Get setup help</Link>}</div>}

        {ready ? (
          <section className="mt-8" aria-labelledby="connect-list">
            <h2 id="connect-list" className="text-2xl font-black tracking-tight">Connect your list</h2>
            <ol className="mt-4 list-decimal space-y-3 pl-6 leading-7 text-muted-foreground">
              <li>Choose the warning country below, then select Add to Notion.</li>
              <li>Approve access in Notion and choose the Eat or Yeet template. This creates your connected shopping list.</li>
              <li>Wait for the management page to show Reviews active, then open Shopping list in Notion and add an item.</li>
            </ol>
            <NotionConnectControls />
          </section>
        ) : (
          <section className="mt-8 rounded-xl bg-muted/35 p-5 sm:p-6" aria-labelledby="template-ready">
            <h2 id="template-ready" className="text-xl font-bold">Get the template now</h2>
            <p className="mt-2 leading-7 text-muted-foreground">Automatic reviews are still being set up. You can use the shopping list now; copying it does not connect it to Eat or Yeet.</p>
            <ol className="mt-4 list-decimal space-y-3 pl-6 leading-7 text-muted-foreground">
              <li>Open the template and choose Duplicate.</li>
              <li>Open Shopping list and add your items. Leave unknown packet details empty.</li>
              <li>Tick Bought after buying an item.</li>
            </ol>
            <a className={`${linkClass} mt-3`} href={notionTemplateUrl}>Get the Notion template</a>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Until reviews are available, <Link className={linkClass} href="/search">check your packet on this site</Link>.</p>
          </section>
        )}

        <section className="mt-12 border-t pt-8" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-2xl font-black tracking-tight">How connected reviews work</h2>
          <ul className="mt-5 space-y-4 leading-7 text-muted-foreground">
            <li><strong className="text-foreground">Add or change an unbought item.</strong> A review starts when you edit the item, brand, barcode or supported packet details. Results may take a few minutes.</li>
            <li><strong className="text-foreground">Read the result beside the row.</strong> Review status, Related warnings and Reviewed at tell you what was found and when it was checked. Bought items are skipped.</li>
            <li><strong className="text-foreground">Compare any warning with your packet.</strong> A broad item such as milk can match several products or batches. Open the official notice and check its product, batch and dates.</li>
          </ul>
          <p className="mt-5 leading-7 text-muted-foreground">“No related warnings found in covered data” does not mean food is safe. Missing or stale source coverage shows “Unable to review”.</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Reviews run when items change. They do not watch for future recalls or send notifications. Daily review limits may delay results; the management page shows when pending reviews can retry.</p>
        </section>

        <section className="mt-10 border-t pt-8" aria-labelledby="notion-requirements">
          <h2 id="notion-requirements" className="text-2xl font-black tracking-tight">You control the connection</h2>
          <p className="mt-3 leading-7 text-muted-foreground">No Notion AI subscription or API token is needed. Eat or Yeet reads the connected list&apos;s packet fields and writes its review fields. Connection credentials are encrypted.</p>
          <p className="mt-3 leading-7 text-muted-foreground">Use the management page to pause reviews, change country or disconnect. Your shopping list stays in Notion when you disconnect.</p>
          <Link className={`${linkClass} mt-3`} href="/integrations/notion/manage">Manage a connected list</Link>
          <p className="mt-2 text-sm leading-6 text-muted-foreground"><Link className={linkClass} href="/privacy">How connected-list data is handled</Link></p>
        </section>
      </div>
    </div>
  );
}
