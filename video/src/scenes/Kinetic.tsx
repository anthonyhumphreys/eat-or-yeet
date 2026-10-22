import { Fragment } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { c, clamp, easeOut, sans } from "../theme";

// Each line is a list of segments; highlighted segments get the marigold marker, as matched terms do in the app.
const LINES: { text: string; mark?: boolean }[][] = [
  [{ text: "See what's " }, { text: "recalled", mark: true }, { text: " now." }],
  [{ text: "Sorted by " }, { text: "food type", mark: true }, { text: "." }],
  [{ text: "Filter by " }, { text: "allergen", mark: true }, { text: " or " }, { text: "shop", mark: true }, { text: "." }],
  [{ text: "Send one to the " }, { text: "group chat", mark: true }, { text: "." }],
];
export const FRAMES_PER_LINE = 40;
const LINE_HEIGHT = 200;

/** Scene 3: scrolling kinetic copy. The active line is ink; its keywords get a marker swipe. */
export function Kinetic() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const offset = LINES.slice(1).reduce((sum, _, i) => sum + spring({ frame: frame - (i + 1) * FRAMES_PER_LINE, fps, config: { damping: 18, stiffness: 170 } }), 0);

  return (
    <AbsoluteFill style={{ background: c.cream, fontFamily: sans, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 170, top: 540 - LINE_HEIGHT / 2, transform: `translateY(${-offset * LINE_HEIGHT}px)` }}>
        {LINES.map((segments, i) => {
          const distance = Math.abs(i - offset);
          const activeAt = i * FRAMES_PER_LINE;
          const swipe = interpolate(frame, [activeAt + 6, activeAt + 16], [0, 1], { ...clamp, easing: easeOut });
          return (
            <div
              key={i}
              style={{
                height: LINE_HEIGHT,
                display: "flex",
                alignItems: "center",
                fontSize: 136,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                whiteSpace: "pre",
                color: distance < 0.5 ? c.ink : c.muted,
                opacity: interpolate(distance, [0, 1, 2], [1, 0.28, 0.12], clamp),
              }}
            >
              {segments.map((segment, j) =>
                segment.mark ? (
                  <span key={j} style={{ position: "relative", display: "inline-block" }}>
                    <span style={{ position: "absolute", left: -14, right: -14, top: "14%", bottom: "6%", borderRadius: 18, background: c.marigold, transformOrigin: "left center", transform: `scaleX(${swipe})` }} />
                    <span style={{ position: "relative" }}>{segment.text}</span>
                  </span>
                ) : (
                  <Fragment key={j}>{segment.text}</Fragment>
                ),
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export const KINETIC_FRAMES = LINES.length * FRAMES_PER_LINE;
