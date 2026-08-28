import type { Metadata } from "next";

import { ScanFlow } from "@/components/scanner/scan-flow";

export const metadata: Metadata = { title: "Scan food", robots: { index: false, follow: false } };

export default async function ScanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const initialMode = params.mode === "photo" ? "photo" : "barcode";
  return (
    <div className="page-shell max-w-3xl py-6 sm:py-10">
      <ScanFlow initialMode={initialMode} />
    </div>
  );
}
