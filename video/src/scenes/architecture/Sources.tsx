import { spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { c, mono, snappy } from "../../theme";

const SOURCES = [
  { region: "UK", name: "FSA", text: "Product recalls, allergy alerts and food alerts for action.", host: "food.gov.uk" },
  { region: "US", name: "FDA", text: "Food recall announcements and enforcement reports, plus drug reports to browse.", host: "fda.gov · api.fda.gov" },
  { region: "US", name: "USDA FSIS", text: "Meat, poultry and egg product recalls and public health alerts.", host: "fsis.usda.gov" },
];
const CARD = { top: 466, width: 528, height: 376, step: 568 };

/** Chapter 1: the official feeds every warning comes from. */
export function Sources() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pill = spring({ frame: frame - 84, fps, config: { damping: 14, stiffness: 240 } });
  const note = spring({ frame: frame - 94, fps, config: snappy });

  return (
    <ArchFrame chapter={0} dark title={["It starts with", <span style={{ color: c.saffron }}>official recall feeds.</span>]}>
      {SOURCES.map((source, i) => {
        const p = spring({ frame: frame - 22 - i * 14, fps, config: snappy });
        return (
          <div
            key={source.name}
            style={{
              position: "absolute",
              left: 112 + i * CARD.step,
              top: CARD.top,
              width: CARD.width,
              height: CARD.height,
              boxSizing: "border-box",
              padding: "30px 34px",
              borderRadius: 28,
              background: c.darkCard,
              display: "flex",
              flexDirection: "column",
              opacity: p,
              transform: `translateY(${(1 - p) * 90}px)`,
            }}
          >
            <div style={{ alignSelf: "flex-start", padding: "4px 14px", borderRadius: 999, background: c.saffron, color: c.charcoal, fontFamily: mono, fontSize: 20, letterSpacing: "0.06em" }}>{source.region}</div>
            <div style={{ marginTop: 20, fontSize: 64, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: c.cream }}>{source.name}</div>
            <div style={{ marginTop: 16, fontSize: 26, lineHeight: 1.38, color: c.darkMuted }}>{source.text}</div>
            <div style={{ marginTop: "auto", paddingTop: 16, borderTop: `2px solid ${c.darkLine}`, fontFamily: mono, fontSize: 21, color: c.darkMuted }}>{source.host}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 112, top: 878, display: "flex", alignItems: "center", gap: 26 }}>
        <div style={{ padding: "10px 30px", borderRadius: 999, background: c.saffron, color: c.charcoal, fontSize: 34, fontWeight: 800, transform: `scale(${pill})` }}>Imported every day</div>
        <div style={{ fontSize: 30, fontWeight: 600, color: c.darkMuted, opacity: note, transform: `translateX(${(1 - note) * -20}px)` }}>Incomplete responses are rejected.</div>
      </div>
    </ArchFrame>
  );
}
