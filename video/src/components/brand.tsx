import type { CSSProperties } from "react";
import { Img } from "remotion";

import { logoDataUri } from "../../../src/lib/brand/logo";
import { c } from "../theme";

/** The production shield mark, generated from the app's own logo source. */
export function Logo({ size, mark = c.ink, cut = c.marigold, style }: { size: number; mark?: string; cut?: string; style?: CSSProperties }) {
  return <Img src={logoDataUri({ mark, cut })} style={{ width: size, height: size, display: "block", ...style }} />;
}

export function LogoTile({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.28, background: c.marigold, display: "grid", placeItems: "center", ...style }}>
      <Logo size={size * 0.72} />
    </div>
  );
}

export function TriangleAlert({ size, color = "currentColor" }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function CircleHelp({ size, color = "currentColor" }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function SearchIcon({ size, color = "currentColor" }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.34-4.34" />
    </svg>
  );
}
