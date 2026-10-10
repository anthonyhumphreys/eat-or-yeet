import type { Metadata } from "next";
import Link from "next/link";

import { getNotionInstallationOrigin } from "@/lib/integrations/notion-installation";
import { NotionConnectControls } from "@/components/notion-connect-controls";

export const metadata: Metadata = {
  title: "Add to Notion",
  description: "Connect a Notion shopping list to review items against published food warnings.",
};

export default function NotionInstallationPage() {
  const serviceOrigin = getNotionInstallationOrigin();

  return (
    <div className="page-shell w-full py-8 sm:py-14">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-bold text-muted-foreground">Eat or Yeet for Notion</p>
        <h1 className="mt-3 text-4xl font-black leading-[1.05] tracking-[-0.035em] sm:text-5xl">Review shopping items in Notion</h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
          Connect Notion to review shopping-list items against published food warnings for the country you choose.
        </p>

        {serviceOrigin ? (
          <NotionConnectControls serviceOrigin={serviceOrigin} />
        ) : (
          <div className="mt-8 rounded-2xl border bg-muted/35 p-5 sm:p-6">
            <h2 className="text-lg font-bold">Notion setup is not available yet</h2>
            <p className="mt-2 max-w-xl leading-7 text-muted-foreground">
              You can still check current warnings on this site. Visit the <Link className="font-semibold underline underline-offset-4 hover:text-foreground" href="/">Eat or Yeet homepage</Link> to choose a country and see the latest notices.
            </p>
          </div>
        )}

        <section className="mt-12 border-t pt-8 sm:mt-14 sm:pt-10" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-2xl font-black tracking-tight">What happens in your list</h2>
          <ul className="mt-5 space-y-4 text-base leading-7 text-muted-foreground">
            <li><span className="font-semibold text-foreground">Add or edit an item.</span> When reviews are active, Eat or Yeet checks for related published warnings in your chosen country and writes the review status, related warnings and review time beside that row.</li>
            <li><span className="font-semibold text-foreground">Bought it?</span> Mark the row as bought and it will be skipped. Changes to an item, brand, barcode or supported packet details start a fresh review.</li>
            <li><span className="font-semibold text-foreground">Read related warnings carefully.</span> A generic item can match more than one product or batch. Open the official notice and compare it with the packet you have.</li>
            <li><span className="font-semibold text-foreground">Check the packet and official notice.</span> &quot;No related warnings found in covered data&quot; does not establish that food is safe. Missing or stale source coverage shows &quot;Unable to review&quot;.</li>
          </ul>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">Reviews run when items are added or changed. Future-recall monitoring and push notifications are not included.</p>
        </section>

        <section className="mt-10 rounded-2xl border p-5 sm:p-6" aria-labelledby="notion-requirements">
          <h2 id="notion-requirements" className="text-xl font-black tracking-tight">No Notion AI needed</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            Setup asks you to approve access in Notion and add the Eat or Yeet shopping-list template to your workspace. Eat or Yeet hosts the reviews and retains protected connection credentials until you disconnect. You do not need to make API tokens or configure anything yourself.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground"><Link className="font-semibold underline underline-offset-4" href="/privacy">Read how connected-list data is handled</Link>. Use the management link to pause reviews, change country or disconnect.</p>
        </section>
      </div>
    </div>
  );
}
