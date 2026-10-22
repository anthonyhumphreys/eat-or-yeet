import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { LogoTile } from "../components/brand";
import { c, clamp, easeOut, mono, sans } from "../theme";

const WORDS = [
  { text: "Eat", color: c.cream },
  { text: "or", color: c.cream },
  { text: "Yeet", color: c.saffron },
];

/** Scene 2: the brand, set over faint construction lines (after the reference's title card). */
export function Title() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const guides = interpolate(frame, [0, 18], [0, 1], { ...clamp, easing: easeOut });
  const tile = spring({ frame, fps, config: { damping: 12, stiffness: 180 } });
  const label = interpolate(frame, [22, 32], [0, 1], clamp);
  const line = { stroke: c.darkLine, strokeWidth: 2, strokeDasharray: "8 12", fill: "none" } as const;

  return (
    <AbsoluteFill style={{ background: c.charcoal, fontFamily: sans }}>
      <svg width={1920} height={1080} style={{ position: "absolute", opacity: guides }}>
        <g transform={`translate(960 540) scale(${interpolate(guides, [0, 1], [0.85, 1])}) translate(-960 -540)`}>
          <circle cx={430} cy={540} r={250} {...line} />
          <circle cx={1180} cy={540} r={330} {...line} />
          <line x1={0} y1={540} x2={1920} y2={540} {...line} />
          <line x1={430} y1={0} x2={430} y2={1080} {...line} />
          <line x1={1180} y1={120} x2={1180} y2={960} {...line} />
          <line x1={120} y1={180} x2={1800} y2={900} {...line} />
        </g>
      </svg>
      <div style={{ position: "absolute", left: 1180, top: 160, transform: "translateX(-50%)", opacity: label, fontFamily: mono, fontSize: 26, color: c.darkMuted, letterSpacing: "0.04em" }}>food recalls, sorted</div>
      <div style={{ position: "absolute", left: 1180, top: 900, transform: "translateX(-50%)", opacity: label, fontFamily: mono, fontSize: 26, color: c.darkMuted, letterSpacing: "0.04em" }}>UK + US</div>

      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", gap: 72, paddingLeft: 320 }}>
        <LogoTile size={220} style={{ transform: `scale(${tile}) rotate(${interpolate(tile, [0, 1], [-24, 0])}deg)` }} />
        <div style={{ display: "flex", gap: 44, fontSize: 210, fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 1 }}>
          {WORDS.map((word, i) => {
            const p = spring({ frame: frame - 6 - i * 6, fps, config: { damping: 200 }, durationInFrames: 18 });
            return (
              <span key={word.text} style={{ display: "inline-block", overflow: "hidden", paddingBottom: 24, marginBottom: -24 }}>
                <span style={{ display: "inline-block", color: word.color, transform: `translateY(${interpolate(p, [0, 1], [110, 0])}%)` }}>{word.text}</span>
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
