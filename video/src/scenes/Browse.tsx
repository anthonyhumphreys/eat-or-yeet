import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import browse from "../../public/browse.json";
import { TriangleAlert } from "../components/brand";
import { Phone, PhoneHeader, Tap } from "../components/Phone";
import { c, clamp, easeOut, sans, snappy } from "../theme";

// Real list data from `pnpm capture`. The demo scrolls to the list, taps a food category, then shares the list.
const SCROLL_AT = 24;
const TAP_CATEGORY = 72;
const SWAP_AT = 78;
const TAP_SHARE = 126;
const SCROLL_BY = 238;
export const BROWSE_FRAMES = 176;

const CAPTIONS = [
  { from: 0, text: "Newest first." },
  { from: TAP_CATEGORY - 4, text: "Sorted by food type." },
  { from: TAP_SHARE - 4, text: "Share the list." },
];
const hazardTone: Record<string, CSSProperties> = {
  pathogen: { background: c.yeetSoft, color: c.yeet },
  allergen: { background: c.maybeSoft, color: c.maybe },
  other: { background: c.secondary, color: c.ink },
};
const clampLines = (lines: number): CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" });

function Chip({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 15px", borderRadius: 20, border: `2px solid ${active ? c.marigold : c.border}`, background: active ? c.marigold : c.cream, fontSize: 15, fontWeight: 650, color: c.ink, whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}

function Row({ row, style }: { row: (typeof browse.all.rows)[number]; style?: CSSProperties }) {
  return (
    <div style={{ padding: "16px 0", borderBottom: `2px solid ${c.border}`, ...style }}>
      <div style={{ fontSize: 17, fontWeight: 650, lineHeight: 1.3, color: c.ink, ...clampLines(2) }}>{row.title}</div>
      <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: c.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
        <span style={{ padding: "1px 9px", borderRadius: 10, fontWeight: 700, ...hazardTone[row.kind] }}>{row.hazard}</span>
        <span>{row.categories}</span>
      </div>
      <div style={{ marginTop: 5, fontSize: 13, color: c.muted }}>{row.date}</div>
    </div>
  );
}

export function Screen({ frame }: { frame: number }) {
  const { fps } = useVideoConfig();
  const scroll = interpolate(frame, [SCROLL_AT, SCROLL_AT + 20], [0, SCROLL_BY], { ...clamp, easing: easeOut });
  const filtered = frame >= SWAP_AT;
  const list = filtered ? browse.filtered : browse.all;
  const shared = frame >= TAP_SHARE + 3;

  return (
    <>
      <PhoneHeader />
      <div style={{ padding: "0 22px", transform: `translateY(${-scroll}px)` }}>
        <div style={{ height: 58, fontSize: 36, fontWeight: 900, letterSpacing: "-0.035em", color: c.ink }}>UK recalls</div>
        <div style={{ height: 162, boxSizing: "border-box", borderRadius: 18, border: `2px solid ${c.border}`, background: c.card, padding: 16 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 11px", borderRadius: 14, background: c.yeet, color: "#fff", fontSize: 13, fontWeight: 800 }}>
            <TriangleAlert size={14} />
            {browse.all.alert?.label}
          </span>
          <div style={{ marginTop: 10, fontSize: 19, fontWeight: 900, lineHeight: 1.25, letterSpacing: "-0.02em", color: c.ink, ...clampLines(3) }}>{browse.all.alert?.title}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18, paddingBottom: 14, borderBottom: `2px solid ${c.border}` }}>
          {browse.all.types.map((type, i) => (
            <Chip key={type.label} active={i === 0}>{type.label} <span style={{ fontWeight: 600 }}>{type.count}</span></Chip>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <Chip active={!filtered}>All categories</Chip>
          {browse.all.categories.slice(0, 7).map((category) => (
            <Chip key={category.label} active={filtered && category.label === browse.category}>
              {category.label} <span style={{ fontWeight: 600 }}>{category.count}</span>
              {category.label === browse.category ? <Tap at={TAP_CATEGORY} frame={frame} /> : null}
            </Chip>
          ))}
        </div>
        <div style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.ink }}>{list.heading}</div>
            <div style={{ fontSize: 13, color: c.muted, whiteSpace: "nowrap" }}>Newest first · FSA</div>
          </div>
          <div style={{ position: "relative", flexShrink: 0, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 7, height: 42, padding: "0 16px", borderRadius: 21, border: `2px solid ${c.border}`, fontSize: 15, fontWeight: 700, color: c.ink }}>
            {shared ? (
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={c.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" /></svg>
            )}
            {shared ? "Link copied" : "Share this list"}
            <Tap at={TAP_SHARE} frame={frame} />
          </div>
        </div>
        <div style={{ marginTop: 6 }}>
          {list.rows.slice(0, 4).map((row, i) => {
            const enter = filtered ? spring({ frame: frame - SWAP_AT - i * 5, fps, config: snappy }) : 1;
            return <Row key={`${filtered}-${row.title}`} row={row} style={{ opacity: enter, transform: `translateY(${(1 - enter) * 22}px)` }} />;
          })}
        </div>
      </div>
    </>
  );
}

/** Scene 4: the main feature. The live recall list, filtered by food type and shared. */
export function Browse() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: snappy });
  const caption = [...CAPTIONS].reverse().find((item) => frame >= item.from) ?? CAPTIONS[0];
  const captionIn = spring({ frame: frame - caption.from, fps, config: snappy });

  return (
    <AbsoluteFill style={{ background: c.charcoal, fontFamily: sans }}>
      <div style={{ position: "absolute", left: 130, top: 480, fontSize: 92, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: c.cream, opacity: captionIn, transform: `translateY(${(1 - captionIn) * 40}px)` }}>
        {caption.text}
      </div>
      <div style={{ position: "absolute", left: 1440 - 229, top: 56, transformOrigin: "50% 0", transform: `translateY(${(1 - enter) * 500}px) rotate(${(1 - enter) * 6}deg) scale(1.34)` }}>
        <Phone>
          <Screen frame={frame} />
        </Phone>
      </div>
    </AbsoluteFill>
  );
}
