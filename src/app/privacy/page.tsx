import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <article className="page-shell max-w-3xl py-10 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Privacy</h1>
      <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">A barcode or label detail is used to check published food-safety warnings. You do not need an account.</p>
      <div className="mt-9 space-y-7 leading-7 text-muted-foreground">
        <section><h2 className="text-xl font-bold text-foreground">Details used for a check</h2><p className="mt-2">Barcode numbers and any label details you enter are sent to the service to compare against official warning data. Barcode lookups may also use Open Food Facts for product name and brand details. Product metadata does not decide a warning match.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">No scan history</h2><p className="mt-2">We do not create user accounts or store a history of individual checks. A signed anonymous browser identifier helps enforce rate limits. It does not contain your name or email address.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Public links are optional</h2><p className="mt-2">If you create a public link, it is available for 24 hours. It contains a generic result, the check date, covered region, and an official warning reference when one matched. It does not include the barcode, batch code, or label details you entered.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Location preference</h2><p className="mt-2">Your UK or US warning location is saved in a browser cookie for one year. This is a preference you choose, not your device location. The scanner and manual checks use the same selection.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">News links</h2><p className="mt-2">The service fetches food-safety headlines from publisher feeds. Opening a news link takes you to the publisher website, where its privacy policy applies.</p></section>
        <section><h2 className="text-xl font-bold text-foreground">Warning data</h2><p className="mt-2">Results compare the information you provide with published data from the selected official food-safety sources. A missing match does not tell you whether food is safe to eat.</p></section>
      </div>
    </article>
  );
}
