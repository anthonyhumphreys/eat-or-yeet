import { Check, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getPublicShare } from "@/db/queries";
import { Button } from "@/components/ui/button";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const share = await getPublicShare(id);
  if (!share) return { title: "Verdict not found", robots: { index: false, follow: false } };
  return { title: `${share.verdict.replace("_", " ")} verdict`, description: share.reason, robots: { index: false, follow: true } };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await getPublicShare(id);
  if (!share) notFound();
  const isEat = share.verdict === "EAT";
  const isYeet = share.verdict === "YEET";
  const className = isEat ? "bg-eat-soft text-eat" : isYeet ? "bg-yeet-soft text-yeet" : "bg-maybe-soft text-maybe";
  const Icon = isEat ? Check : TriangleAlert;
  return (
    <div className="page-shell grid flex-1 place-items-center py-12">
      <div className="w-full max-w-2xl">
        <section className={`rounded-xl p-7 sm:p-10 ${className}`}>
          <div className="flex items-center justify-between font-black"><span>EAT OR YEET</span><Icon className="size-8" aria-hidden /></div>
          <h1 className="mt-16 text-6xl font-black leading-[.85] tracking-[-0.04em] sm:text-8xl">{share.verdict.replace("_", " ")}</h1>
          {share.productName ? <p className="mt-6 text-xl font-bold text-foreground">{share.productName}</p> : null}
          <p className="mt-3 max-w-xl leading-7 text-foreground/75">{share.reason}</p>
        </section>
        {isEat ? <p className="mt-4 text-sm leading-6 text-muted-foreground">No matching current warning found is not a guarantee that food is safe. Follow storage, date, and official food-safety advice.</p> : null}
        <Button asChild size="lg" className="tactile mt-7 w-full rounded-full"><Link href="/scan">Scan your food</Link></Button>
      </div>
    </div>
  );
}
