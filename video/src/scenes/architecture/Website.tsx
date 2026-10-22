import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { Edge, Node, Packets, type Pt } from "../../components/Diagram";
import { Phone } from "../../components/Phone";
import { c, clamp, mono, snappy } from "../../theme";
import { Screen } from "../Browse";

const POINTS = [
  "Browse one country at a time, 50 recalls per page.",
  "The list cache refreshes every minute.",
  "Publisher news from BBC, CBS and The Guardian loads on its own.",
];
const ROW = { y: 740, h: 112 };
const NODES = [
  { x: 112, w: 200, title: "D1", sub: "warnings" },
  { x: 382, w: 240, title: "Worker", sub: "RPC API" },
  { x: 692, w: 250, title: "Next.js", sub: "on Vercel" },
  { x: 1012, w: 200, title: "Browser", sub: "your phone" },
];
const FLOW: Pt[] = [[NODES[0].x + NODES[0].w, ROW.y + ROW.h / 2], [NODES[3].x, ROW.y + ROW.h / 2]];

/** Chapter 4: the main feature. The website reads the list from the Worker and serves it to phones. */
export function Website() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phone = spring({ frame, fps, config: snappy });
  const secret = spring({ frame: frame - 140, fps, config: snappy });

  return (
    <ArchFrame chapter={3} title={["Next.js on Vercel", <span style={{ color: c.maybe }}>serves the list.</span>]}>
      <div style={{ position: "absolute", left: 112, top: 474, width: 1120 }}>
        {POINTS.map((text, i) => {
          const p = spring({ frame: frame - 20 - i * 24, fps, config: snappy });
          return (
            <div key={text} style={{ display: "flex", alignItems: "center", gap: 22, height: 64, fontSize: 32, fontWeight: 650, letterSpacing: "-0.015em", opacity: p, transform: `translateX(${(1 - p) * -30}px)` }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: c.marigold, flexShrink: 0 }} />
              {text}
            </div>
          );
        })}
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <Edge points={FLOW} progress={interpolate(frame, [100, 126], [0, 1], clamp)} />
        <Packets points={FLOW} frame={frame} start={124} period={84} count={4} />
      </svg>
      {NODES.map((node, i) => (
        <Node key={node.title} x={node.x} y={ROW.y} w={node.w} h={ROW.h} title={node.title} sub={node.sub} titleSize={32} active={i === 2} enter={spring({ frame: frame - 92 - i * 6, fps, config: snappy })} />
      ))}
      <div style={{ position: "absolute", left: NODES[1].x, top: ROW.y + ROW.h + 22, fontFamily: mono, fontSize: 20, color: c.muted, opacity: secret }}>
        server to server · the shared secret never reaches the browser
      </div>
      <div style={{ position: "absolute", left: 1330, top: 66, transform: `translateY(${(1 - phone) * 400}px) rotate(${(1 - phone) * 5}deg)` }}>
        <Phone>
          <Screen frame={frame} />
        </Phone>
      </div>
    </ArchFrame>
  );
}
