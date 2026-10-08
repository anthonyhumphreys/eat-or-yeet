import type { Metadata } from "next";

import { ManualSearch } from "@/components/search/manual-search";

export const metadata: Metadata = { title: "Search food warnings" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const initialMode = params.mode === "details" ? "details" : "barcode";
  return <div className="page-shell py-6 sm:py-10"><div className="max-w-2xl"><ManualSearch initialMode={initialMode} /></div></div>;
}
