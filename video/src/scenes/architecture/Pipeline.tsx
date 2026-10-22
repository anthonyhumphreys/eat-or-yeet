import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { Edge, Group, Node, Packets, type Pt } from "../../components/Diagram";
import { c, clamp, mono, snappy } from "../../theme";

const ROW = { y: 560, w: 276, h: 210 };
const XS = [112, 467, 822, 1177, 1532];
const MID = ROW.y + ROW.h / 2;
// One line runs behind the opaque nodes, so packets appear to pass through each stage.
const FLOW: Pt[] = [[XS[0] + ROW.w, MID], [XS[4], MID]];
const NODES = [
  { label: "Sources", title: "Official feeds", sub: "FSA, FDA and USDA FSIS" },
  { label: "Worker cron", title: "Daily refresh", sub: "Each source on its own schedule" },
  { label: "R2", title: "Private archive", sub: "Validated before import" },
  { label: "Queues", title: "25 per batch", sub: "Progress commits with each batch" },
  { label: "D1", title: "Warning records", sub: "Originals kept for audit" },
];
const STEPS = [
  { at: 36, node: 1, text: "Each source refreshes independently, every day." },
  { at: 120, node: 2, text: "Complete archives are validated, then staged in private R2." },
  { at: 204, node: 3, text: "A queue imports 25 notices at a time and commits each batch." },
  { at: 288, node: 4, text: "D1 keeps the originals and a compact table for matching." },
];

/** Chapter 2: how a refresh moves through Cloudflare. */
export function Pipeline() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stepIndex = STEPS.findLastIndex((step) => frame >= step.at);
  const step = STEPS[Math.max(stepIndex, 0)];
  const caption = spring({ frame: frame - step.at, fps, config: snappy });
  const group = spring({ frame: frame - 22, fps, config: { damping: 200 } });

  return (
    <ArchFrame chapter={1} title={["Cloudflare runs", <span style={{ color: c.maybe }}>the import pipeline.</span>]}>
      <Group x={440} y={524} w={1396} h={282} label="CLOUDFLARE" enter={group} />
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <Edge points={FLOW} progress={interpolate(frame, [16, 56], [0, 1], clamp)} />
        <Packets points={FLOW} frame={frame} start={50} period={120} count={5} />
      </svg>
      {NODES.map((node, i) => (
        <Node
          key={node.label}
          x={XS[i]}
          y={ROW.y}
          w={ROW.w}
          h={ROW.h}
          enter={spring({ frame: frame - 8 - i * 8, fps, config: snappy })}
          active={stepIndex >= 0 && step.node === i}
          {...node}
        />
      ))}
      <div style={{ position: "absolute", left: 112, top: 858, display: "flex", alignItems: "baseline", gap: 22, opacity: stepIndex >= 0 ? caption : 0, transform: `translateY(${(1 - caption) * 20}px)` }}>
        <span style={{ fontFamily: mono, fontSize: 26, color: c.muted }}>{Math.max(stepIndex, 0) + 1}/{STEPS.length}</span>
        <span style={{ fontSize: 40, fontWeight: 750, letterSpacing: "-0.02em" }}>{step.text}</span>
      </div>
    </ArchFrame>
  );
}
