import { interpolate, useCurrentFrame } from "remotion";

import { c, clamp, easeOut } from "../theme";

// Two rough marker strokes forming an X, in normalised [x, y] points (each stroke doubles back).
const STROKES: [number, number][][] = [
  [[0.02, 0.16], [0.3, 0.36], [0.55, 0.54], [0.8, 0.74], [0.98, 0.88], [0.93, 0.8], [0.62, 0.6], [0.34, 0.4], [0.08, 0.24]],
  [[0.9, 0.06], [0.72, 0.3], [0.5, 0.56], [0.28, 0.8], [0.1, 0.96], [0.16, 0.86], [0.42, 0.58], [0.64, 0.34], [0.86, 0.14]],
];

function toPath(points: [number, number][], w: number, h: number) {
  const p = points.map(([x, y]) => [x * w, y * h]);
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2;
    const my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q${p[i][0]} ${p[i][1]} ${mx} ${my}`;
  }
  const last = p[p.length - 1];
  return `${d} L${last[0]} ${last[1]}`;
}

/** Hand-drawn strike-through sized to a `width` × `height` box. Each stroke draws on over `strokeFrames`. */
export function Scribble({ width, height, start, strokeFrames = 7, color = c.marigold, stroke = 18 }: { width: number; height: number; start: number; strokeFrames?: number; color?: string; stroke?: number }) {
  const frame = useCurrentFrame();
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: "50%", top: "50%", marginLeft: -width / 2, marginTop: -height / 2, overflow: "visible" }}>
      {STROKES.map((points, i) => {
        const from = start + i * (strokeFrames + 1);
        const progress = interpolate(frame, [from, from + strokeFrames], [0, 1], { ...clamp, easing: easeOut });
        return (
          <path
            key={i}
            d={toPath(points, width, height)}
            pathLength={1}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 1"
            strokeDashoffset={1 - progress}
            opacity={progress > 0 ? 1 : 0}
          />
        );
      })}
    </svg>
  );
}
