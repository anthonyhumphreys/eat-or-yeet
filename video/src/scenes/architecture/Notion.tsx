import type { ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { c, clamp, easeOut, mono, snappy } from "../../theme";

// Fictional product and warning: the demo must not point at a real recall.
const ITEM = "Garlic houmous";
const BRAND = "Example Foods";
const TABLE = { x: 112, y: 474, w: 1110, head: 56, row: 84 };
const COLS = [28, 360, 600, 740];
const ITEM_AT = 16;
const BRAND_AT = 50;
const FLOW = [
  { at: 92, text: "Notion sends a signed event" },
  { at: 112, text: "Vercel verifies it" },
  { at: 132, text: "A Cloudflare job runs the review" },
  { at: 152, text: "Results are written back" },
];
const RESULT_AT = 170;
const STEP_GAP = 104;
const FLOW_X = 1290;

const typed = (text: string, frame: number, from: number) => text.slice(0, Math.max(0, Math.floor((frame - from) * 0.55)));

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span style={{ width: 30, height: 30, borderRadius: 7, border: `3px solid ${checked ? c.saffron : "#55555b"}`, background: checked ? c.saffron : "transparent", display: "grid", placeItems: "center", boxSizing: "border-box" }}>
      {checked ? <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={c.charcoal} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
    </span>
  );
}

function Row({ cells, muted = false }: { cells: ReactNode[]; muted?: boolean }) {
  return (
    <div style={{ position: "relative", height: TABLE.row, borderTop: `2px solid ${c.darkLine}`, fontSize: 28, fontWeight: 650, color: muted ? c.darkMuted : c.cream }}>
      {cells.map((cell, i) => <div key={i} style={{ position: "absolute", left: COLS[i], top: 0, height: "100%", display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>{cell}</div>)}
    </div>
  );
}

/** Chapter 7: a connected Notion shopping list. Editing an item triggers a review that writes its result back. */
export function Notion() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const table = spring({ frame: frame - 8, fps, config: snappy });
  const item = typed(ITEM, frame, ITEM_AT);
  const brand = typed(BRAND, frame, BRAND_AT);
  const typing = frame < FLOW[0].at;
  const cursorOn = Math.floor(frame / 8) % 2 === 0;
  const cursor = <span style={{ display: "inline-block", width: 3, height: 32, marginLeft: 3, background: c.saffron, opacity: cursorOn ? 1 : 0 }} />;
  const result = spring({ frame: frame - RESULT_AT, fps, config: { damping: 14, stiffness: 240 } });
  const travel = interpolate(frame, [FLOW[0].at, FLOW[3].at], [0, 1], { ...clamp, easing: easeOut });
  const caption = spring({ frame: frame - RESULT_AT - 16, fps, config: snappy });
  const status = frame >= RESULT_AT ? (
    <span style={{ padding: "6px 16px", borderRadius: 999, background: c.darkYeetSoft, color: c.darkYeet, fontSize: 24, fontWeight: 800, transform: `scale(${result})`, display: "inline-block" }}>Related warnings found</span>
  ) : frame >= FLOW[0].at ? (
    <span style={{ fontSize: 24, color: c.darkMuted }}>Reviewing{".".repeat(1 + (Math.floor(frame / 8) % 3))}</span>
  ) : null;

  return (
    <ArchFrame chapter={6} dark title={["Connect a Notion", <span style={{ color: c.saffron }}>shopping list.</span>]}>
      <div style={{ position: "absolute", left: TABLE.x, top: TABLE.y, width: TABLE.w, borderRadius: 24, background: c.darkCard, overflow: "hidden", opacity: table, transform: `translateY(${(1 - table) * 40}px)` }}>
        <div style={{ position: "relative", height: TABLE.head, fontFamily: mono, fontSize: 18, letterSpacing: "0.08em", color: c.darkMuted }}>
          {["ITEM", "BRAND", "BOUGHT", "REVIEW STATUS"].map((label, i) => <span key={label} style={{ position: "absolute", left: COLS[i], top: 0, height: "100%", display: "flex", alignItems: "center" }}>{label}</span>)}
        </div>
        <Row cells={[<>{item}{typing && frame < BRAND_AT ? cursor : null}</>, <>{brand}{typing && frame >= BRAND_AT ? cursor : null}</>, <Checkbox checked={false} />, status]} />
        <Row cells={["Oat milk", "", <Checkbox checked />, ""]} />
        <Row muted cells={["+ New", "", "", ""]} />
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <line x1={FLOW_X + 14} y1={TABLE.y + 14} x2={FLOW_X + 14} y2={TABLE.y + 14 + STEP_GAP * 3} stroke="#4a4a50" strokeWidth={3} />
        {frame >= FLOW[0].at && frame < RESULT_AT ? <rect x={FLOW_X + 5} y={TABLE.y + 5 + travel * STEP_GAP * 3} width={18} height={18} rx={5} fill={c.saffron} /> : null}
      </svg>
      {FLOW.map((step, i) => {
        const p = spring({ frame: frame - 24 - i * 6, fps, config: snappy });
        const lit = frame >= step.at;
        return (
          <div key={step.text} style={{ position: "absolute", left: FLOW_X, top: TABLE.y + i * STEP_GAP, display: "flex", alignItems: "center", gap: 22, opacity: p }}>
            <span style={{ width: 28, height: 28, borderRadius: 14, boxSizing: "border-box", border: `3px solid ${lit ? c.saffron : "#4a4a50"}`, background: lit ? c.saffron : c.charcoal }} />
            <span style={{ fontSize: 28, fontWeight: lit ? 750 : 550, color: lit ? c.cream : c.darkMuted }}>{step.text}</span>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 112, top: 866, width: 1696, fontSize: 30, fontWeight: 650, lineHeight: 1.4, color: c.cream, opacity: caption, transform: `translateY(${(1 - caption) * 20}px)` }}>
        Reviews run when items change. <span style={{ color: c.darkMuted }}>Bought items are skipped. Notion credentials are encrypted before storage.</span>
      </div>
    </ArchFrame>
  );
}
