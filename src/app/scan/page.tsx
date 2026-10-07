import type { Metadata } from "next";

import { ScanFlow } from "@/components/scanner/scan-flow";

export const metadata: Metadata = { title: "Scan food", robots: { index: false, follow: false } };

export default function ScanPage() {
  return (
    <div className="page-shell max-w-3xl py-6 sm:py-10">
      <ScanFlow />
    </div>
  );
}
