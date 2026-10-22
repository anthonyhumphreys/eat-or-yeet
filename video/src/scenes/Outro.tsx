import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { LogoTile } from "../components/brand";
import { c, clamp, easeOut, sans } from "../theme";

const URL = "eatoryeet.app";
const TYPE_AT = 16;

/** Scene 8: cream wipes up over charcoal, logo and URL. Ends on cream so the GIF loops into scene 1. */
export function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wipe = interpolate(frame, [0, 9], [100, 0], { ...clamp, easing: easeOut });
  const tile = spring({ frame: frame - 5, fps, config: { damping: 12, stiffness: 180 } });
  const word = spring({ frame: frame - 9, fps, config: { damping: 200 }, durationInFrames: 14 });
  const typed = URL.slice(0, Math.max(0, Math.floor((frame - TYPE_AT) * 1.2)));
  const tagline = interpolate(frame, [32, 40], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ background: c.charcoal, fontFamily: sans }}>
      <AbsoluteFill style={{ background: c.cream, clipPath: `inset(${wipe}% 0 0 0)`, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          <LogoTile size={190} style={{ transform: `scale(${tile}) rotate(${interpolate(tile, [0, 1], [-24, 0])}deg)` }} />
          <div style={{ overflow: "hidden", paddingBottom: 20, marginBottom: -20 }}>
            <div style={{ fontSize: 190, fontWeight: 900, letterSpacing: "-0.045em", lineHeight: 1, color: c.ink, transform: `translateY(${(1 - word) * 110}%)` }}>Eat or Yeet</div>
          </div>
        </div>
        <div style={{ marginTop: 56, height: 104, minWidth: 140, padding: "0 46px", borderRadius: 999, background: c.marigold, display: "flex", alignItems: "center", fontSize: 64, fontWeight: 800, letterSpacing: "-0.02em", color: c.ink, opacity: frame >= TYPE_AT ? 1 : 0 }}>
          {typed}
          <span style={{ width: 5, height: 62, marginLeft: 4, background: c.ink, opacity: typed.length < URL.length || Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }} />
        </div>
        <div style={{ marginTop: 44, fontSize: 54, fontWeight: 600, color: c.muted, opacity: tagline }}>UK and US food recalls, sorted.</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
