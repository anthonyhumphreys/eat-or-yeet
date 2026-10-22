import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { LogoTile } from "../components/brand";
import { OverviewPhone, OverviewStep } from "../components/OverviewStep";
import { c, clamp, easeOut, sans, snappy } from "../theme";

export function OverviewIntro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: snappy });
  const swipe = interpolate(frame, [12, 28], [0, 1], { ...clamp, easing: easeOut });
  return (
    <AbsoluteFill style={{ background: c.cream, fontFamily: sans, color: c.ink, padding: "130px 120px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28, opacity: enter, transform: `translateY(${(1 - enter) * 40}px)` }}>
        <LogoTile size={100} />
        <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: "-0.045em" }}>Eat or Yeet</div>
      </div>
      <div style={{ marginTop: 82, fontSize: 156, fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.045em", opacity: enter }}>
        <div>Food recalls.</div>
        <span style={{ position: "relative", display: "inline-block" }}>
          <span style={{ position: "absolute", inset: "16% -22px 2%", background: c.marigold, borderRadius: 18, transformOrigin: "left", transform: `scaleX(${swipe})` }} />
          <span style={{ position: "relative" }}>Here's how it works.</span>
        </span>
      </div>
      <div style={{ marginTop: 60, fontSize: 38, color: c.muted }}>Browse UK and US warnings, then open the details.</div>
    </AbsoluteFill>
  );
}

export function ChooseRegion() {
  return (
    <OverviewStep step={0} title={<>Choose<br /><span style={{ color: c.saffron }}>UK or US.</span></>} description="Start with the country whose warnings you want to browse.">
      <OverviewPhone shot="uk-home" nextShot="us-home" changeAt={45} />
    </OverviewStep>
  );
}

export function BrowseWarnings() {
  return (
    <OverviewStep step={1} title={<>Browse the<br /><span style={{ color: c.saffron }}>latest recalls.</span></>} description="See recent warnings, their hazards and the products involved.">
      <OverviewPhone shot="uk-home" nextShot="uk-list" changeAt={32} />
    </OverviewStep>
  );
}

export function FilterWarnings() {
  const frame = useCurrentFrame();
  const allergens = frame >= 70;
  return (
    <OverviewStep step={2} light title={<>Find the<br /><span style={{ color: c.maybe }}>{allergens ? "allergen or shop." : "food type."}</span></>} description={allergens ? "Use the hazard and shop filters, or search by product, brand and allergen." : "Narrow the list with categories such as dairy and eggs."}>
      <OverviewPhone shot="category" nextShot="allergens" changeAt={70} />
    </OverviewStep>
  );
}

export function ReadWarning() {
  return (
    <OverviewStep step={3} title={<>Open a recall.<br /><span style={{ color: c.saffron }}>Read what to do.</span></>} description="See the affected products, pack details and published consumer advice.">
      <OverviewPhone shot="notice" nextShot="advice" changeAt={45} />
    </OverviewStep>
  );
}

export function ShareWarning() {
  return (
    <OverviewStep step={4} light title={<>Send someone<br /><span style={{ color: c.maybe }}>the notice.</span></>} description="Share a recall, or share a filtered list with its own link.">
      <OverviewPhone shot="notice" nextShot="share" changeAt={28} />
    </OverviewStep>
  );
}

export function OptionalPackCheck() {
  return (
    <OverviewStep step={5} title={<>Got a pack?<br /><span style={{ color: c.saffron }}>Check its details.</span></>} description="Scan or type its barcode. You can also enter the name, batch code and dates." note="An optional check against published warnings. It cannot tell you whether food is safe.">
      <OverviewPhone shot="pack-barcode" nextShot="pack-details" changeAt={56} />
    </OverviewStep>
  );
}
