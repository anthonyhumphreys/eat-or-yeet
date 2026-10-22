import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchHeader, Marker } from "../../components/ArchFrame";
import { c, clamp, easeOut, mono, sans, snappy } from "../../theme";

const SWIPE_AT = 34;

/** Opening card: the whole pipeline in two lines, over faint construction lines. */
export function ArchIntro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const guides = interpolate(frame, [0, 20], [0, 1], { ...clamp, easing: easeOut });
  const kicker = interpolate(frame, [4, 14], [0, 1], clamp);
  const swipe = interpolate(frame, [SWIPE_AT, SWIPE_AT + 12], [0, 1], { ...clamp, easing: easeOut });
  const sub = spring({ frame: frame - 46, fps, config: snappy });
  const line = { stroke: c.border, strokeWidth: 2, strokeDasharray: "8 12", fill: "none" } as const;
  const lines = ["Official feeds in.", <><Marker swipe={swipe}>Sorted recalls</Marker> out.</>];

  return (
    <AbsoluteFill style={{ background: c.cream, fontFamily: sans, color: c.ink }}>
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: guides }}>
        <g transform={`translate(1500 560) scale(${interpolate(guides, [0, 1], [0.85, 1])}) translate(-1500 -560)`}>
          <circle cx={1500} cy={560} r={330} {...line} />
          <circle cx={1500} cy={560} r={180} {...line} />
          <line x1={0} y1={560} x2={1920} y2={560} {...line} />
          <line x1={1500} y1={140} x2={1500} y2={980} {...line} />
        </g>
      </svg>
      <ArchHeader />
      <div style={{ position: "absolute", left: 112, top: 280 }}>
        <div style={{ fontFamily: mono, fontSize: 28, letterSpacing: "0.08em", color: c.muted, opacity: kicker }}>HOW EAT OR YEET WORKS</div>
        <div style={{ marginTop: 24, fontSize: 150, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 1.04 }}>
          {lines.map((content, i) => {
            const p = spring({ frame: frame - 6 - i * 10, fps, config: { damping: 200 }, durationInFrames: 20 });
            return (
              <div key={i} style={{ overflow: "hidden", padding: "0 24px 18px", margin: "0 -24px -18px" }}>
                <div style={{ transform: `translateY(${(1 - p) * 110}%)` }}>{content}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 48, fontSize: 40, fontWeight: 600, color: c.muted, opacity: sub, transform: `translateY(${(1 - sub) * 24}px)` }}>
          The architecture and integrations behind the UK and US recall list.
        </div>
      </div>
    </AbsoluteFill>
  );
}
