import { ImageResponse } from "next/og";

export const alt = "Eat or Yeet. Check food against published safety warnings.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "white", color: "#1d2115", padding: 72 }}>
      <div style={{ display: "flex", fontSize: 34, fontWeight: 800 }}>EAT OR YEET</div>
      <div style={{ display: "flex", flexDirection: "column" }}><div style={{ fontSize: 82, fontWeight: 900, letterSpacing: "-4px" }}>Check food warnings</div><div style={{ marginTop: 22, maxWidth: 920, fontSize: 40, lineHeight: 1.2 }}>Compare a barcode or label with published official warnings.</div></div>
      <div style={{ display: "flex", fontSize: 23, color: "#57584e" }}>A missing match does not tell you whether food is safe to eat.</div>
    </div>,
    size,
  );
}
