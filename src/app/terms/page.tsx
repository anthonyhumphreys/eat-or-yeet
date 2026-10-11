import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "Terms for using Eat or Yeet and its integrations, provided by Lexio Apps Ltd.",
};

export default function TermsPage() {
  return (
    <article className="page-shell max-w-3xl py-10 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Terms of use</h1>
      <p className="mt-4 text-sm text-muted-foreground">Published 11 October 2026</p>
      <div className="mt-9 space-y-7 leading-7 text-muted-foreground">
        <section>
          <h2 className="text-xl font-bold text-foreground">About Eat or Yeet</h2>
          <p className="mt-2">Eat or Yeet is provided by Lexio Apps Ltd, a company registered in England and Wales with company number 11633419. Our registered office is The Old Court House, Clark Street, Morecambe, England, LA4 5HR. You can contact us at anthony@lexio.app.</p>
          <p className="mt-2">These terms cover the Eat or Yeet website and its integrations, including the ChatGPT plugin and connected Notion shopping lists. By using Eat or Yeet, you agree to these terms.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-foreground">What a check means</h2>
          <p className="mt-2">Eat or Yeet compares the barcode and packet details you supply with published food warnings from the UK or US sources shown in your result. Choose the country relevant to your product and give only details you know. Leave unknown details empty.</p>
          <p className="mt-2">A result showing no matching warning does not prove that food is safe, that it has not been recalled, or that a warning does not exist elsewhere. Results depend on the details supplied and the available source data. Coverage can be incomplete or out of date. A failed check or missing source coverage is inconclusive.</p>
          <p className="mt-2">Read any related official notice and compare the affected product, batch, dates and other details with your packet. Follow the advice in the official notice. Eat or Yeet does not replace advice from a food-safety authority, manufacturer or retailer.</p>
          <p className="mt-2">Eat or Yeet does not provide medical advice, diagnoses or treatment recommendations.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-foreground">AI assistants and Notion</h2>
          <p className="mt-2">An AI assistant may send the product details you provide to Eat or Yeet and summarize the returned information. Check the official source links rather than relying only on the assistant&apos;s wording. Your AI provider&apos;s terms and privacy policy apply to your use of that provider.</p>
          <p className="mt-2">The ChatGPT plugin and other public AI connections provide checks on request. They do not continuously monitor products or create future recall alerts.</p>
          <p className="mt-2">When automatic Notion reviews are available and you connect a list, Eat or Yeet reviews configured items when they change and writes results into the dedicated review fields. Those reviews do not monitor for new recalls after the item has been checked. Copying the Notion template alone does not connect your workspace or enable automatic reviews. You can use it without connecting and submit product details on our website yourself. Those results are not written back to Notion.</p>
          <p className="mt-2">Only connect a Notion workspace and list you are authorized to manage. You can pause or resume reviews or disconnect through the management page. A review already in progress may finish before pausing or disconnecting completes. Pausing keeps the connection and its credentials; disconnecting removes the saved connection and requests revocation of Notion access. Your shopping list and results already written to it stay in Notion.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-foreground">Cost and access</h2>
          <p className="mt-2">Eat or Yeet is currently free to use and does not offer purchases or process payments. A third-party app or AI provider may charge for its own services.</p>
          <p className="mt-2">Service limits, maintenance and failures can prevent a check from completing. Use the relevant official source directly when Eat or Yeet is unavailable or a result is inconclusive.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-foreground">Responsible use and privacy</h2>
          <p className="mt-2">Use Eat or Yeet lawfully. Do not try to access another person&apos;s private information, bypass service limits or interfere with the service.</p>
          <p className="mt-2">Send only the product details needed for a check. Do not include passwords, payment information, medical records or unrelated personal information in product fields.</p>
          <p className="mt-2">Our <Link className="underline underline-offset-4" href="/privacy">privacy information</Link> explains how Eat or Yeet handles check inputs, integration limits, public result links and connected Notion lists. Other services you use have their own data practices.</p>
        </section>
        <section>
          <h2 className="text-xl font-bold text-foreground">Your rights and getting help</h2>
          <p className="mt-2">Nothing in these terms removes or limits your rights under applicable consumer law. Nothing excludes or limits liability for fraud, fraudulent misrepresentation, death or personal injury caused by negligence, or any liability that cannot lawfully be excluded or limited.</p>
          <p className="mt-2">If you have a problem with a check or connection, email anthony@lexio.app. Tell us which app and warning country you used and what happened, without sending passwords or connection keys.</p>
        </section>
      </div>
    </article>
  );
}
