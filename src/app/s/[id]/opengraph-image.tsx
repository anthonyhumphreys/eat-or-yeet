import { ImageResponse } from "next/og";

import { getPublicShare } from "@/db/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const headlines = {
  EAT: "No matching warning found",
  YEET: "Warning match found",
  MAYBE_YEET: "Possible warning match",
  NO_CLUE: "Not enough details",
} as const;

function formatDate(value: Date | null): string | null {
  if (!value) return null;
  return Number.isNaN(value.valueOf()) ? null : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(value);
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await getPublicShare(id);
  const verdict = share?.verdict === "EAT" || share?.verdict === "YEET" || share?.verdict === "MAYBE_YEET" || share?.verdict === "NO_CLUE" ? share.verdict : "NO_CLUE";
  const headline = headlines[verdict];
  const palette = verdict === "YEET" || verdict === "MAYBE_YEET" ? ["#fff1ef", "#991f18"] : ["#f7f6ef", "#24271a"];
  const hasCoverage = Boolean(share?.checkedAt);
  const details = hasCoverage
    ? `${formatDate(share?.checkedAt ?? null) ?? "Date unavailable"} · ${share?.datasetRegions.length ? share.datasetRegions.join(" + ") : "coverage unknown"}`
    : "Historical result · check date and coverage unknown";

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 70, background: palette[0], color: palette[1] }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>EAT OR YEET · PUBLISHED WARNING CHECK</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: headline.length > 23 ? 82 : 112, fontWeight: 900, letterSpacing: "-4px" }}>{headline}</div>
        {hasCoverage && share?.productName ? <div style={{ marginTop: 18, fontSize: 32 }}>{share.productName}</div> : null}
        <div style={{ marginTop: 18, fontSize: 26, color: "#514f47" }}>{details}</div>
        {verdict === "EAT" ? <div style={{ marginTop: 14, fontSize: 23, color: "#514f47" }}>This checks published warnings, not whether food is safe to eat.</div> : null}
      </div>
      <div style={{ display: "flex", fontSize: 24 }}>Check published warnings at Eat or Yeet</div>
    </div>, size,
  );
}
