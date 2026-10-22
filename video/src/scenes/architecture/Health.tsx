import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { TriangleAlert } from "../../components/brand";
import { c, clamp, mono, snappy } from "../../theme";

const ROWS = [
  { name: "FSA", region: "UK", hours: 3 },
  { name: "FDA enforcement", region: "US", hours: 4 },
  { name: "FDA announcements", region: "US", hours: 5 },
  { name: "USDA FSIS", region: "US", hours: 6 },
];
const COLS = [0, 380, 510, 700];
const TABLE = { x: 112, y: 470, w: 980, head: 52, row: 80 };
const AGE_FROM = 44;
const STALE_AT = 120;

function Status({ stale }: { stale: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 16px", borderRadius: 999, background: stale ? c.darkYeetSoft : c.darkSecondary, color: stale ? c.darkYeet : c.cream, fontSize: 22, fontWeight: 750, whiteSpace: "nowrap" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: stale ? c.darkYeet : c.saffron }} />
      {stale ? "May be out of date" : "Available"}
    </span>
  );
}

/** Chapter 3: per-source freshness. A stale feed stops a check from returning a no-match result. */
export function Health() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stale = frame >= STALE_AT;
  const age = stale ? 49 : Math.round(interpolate(frame, [AGE_FROM, STALE_AT], [6, 48], { ...clamp, easing: Easing.in(Easing.quad) }));
  const card = spring({ frame: frame - STALE_AT - 2, fps, config: { damping: 14, stiffness: 220 } });
  const caption = spring({ frame: frame - STALE_AT - 30, fps, config: snappy });
  const ghost = interpolate(frame, [30, 42], [0, 1], clamp);
  const cell = { position: "absolute", top: 0, height: "100%", display: "flex", alignItems: "center" } as const;

  return (
    <ArchFrame chapter={2} dark title={["Every source", <span style={{ color: c.saffron }}>keeps a ledger.</span>]}>
      <div style={{ position: "absolute", left: TABLE.x, top: TABLE.y, width: TABLE.w }}>
        <div style={{ position: "relative", height: TABLE.head, borderBottom: `2px solid ${c.darkLine}`, fontFamily: mono, fontSize: 19, letterSpacing: "0.08em", color: c.darkMuted }}>
          {["SOURCE", "REGION", "LAST SUCCESS", "STATUS"].map((label, i) => <span key={label} style={{ ...cell, left: COLS[i] }}>{label}</span>)}
        </div>
        {ROWS.map((row, i) => {
          const p = spring({ frame: frame - 10 - i * 7, fps, config: snappy });
          const ages = i === ROWS.length - 1;
          return (
            <div key={row.name} style={{ position: "relative", height: TABLE.row, borderBottom: `2px solid ${c.darkLine}`, opacity: p, transform: `translateX(${(1 - p) * -40}px)` }}>
              <span style={{ ...cell, left: COLS[0], fontSize: 34, fontWeight: 850, letterSpacing: "-0.03em" }}>{row.name}</span>
              <span style={{ ...cell, left: COLS[1], fontFamily: mono, fontSize: 24, color: c.darkMuted }}>{row.region}</span>
              <span style={{ ...cell, left: COLS[2], fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: ages && stale ? c.darkYeet : c.cream }}>{ages ? age : row.hours}h ago</span>
              <span style={{ ...cell, left: COLS[3] }}><Status stale={ages && stale} /></span>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 1170, top: TABLE.y, width: 638, height: 330, boxSizing: "border-box", borderRadius: 28, border: "3px dashed #4a4a50", display: "grid", placeItems: "center", textAlign: "center", fontFamily: mono, fontSize: 24, lineHeight: 1.5, color: c.darkMuted, opacity: stale ? 0 : ghost }}>
        Every check reads<br />this ledger first
      </div>
      <div
        style={{
          position: "absolute",
          left: 1170,
          top: TABLE.y,
          width: 638,
          boxSizing: "border-box",
          padding: "34px 36px",
          borderRadius: 28,
          background: c.darkYeetSoft,
          color: c.darkYeet,
          opacity: stale ? card : 0,
          transform: `scale(${0.9 + card * 0.1}) translateY(${(1 - card) * 30}px)`,
        }}
      >
        <TriangleAlert size={46} />
        <div style={{ marginTop: 20, fontSize: 50, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.035em", color: c.cream }}>Warning data incomplete</div>
        <div style={{ marginTop: 18, fontSize: 26, fontWeight: 750 }}>We couldn&apos;t complete this warning check.</div>
        <div style={{ marginTop: 14, fontSize: 24, lineHeight: 1.4, color: c.darkMuted }}>Current data from U.S. Department of Agriculture Food Safety and Inspection Service is unavailable. Try again later.</div>
      </div>
      <div style={{ position: "absolute", left: 112, top: 880, width: 1696, fontSize: 32, fontWeight: 650, lineHeight: 1.35, color: c.cream, opacity: caption, transform: `translateY(${(1 - caption) * 20}px)` }}>
<span style={{ color: c.darkMuted }}>Missing, failed or 48-hour-old data</span> blocks a no-match result.
      </div>
    </ArchFrame>
  );
}
