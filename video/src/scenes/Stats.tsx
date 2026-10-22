import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import stats from "../../public/stats.json";
import { c, clamp, sans, snappy } from "../theme";

const TOTAL = stats.UK + stats.US;
const COUNT_FRAMES = 34;

/** Scene 7: live food recall count, captured from production by `pnpm capture`. */
export function Stats() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const value = Math.round(interpolate(frame, [0, COUNT_FRAMES], [0, TOTAL], { ...clamp, easing: Easing.out(Easing.exp) }));
  const label = spring({ frame: frame - 20, fps, config: snappy });
  const pill = spring({ frame: frame - 32, fps, config: { damping: 14, stiffness: 240 } });

  return (
    <AbsoluteFill style={{ background: c.charcoal, fontFamily: sans, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontSize: 300, fontWeight: 900, letterSpacing: "-0.05em", lineHeight: 0.9, color: c.cream, fontVariantNumeric: "tabular-nums" }}>{value.toLocaleString("en-GB")}</div>
      <div style={{ marginTop: 34, fontSize: 64, fontWeight: 700, letterSpacing: "-0.03em", color: c.darkMuted, opacity: label, transform: `translateY(${(1 - label) * 30}px)` }}>
        UK and US food recalls in one list
      </div>
      <div style={{ marginTop: 44, padding: "14px 38px", borderRadius: 999, background: c.saffron, color: c.charcoal, fontSize: 48, fontWeight: 800, transform: `scale(${pill})` }}>Updated daily</div>
    </AbsoluteFill>
  );
}
