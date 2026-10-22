import type { CSSProperties, ReactNode } from "react";

import { c, mono } from "../theme";

export type Pt = readonly [number, number];

const distance = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** The polyline from its start to a fraction `t` of its length. */
function sliceTo(points: readonly Pt[], t: number): Pt[] {
  const total = points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1], points[i]);
    if (remaining <= segment) {
      out.push(lerp(points[i - 1], points[i], segment ? remaining / segment : 0));
      return out;
    }
    out.push(points[i]);
    remaining -= segment;
  }
  return out;
}

const pointAt = (points: readonly Pt[], t: number) => sliceTo(points, t).at(-1)!;
const toPath = (points: readonly Pt[]) => points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

/** A connector that draws on as `progress` goes from 0 to 1. Render inside a full-frame <svg>. */
export function Edge({ points, progress, color = c.muted, width = 3, dashed = false }: { points: readonly Pt[]; progress: number; color?: string; width?: number; dashed?: boolean }) {
  if (progress <= 0) return null;
  return <path d={toPath(sliceTo(points, progress))} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "10 12" : undefined} />;
}

/** Evenly spaced squares looping along a polyline. They grow in and shrink out instead of fading, to keep fills flat. */
export function Packets({ points, frame, start = 0, period = 40, count = 2, color = c.marigold, size = 16 }: { points: readonly Pt[]; frame: number; start?: number; period?: number; count?: number; color?: string; size?: number }) {
  if (frame < start) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const t = ((frame - start) / period + i / count) % 1;
        const [x, y] = pointAt(points, t);
        const s = size * Math.min(1, t * 10, (1 - t) * 10);
        return <rect key={i} x={x - s / 2} y={y - s / 2} width={s} height={s} rx={s * 0.3} fill={color} />;
      })}
    </>
  );
}

/** A labelled box in an architecture diagram. `active` fills it with marigold. */
export function Node({ x, y, w, h, enter = 1, active = false, dark = false, label, title, sub, titleSize = 34, style, children }: {
  x: number;
  y: number;
  w: number;
  h: number;
  enter?: number;
  active?: boolean;
  dark?: boolean;
  label?: string;
  title: ReactNode;
  sub?: ReactNode;
  titleSize?: number;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ink = active || !dark ? c.ink : c.cream;
  const muted = active ? "#5c4300" : dark ? c.darkMuted : c.muted;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: "16px 22px",
        borderRadius: 22,
        background: active ? c.marigold : dark ? c.darkCard : c.card,
        border: `3px solid ${active ? c.marigold : dark ? c.darkSecondary : c.border}`,
        color: ink,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 30}px) scale(${0.94 + enter * 0.06})`,
        ...style,
      }}
    >
      {label ? <div style={{ fontFamily: mono, fontSize: 19, letterSpacing: "0.08em", textTransform: "uppercase", color: muted, marginBottom: 8 }}>{label}</div> : null}
      <div style={{ fontSize: titleSize, fontWeight: 850, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{title}</div>
      {sub ? <div style={{ marginTop: 6, fontSize: 21, lineHeight: 1.3, color: muted }}>{sub}</div> : null}
      {children}
    </div>
  );
}

/** A dashed boundary around a group of nodes, such as one hosting platform. */
export function Group({ x, y, w, h, label, enter = 1, dark = false }: { x: number; y: number; w: number; h: number; label: string; enter?: number; dark?: boolean }) {
  const bg = dark ? c.charcoal : c.cream;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, boxSizing: "border-box", borderRadius: 30, border: `3px dashed ${dark ? "#4a4a50" : "#d8cdb4"}`, opacity: enter, transform: `scale(${0.97 + enter * 0.03})` }}>
      <div style={{ position: "absolute", left: 24, top: -16, padding: "0 12px", background: bg, fontFamily: mono, fontSize: 21, lineHeight: "28px", letterSpacing: "0.1em", color: dark ? c.darkMuted : c.muted }}>{label}</div>
    </div>
  );
}
