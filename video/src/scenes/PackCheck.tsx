import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { TriangleAlert } from "../components/brand";
import { Barcode, Phone, PhoneHeader } from "../components/Phone";
import { c, clamp, easeOut, mono, sans, snappy } from "../theme";

// Fictional product and codes: the demo must not point at a real recall.
const DIGITS = "5060123456789";
const LOCK_AT = 52;
const VERDICT_AT = 74;
export const PACK_CHECK_FRAMES = 150;

const VIEW = { width: 374, height: 430 };
const LABEL = { width: 230, height: 160 };

/** Mirrors the app's camera scanner: status pill, sweeping beam, then brackets lock on to the barcode. */
function ScanView({ frame }: { frame: number }) {
  const locked = frame >= LOCK_AT;
  const drift = interpolate(frame, [4, 38], [0, 1], { ...clamp, easing: easeOut });
  const shake = locked ? 0 : Math.sin(frame * 0.9) * 3;
  const lock = interpolate(frame, [LOCK_AT, LOCK_AT + 8], [0, 1], { ...clamp, easing: easeOut });
  const beam = Math.sin((frame / 30) * Math.PI * 2.6) * (LABEL.height / 2 - 14);
  const insetX = interpolate(lock, [0, 1], [30, (VIEW.width - LABEL.width) / 2 - 14]);
  const insetY = interpolate(lock, [0, 1], [30, (VIEW.height - LABEL.height) / 2 - 14]);
  const bracket = locked ? c.marigold : c.cream;

  return (
    <div style={{ padding: "0 28px" }}>
      <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.035em", color: c.ink }}>Scan a barcode</div>
      <div style={{ marginTop: 6, fontSize: 18, color: c.muted }}>Point your camera at the pack.</div>
      <div style={{ position: "relative", marginTop: 22, width: VIEW.width, height: VIEW.height, borderRadius: 26, background: "#2a2622", overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: -40,
            top: -30,
            width: VIEW.width + 80,
            height: VIEW.height + 60,
            borderRadius: 30,
            background: "#d8c49b",
            display: "grid",
            placeItems: "center",
            transform: `translate(${(1 - drift) * 90 + shake}px, ${(1 - drift) * 170 - shake}px) rotate(${(1 - drift) * 10 - 1.5}deg) scale(${1 + lock * 0.04})`,
          }}
        >
          <div style={{ width: LABEL.width, height: LABEL.height, boxSizing: "border-box", padding: "16px 20px 8px", borderRadius: 10, background: "#fff", textAlign: "center" }}>
            <Barcode digits={DIGITS} width={LABEL.width - 40} height={104} />
            <div style={{ fontFamily: mono, fontSize: 17, letterSpacing: "0.12em", color: c.ink, marginTop: 4 }}>{DIGITS}</div>
          </div>
        </div>
        {[0, 1, 2, 3].map((corner) => (
          <div
            key={corner}
            style={{
              position: "absolute",
              width: 46,
              height: 46,
              borderColor: bracket,
              borderStyle: "solid",
              borderWidth: 0,
              [corner < 2 ? "top" : "bottom"]: insetY,
              [corner % 2 === 0 ? "left" : "right"]: insetX,
              [corner < 2 ? "borderTopWidth" : "borderBottomWidth"]: 6,
              [corner % 2 === 0 ? "borderLeftWidth" : "borderRightWidth"]: 6,
              borderRadius: 8,
            }}
          />
        ))}
        {locked ? null : <div style={{ position: "absolute", left: "12%", right: "12%", top: "50%", height: 4, borderRadius: 2, background: c.marigold, transform: `translateY(${beam}px)` }} />}
        <div style={{ position: "absolute", left: 16, top: 16, display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 20, background: "rgba(0,0,0,0.72)", color: "#fff", fontSize: 15, fontWeight: 800, letterSpacing: "0.02em" }}>
          <span style={{ width: 9, height: 9, borderRadius: 5, background: c.marigold, opacity: locked ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(frame / 5)) }} />
          {locked ? "Barcode found" : "Scanning"}
        </div>
        {locked ? null : <div style={{ position: "absolute", left: 0, right: 0, bottom: 16, textAlign: "center", fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.88)" }}>Line up the bars inside the frame</div>}
      </div>
      <div style={{ marginTop: 20, height: 48, display: "flex", alignItems: "center", gap: 10, fontSize: 17, fontWeight: 700, color: locked ? c.ink : c.muted }}>
        {locked ? (
          <>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={c.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            <span style={{ fontFamily: mono, letterSpacing: "0.08em" }}>5 060123 456789</span>
            <span style={{ fontWeight: 500, color: c.muted }}>· checking</span>
          </>
        ) : (
          <span style={{ textDecoration: "underline", textUnderlineOffset: 4 }}>Or type the number</span>
        )}
      </div>
    </div>
  );
}

function VerdictView({ frame }: { frame: number }) {
  const reveal = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: easeOut });
  return (
    <div style={{ padding: "0 22px", opacity: reveal, transform: `translateY(${(1 - reveal) * 24}px) scale(${0.985 + reveal * 0.015})` }}>
      <div style={{ borderRadius: 22, background: c.yeetSoft, color: c.yeet, padding: "30px 28px" }}>
        <TriangleAlert size={42} />
        <div style={{ marginTop: 22, fontSize: 50, fontWeight: 900, lineHeight: 0.98, letterSpacing: "-0.035em" }}>Warning match found</div>
        <div style={{ marginTop: 18, fontSize: 20, fontWeight: 700 }}>These details strongly match a published warning.</div>
        <div style={{ marginTop: 16, fontSize: 17, color: c.ink }}>
          <b>Product: Garlic Houmous 200g</b> · Example Foods
        </div>
        <div style={{ marginTop: 20, borderRadius: 14, background: "rgba(251,245,233,0.75)", padding: 18, color: c.ink }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: c.yeet }}>Official consumer advice</div>
          <div style={{ marginTop: 8, fontSize: 19, fontWeight: 600, lineHeight: 1.4 }}>Do not eat it. Return it to the store for a full refund.</div>
        </div>
        <div style={{ marginTop: 18, display: "inline-block", padding: "4px 14px", borderRadius: 20, border: "2px solid rgba(158,27,20,0.3)", fontSize: 15, fontWeight: 700 }}>Exact match</div>
        <div style={{ marginTop: 16, fontSize: 15, fontWeight: 500 }}>Checked against published UK warnings</div>
      </div>
    </div>
  );
}

