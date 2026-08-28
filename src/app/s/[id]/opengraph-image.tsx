import { ImageResponse } from "next/og";

import { getPublicShare } from "@/db/queries";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await getPublicShare(id);
  const verdict = share?.verdict.replace("_", " ") ?? "NO VERDICT";
  const palette = verdict === "EAT" ? ["#edf8e9", "#276133"] : verdict === "YEET" ? ["#fff1ef", "#991f18"] : ["#fff7dd", "#8a5700"];
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 70, background: palette[0], color: palette[1] }}>
      <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>EAT OR YEET</div>
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: verdict.length > 8 ? 86 : 128, fontWeight: 900, letterSpacing: "-5px" }}>{verdict}</div>{share?.productName ? <div style={{ marginTop: 20, fontSize: 38, color: "#201f18" }}>{share.productName}</div> : null}<div style={{ marginTop: 18, maxWidth: 950, fontSize: 27, color: "#514f47" }}>{share?.reason ?? "This share link has expired."}</div></div>
      <div style={{ display: "flex", fontSize: 24 }}>Scan it. Check it. Eat it or yeet it.</div>
    </div>, size,
  );
}
