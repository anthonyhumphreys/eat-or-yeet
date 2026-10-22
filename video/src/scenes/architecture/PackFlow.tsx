import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { c, clamp, easeOut, mono, snappy } from "../../theme";

const STEPS = [
  { title: "Scan or type", text: "Native barcode detection, with a ZXing fallback." },
  { title: "Look up", text: "Open Food Facts can supply a name and brand." },
  { title: "Match", text: "Deterministic rules compare barcode, batch and dates within one product group." },
  { title: "Explain", text: "The result shows its evidence, coverage and official advice." },
];
const NOS = ["No AI", "No photo uploads", "No scan history"];
const CARD = { top: 500, width: 400, height: 320, step: 432 };
const LINE_Y = 466;

/** Chapter 5: the optional pack check, kept secondary to browsing. */
export function PackFlow() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = interpolate(frame, [14, 84], [0, 1], { ...clamp, easing: easeOut });
  const lineEnd = 132 + line * CARD.step * 3;

  return (
    <ArchFrame chapter={4} dark title={["Checking a pack", <span style={{ color: c.saffron }}>is optional.</span>]}>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <line x1={132} y1={LINE_Y} x2={lineEnd} y2={LINE_Y} stroke="#4a4a50" strokeWidth={3} strokeLinecap="round" />
        {STEPS.map((_, i) => {
          const x = 132 + i * CARD.step;
          return lineEnd >= x ? <circle key={i} cx={x} cy={LINE_Y} r={9} fill={c.saffron} /> : null;
        })}
      </svg>
      {STEPS.map((step, i) => {
        const p = spring({ frame: frame - 14 - i * 18, fps, config: snappy });
        return (
          <div
            key={step.title}
            style={{
              position: "absolute",
              left: 112 + i * CARD.step,
              top: CARD.top,
              width: CARD.width,
              height: CARD.height,
              boxSizing: "border-box",
              padding: "28px 30px",
              borderRadius: 26,
              background: c.darkCard,
              opacity: p,
              transform: `translateY(${(1 - p) * 60}px)`,
            }}
          >
            <div style={{ fontFamily: mono, fontSize: 24, color: c.saffron }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ marginTop: 14, fontSize: 46, fontWeight: 900, letterSpacing: "-0.035em", color: c.cream }}>{step.title}</div>
            <div style={{ marginTop: 14, fontSize: 26, lineHeight: 1.38, color: c.darkMuted }}>{step.text}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 112, top: 866, display: "flex", gap: 18 }}>
        {NOS.map((label, i) => {
          const p = spring({ frame: frame - 116 - i * 8, fps, config: { damping: 14, stiffness: 240 } });
          return (
            <div key={label} style={{ padding: "10px 28px", borderRadius: 999, border: `3px solid ${c.saffron}`, color: c.cream, fontSize: 32, fontWeight: 800, transform: `scale(${p})` }}>{label}</div>
          );
        })}
      </div>
    </ArchFrame>
  );
}
