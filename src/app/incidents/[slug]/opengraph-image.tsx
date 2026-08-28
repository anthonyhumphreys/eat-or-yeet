import { ImageResponse } from "next/og";

import { getIncidentBySlug } from "@/db/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 70, background: "#fff1ef", color: "#891f17" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30, fontWeight: 800 }}><span>EAT OR YEET</span><span>{incident?.region ?? "WARNING"}</span></div>
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 118, fontWeight: 900, letterSpacing: "-5px" }}>YEET</div><div style={{ marginTop: 24, maxWidth: 1000, fontSize: 37, lineHeight: 1.15, color: "#211815" }}>{incident?.title ?? "Current food-safety warning"}</div></div>
      <div style={{ display: "flex", fontSize: 24, color: "#5b3d38" }}>{incident?.authority ?? "Official source"}</div>
    </div>, size,
  );
}
