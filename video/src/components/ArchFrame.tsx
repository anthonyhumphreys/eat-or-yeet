import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { LogoTile } from "./brand";
import { c, clamp, mono, sans, snappy } from "../theme";

export const CHAPTERS = ["Sources", "Pipeline", "Health", "Website", "Pack check", "Assistants", "Notion"];

export function ArchHeader({ dark = false }: { dark?: boolean }) {
  return (
    <div style={{ position: "absolute", left: 112, top: 64, display: "flex", alignItems: "center", gap: 16, color: dark ? c.cream : c.ink }}>
      <LogoTile size={50} />
      <span style={{ fontSize: 28, fontWeight: 850, letterSpacing: "-0.035em" }}>Eat or Yeet</span>
      <span style={{ fontFamily: mono, fontSize: 22, color: dark ? c.darkMuted : c.muted, marginLeft: 6 }}>/ how it works</span>
    </div>
  );
}

/** Chapter chrome for the architecture video: header, kicker, masked title lines and a progress rail. */
export function ArchFrame({ chapter, kicker, title, sub, dark = false, children }: {
  chapter: number;
  kicker?: string;
  title: ReactNode[];
  sub?: ReactNode;
  dark?: boolean;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const lead = interpolate(frame, [0, 12], [0, 1], clamp);
  const subIn = spring({ frame: frame - 18, fps, config: snappy });
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp);
  const ink = dark ? c.cream : c.ink;
  const muted = dark ? c.darkMuted : c.muted;

  return (
    <AbsoluteFill style={{ background: dark ? c.charcoal : c.cream, fontFamily: sans, color: ink }}>
      <ArchHeader dark={dark} />
      <div style={{ position: "absolute", left: 112, top: 156 }}>
        <div style={{ fontFamily: mono, fontSize: 24, letterSpacing: "0.08em", color: muted, opacity: lead, marginBottom: 14 }}>
          {kicker ?? `${String(chapter + 1).padStart(2, "0")} / ${CHAPTERS[chapter].toUpperCase()}`}
        </div>
        <div style={{ fontSize: 88, fontWeight: 900, lineHeight: 1.02, letterSpacing: "-0.045em" }}>
          {title.map((line, i) => {
            const p = spring({ frame: frame - 4 - i * 7, fps, config: { damping: 200 }, durationInFrames: 20 });
            return (
              <div key={i} style={{ overflow: "hidden", paddingBottom: 12, marginBottom: -12 }}>
                <div style={{ transform: `translateY(${(1 - p) * 110}%)` }}>{line}</div>
              </div>
            );
          })}
        </div>
        {sub ? <div style={{ marginTop: 22, fontSize: 32, lineHeight: 1.35, color: muted, opacity: subIn, transform: `translateY(${(1 - subIn) * 20}px)` }}>{sub}</div> : null}
      </div>
      {children}
      <div style={{ position: "absolute", left: 112, top: 986, display: "flex", gap: 14 }}>
        {CHAPTERS.map((label, i) => (
          <div key={label} style={{ width: 150 }}>
            <div style={{ height: 4, borderRadius: 2, background: dark ? "#39393d" : c.border, overflow: "hidden" }}>
              <div style={{ width: `${i < chapter ? 100 : i === chapter ? progress * 100 : 0}%`, height: "100%", background: dark ? c.saffron : c.marigold }} />
            </div>
            <div style={{ marginTop: 10, fontSize: 19, fontWeight: i === chapter ? 800 : 500, color: i === chapter ? ink : muted }}>{label}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/** A marigold marker swipe behind highlighted words, as matched terms appear in the app. */
export function Marker({ swipe, pad = 14, style, children }: { swipe: number; pad?: number; style?: CSSProperties; children: ReactNode }) {
  return (
    <span style={{ position: "relative", display: "inline-block", ...style }}>
      <span style={{ position: "absolute", left: -pad, right: -pad, top: "14%", bottom: "4%", borderRadius: pad + 2, background: c.marigold, transformOrigin: "left center", transform: `scaleX(${swipe})` }} />
      <span style={{ position: "relative" }}>{children}</span>
    </span>
  );
}
