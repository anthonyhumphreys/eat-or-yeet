import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { c, clamp, easeOut, sans, snappy } from "../theme";

const PHONE = { w: 360, h: (360 * 844) / 390 };
const DESKTOP = { w: 780, h: (780 * 900) / 1440 };
// Real production captures from `pnpm capture`, laid out in columns on a tilted plane.
const CARDS = [
  { src: "allergens-uk-light", x: -1010, y: 170, ...PHONE },
  { src: "home-uk-light", x: -610, y: -110, ...PHONE },
  { src: "home-uk-desktop", x: 0, y: -270, ...DESKTOP },
  { src: "incident-us-dark", x: 0, y: 270, ...DESKTOP },
  { src: "home-us-dark", x: 610, y: 60, ...PHONE },
  { src: "incident-uk-light", x: 1010, y: -190, ...PHONE },
];
const SOURCES = ["FSA", "FDA", "USDA FSIS"];
const BADGE_AT = 34;

/** Scene 6: the real product, flown in as a tilted wall of screenshots. */
export function Collage() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const push = interpolate(frame, [0, durationInFrames], [0.84, 1.02], { ...clamp, easing: easeOut });
  const badge = spring({ frame: frame - BADGE_AT, fps, config: { damping: 14, stiffness: 220 } });

  return (
    <AbsoluteFill style={{ background: c.cream, fontFamily: sans, overflow: "hidden", perspective: 2600 }}>
      <AbsoluteFill style={{ transform: `rotateX(22deg) rotateZ(-9deg) scale(${push})`, transformStyle: "preserve-3d" }}>
        {CARDS.map((card, i) => {
          const p = spring({ frame: frame - i * 4, fps, config: snappy });
          return (
            <Img
              key={card.src}
              src={staticFile(`shots/${card.src}.png`)}
              style={{
                position: "absolute",
                left: 960 + card.x - card.w / 2,
                top: 540 + card.y - card.h / 2,
                width: card.w,
                height: card.h,
                objectFit: "cover",
                objectPosition: "top",
                borderRadius: 26,
                border: `3px solid ${card.src.includes("dark") ? "#2c2c31" : c.border}`,
                opacity: p,
                transform: `translateY(${(1 - p) * (i % 2 ? -700 : 700)}px)`,
              }}
            />
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "22px 26px 22px 40px", borderRadius: 999, background: c.ink, opacity: badge, transform: `scale(${interpolate(badge, [0, 1], [0.7, 1])})` }}>
          <span style={{ fontSize: 46, fontWeight: 700, color: c.cream, letterSpacing: "-0.02em", marginRight: 8 }}>Recalls from</span>
          {SOURCES.map((source) => (
            <span key={source} style={{ padding: "10px 28px", borderRadius: 999, background: c.marigold, fontSize: 44, fontWeight: 800, color: c.ink }}>{source}</span>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
