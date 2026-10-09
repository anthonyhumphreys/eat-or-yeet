import { ImageResponse } from "next/og";

import { brandColors, logoDataUri } from "@/lib/brand/logo";

export const alt = "Eat or Yeet. Official food recalls from the UK and US, in one place.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: brandColors.cream, color: brandColors.ink, padding: 72 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 22, background: brandColors.marigold }}>
          <img src={logoDataUri({ mark: brandColors.ink, cut: brandColors.marigold })} width={62} height={62} alt="" />
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 900, letterSpacing: "-1px" }}>Eat or Yeet</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 86, fontWeight: 900, letterSpacing: "-4px", lineHeight: 1.02 }}>Food recalls, in one place.</div>
        <div style={{ marginTop: 24, maxWidth: 960, fontSize: 38, lineHeight: 1.25, color: "#4a443b" }}>Every active recall and allergy alert from the FSA, FDA and USDA, newest first.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#6b6358" }}>
        <div style={{ display: "flex", width: 40, height: 8, borderRadius: 4, background: brandColors.marigold }} />
        A missing match does not tell you whether food is safe to eat.
      </div>
    </div>,
    size,
  );
}
