import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { Phone } from "./Phone";
import { LogoTile } from "./brand";
import { c, clamp, easeOut, mono, sans, snappy } from "../theme";

export const WALKTHROUGH_STEPS = ["Choose", "Browse", "Filter", "Read", "Share", "Check"];

export function OverviewPhone({ shot, nextShot, changeAt = 55 }: { shot: string; nextShot?: string; changeAt?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: snappy });
  const swap = nextShot ? interpolate(frame, [changeAt, changeAt + 10], [0, 1], { ...clamp, easing: easeOut }) : 0;
  const imageStyle = { position: "absolute", top: 60, left: 0, width: 430, height: 840 } as const;

  return (
    <div style={{ position: "absolute", left: 1240, top: 72, transform: `translateY(${(1 - enter) * 150}px) rotate(${(1 - enter) * 4}deg)`, opacity: enter }}>
      <Phone>
        <Img src={staticFile(`overview/${shot}.png`)} style={{ ...imageStyle, opacity: 1 - swap }} />
        {nextShot ? <Img src={staticFile(`overview/${nextShot}.png`)} style={{ ...imageStyle, opacity: swap, transform: `translateY(${(1 - swap) * 10}px)` }} /> : null}
      </Phone>
    </div>
  );
}

export function OverviewStep({ step, title, description, children, light = false, note }: {
  step: number;
  title: ReactNode;
  description: string;
  children: ReactNode;
  light?: boolean;
  note?: string;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame: frame - 3, fps, config: snappy });
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp);
  const ink = light ? c.ink : c.cream;
  const muted = light ? c.muted : c.darkMuted;

  return (
    <AbsoluteFill style={{ background: light ? c.cream : c.charcoal, fontFamily: sans }}>
      <div style={{ position: "absolute", left: 112, top: 76, display: "flex", alignItems: "center", gap: 18, color: ink }}>
        <LogoTile size={54} />
        <span style={{ fontSize: 30, fontWeight: 850, letterSpacing: "-0.035em" }}>Eat or Yeet</span>
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", pointerEvents: "none" }}>
        <circle cx={1469} cy={537} r={446} fill="none" stroke={light ? c.border : c.darkLine} strokeWidth={2} />
        <path d="M 1023 537 H 1915 M 1469 91 V 983" fill="none" stroke={light ? c.border : c.darkLine} strokeWidth={2} />
      </svg>
      <div style={{ position: "absolute", left: 112, top: 280, width: 930, color: ink, opacity: enter, transform: `translateY(${(1 - enter) * 32}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 26, color: muted, letterSpacing: "0.06em", marginBottom: 24 }}>
          {String(step + 1).padStart(2, "0")} / {WALKTHROUGH_STEPS[step].toUpperCase()}
        </div>
        <div style={{ fontSize: 100, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.045em" }}>{title}</div>
        <p style={{ fontSize: 32, lineHeight: 1.45, color: muted, maxWidth: 820, margin: "30px 0 0" }}>{description}</p>
        {note ? <div style={{ marginTop: 26, fontSize: 24, color: muted, maxWidth: 820, lineHeight: 1.4 }}>{note}</div> : null}
      </div>
      {children}
      <div style={{ position: "absolute", left: 112, top: 914, display: "flex", gap: 12 }}>
        {WALKTHROUGH_STEPS.map((label, index) => (
          <div key={label} style={{ width: 125 }}>
            <div style={{ height: 4, borderRadius: 2, background: light ? c.border : "#39393d", overflow: "hidden" }}>
              <div style={{ width: `${index < step ? 100 : index === step ? progress * 100 : 0}%`, height: "100%", background: c.marigold }} />
            </div>
            <div style={{ marginTop: 12, fontSize: 20, fontWeight: index === step ? 800 : 500, color: index === step ? ink : muted }}>{label}</div>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 112, bottom: 42, fontFamily: mono, fontSize: 20, color: muted }}>eatoryeet.app</div>
    </AbsoluteFill>
  );
}
