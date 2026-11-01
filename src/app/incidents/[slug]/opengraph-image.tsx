import { ImageResponse } from "next/og";

import { getIncidentBySlug } from "@/db/queries";
import { brandColors, logoDataUri } from "@/lib/brand/logo";
import { classifyHazard } from "@/lib/incidents/hazard";
import { recallName } from "@/lib/incidents/product-name";
import { formatRecallDate } from "@/lib/incidents/recency";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function clip(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// The card people see when a recall link is pasted into a group chat: what, why, what to do, and who says so.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incident = await getIncidentBySlug(slug);
  const hazard = incident ? classifyHazard(incident).label : null;
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 70, background: brandColors.cream, color: brandColors.ink }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 68, height: 68, borderRadius: 18, background: brandColors.marigold }}>
            <img src={logoDataUri({ mark: brandColors.ink, cut: brandColors.marigold })} width={50} height={50} alt="" />
          </div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 900 }}>Eat or Yeet</div>
        </div>
        <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: "#6b6358" }}>{incident?.region ?? ""}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex" }}>
          <div style={{ display: "flex", padding: "8px 20px", borderRadius: 999, background: "#9e1b14", color: "white", fontSize: 28, fontWeight: 800 }}>{hazard ? `${incident?.status === "reported" ? "Published report" : "Recall"} · ${hazard}` : "Recall"}</div>
        </div>
        <div style={{ marginTop: 26, maxWidth: 1060, fontSize: 64, fontWeight: 900, letterSpacing: "-2px", lineHeight: 1.06 }}>{clip(incident ? recallName(incident).product : "Current food recall", 90)}</div>
        {incident?.consumerAdvice ? <div style={{ marginTop: 22, maxWidth: 1000, fontSize: 32, lineHeight: 1.25, color: "#4a443b" }}>{clip(incident.consumerAdvice, 120)}</div> : null}
      </div>
      <div style={{ display: "flex", fontSize: 24, color: "#6b6358" }}>{incident ? `${incident.authority} · ${formatRecallDate(incident.publishedAt)}` : "Official source"}</div>
    </div>, size,
  );
}
