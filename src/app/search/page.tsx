import type { Metadata } from "next";

import { ManualSearch } from "@/components/search/manual-search";

export const metadata: Metadata = { title: "Search food warnings" };

export default function SearchPage() {
  return <div className="page-shell max-w-3xl py-10"><ManualSearch /></div>;
}
