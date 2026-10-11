import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with Eat or Yeet product checks, AI connections and Notion shopping lists.",
};

export default function SupportPage() {
  return (
    <article className="page-shell max-w-3xl py-10 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Support</h1>
      <p className="mt-4 text-lg leading-8 text-muted-foreground">Need help with Eat or Yeet, an AI connection or your Notion shopping list?</p>
      <a className="mt-5 inline-flex min-h-11 items-center break-all rounded-sm font-semibold underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="mailto:anthony@lexio.app">Email anthony@lexio.app</a>
      <div className="mt-7 space-y-5 leading-7 text-muted-foreground">
        <p>Tell us which app you are using, whether you chose UK or US, and what happened. Include any error message. Please leave out passwords, connection keys and private workspace content.</p>
        <p>For setup instructions, visit <Link className="rounded-sm font-semibold underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" href="/integrations">Integrations</Link>.</p>
        <p>Eat or Yeet compares packet details with published food warnings. A missing match does not prove that food is safe. Read any related official notice and compare it with your product and batch.</p>
      </div>
    </article>
  );
}
