import { ImageResponse } from "next/og";

import { brandColors, logoDataUri } from "@/lib/brand/logo";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

// The header tile at icon size: an ink shield on marigold, with the spoon and fork cut out of it.
export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: brandColors.marigold }}>
      <img src={logoDataUri({ mark: brandColors.ink, cut: brandColors.marigold })} width={140} height={140} alt="" />
    </div>,
    size,
  );
}
