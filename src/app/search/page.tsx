import type { Metadata } from "next";

import { ManualSearch } from "@/components/search/manual-search";

export const metadata: Metadata = { title: "Search food warnings" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const initialMode = params.mode === "details" ? "details" : "barcode";
  return <div className="page-shell max-w-3xl py-8 sm:py-10"><ManualSearch initialMode={initialMode} /></div>;
}
