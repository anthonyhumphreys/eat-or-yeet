import type { CSSProperties, ReactNode } from "react";
import { interpolate } from "remotion";

import { c } from "../theme";
import { LogoTile } from "./brand";

export const SCREEN = { width: 430, height: 900 };

export function Phone({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ padding: 14, borderRadius: 74, background: "#0b0b0d", boxShadow: `0 0 0 3px #2c2c31`, ...style }}>
      <div style={{ position: "relative", width: SCREEN.width, height: SCREEN.height, borderRadius: 60, overflow: "hidden", background: c.cream }}>
        <div style={{ position: "absolute", top: 14, left: "50%", width: 120, height: 34, marginLeft: -60, borderRadius: 20, background: "#0b0b0d", zIndex: 2 }} />
        {children}
      </div>
    </div>
  );
}

/** The app header: logo tile, region select and the marigold "Check" button. */
export function PhoneHeader() {
  return (
    <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 12, padding: "70px 22px 18px", background: c.cream }}>
      <LogoTile size={50} />
      <div style={{ flex: 1 }} />
      <div style={{ padding: "9px 18px", borderRadius: 30, border: `2px solid ${c.border}`, background: c.secondary, fontSize: 17, fontWeight: 700, color: c.ink }}>UK</div>
      <div style={{ padding: "11px 22px", borderRadius: 30, background: c.marigold, fontSize: 18, fontWeight: 800, color: c.ink }}>Check</div>
    </div>
  );
}

/** A tap: a soft ink circle that grows and fades, centred on its parent. */
export function Tap({ at, frame }: { at: number; frame: number }) {
  const t = frame - at;
  if (t < 0 || t > 12) return null;
  const size = interpolate(t, [0, 12], [30, 90]);
  return <div style={{ position: "absolute", left: "50%", top: "50%", width: size, height: size, margin: -size / 2, borderRadius: size, background: c.ink, opacity: interpolate(t, [0, 3, 12], [0, 0.22, 0]), pointerEvents: "none" }} />;
}

/** Deterministic EAN-style bars derived from the digits, so every render is identical. */
export function Barcode({ digits, width, height }: { digits: string; width: number; height: number }) {
  const pattern: number[] = [1, 1, 1];
  for (const [i, ch] of [...digits].entries()) {
    const n = Number(ch);
    pattern.push(((n + i) % 3) + 1, ((n * 7 + i) % 3) + 1, ((n * 3 + 1) % 2) + 1, ((n + 2 * i) % 4) + 1);
    if (i === 6) pattern.push(1, 1, 1, 1, 1);
  }
  pattern.push(1, 1, 1);
  const total = pattern.reduce((sum, w) => sum + w, 0);
  let x = 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${total} 100`} preserveAspectRatio="none">
      {pattern.map((w, i) => {
        const rect = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={100} fill={c.ink} /> : null;
        x += w;
        return rect;
      })}
    </svg>
  );
}