/** Scene 5: the optional pack check. Scan or type a barcode and see the matching recall. */
export function PackCheck() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: snappy });
  const scanned = frame >= VERDICT_AT;
  const flash = interpolate(frame, [VERDICT_AT - 2, VERDICT_AT, VERDICT_AT + 4], [0, 1, 0], clamp);
  const second = spring({ frame: frame - 18, fps, config: snappy });

  return (
    <AbsoluteFill style={{ background: c.charcoal, fontFamily: sans }}>
      <div style={{ position: "absolute", left: 130, top: 420, fontSize: 92, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.08, color: c.cream }}>
        <div>Have one at home?</div>
        <div style={{ color: c.saffron, opacity: second, transform: `translateY(${(1 - second) * 40}px)` }}>Check your pack.</div>
      </div>

      <div style={{ position: "absolute", left: 1440 - 229, top: 56, transformOrigin: "50% 0", transform: `translateY(${(1 - enter) * 500}px) rotate(${(1 - enter) * 6}deg) scale(1.34)` }}>
        <Phone>
          <PhoneHeader />
          {scanned ? <VerdictView frame={frame - VERDICT_AT} /> : <ScanView frame={frame} />}
          <AbsoluteFill style={{ background: c.cream, opacity: flash, pointerEvents: "none" }} />
        </Phone>
      </div>
    </AbsoluteFill>
  );
}
