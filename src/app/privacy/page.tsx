import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="page-shell max-w-3xl py-10 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Privacy, without the mystery meat</h1>
      <div className="mt-8 space-y-7 leading-7 text-muted-foreground">
        <section><h2 className="text-xl font-bold text-foreground">Packaging photos are transient</h2><p className="mt-2">A photo is sent securely to our server and to the configured OpenRouter vision model so visible product information can be extracted. Eat or Yeet does not save the original image. It is discarded after that request finishes.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Scans stay private</h2><p className="mt-2">We do not create user accounts or store a history of individual scans. A signed anonymous browser identifier is used to enforce rate limits. It does not contain your name, email address, or scan contents.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Sharing is opt-in</h2><p className="mt-2">The normal share action sends generic verdict copy. If you explicitly create a public link, we store only the verdict, a short reason, the product name if known, and an incident reference if applicable. We do not include barcodes, batch codes, raw extracted text, or photographs. Public links expire after 30 days.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Product metadata</h2><p className="mt-2">Barcode lookups may use Open Food Facts for non-safety product metadata. Official food-safety sources determine the incident dataset. Open Food Facts never decides a verdict.</p></section>
      </div>
    </article>
  );
}
