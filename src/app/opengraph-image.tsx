import { ImageResponse } from "next/og";

export const alt = "Eat or Yeet. Scan it. Check it. Eat it or yeet it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "white", color: "#1d2115", padding: 72 }}>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>EAT OR YEET</div>
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 112, fontWeight: 900, letterSpacing: "-6px" }}>Eat or Yeet?</div><div style={{ marginTop: 22, fontSize: 42 }}>Scan it. Check it. Eat it or yeet it.</div></div>
      <div style={{ width: 180, height: 16, background: "#71852f" }} />
    </div>,
    size,
  );
}
