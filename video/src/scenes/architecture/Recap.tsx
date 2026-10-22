import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame, CHAPTERS, Marker } from "../../components/ArchFrame";
import { Edge, Group, Node, Packets, type Pt } from "../../components/Diagram";
import { c, clamp, easeOut, mono, snappy } from "../../theme";

const H = 96;
const ROWS = [392, 542, 692];
const MID = ROWS.map((y) => y + H / 2);
const WORKER = { x: 478, y: 532, w: 504, h: 116 };
const WY = WORKER.y + WORKER.h / 2;
const COL = { src: { x: 112, w: 250 }, vercel: { x: 1118, w: 304 }, people: { x: 1540, w: 268 } };
const SRC_RIGHT = COL.src.x + COL.src.w;
const WORKER_RIGHT = WORKER.x + WORKER.w;
const VERCEL_RIGHT = COL.vercel.x + COL.vercel.w;

const SOURCES = [{ title: "FSA", sub: "UK" }, { title: "FDA", sub: "US" }, { title: "USDA FSIS", sub: "US" }];
const CLOUDFLARE = [
  { title: "Cron", sub: "daily refresh", x: 478, y: 392 },
  { title: "Queues", sub: "import batches", x: 742, y: 392 },
  { title: "R2", sub: "archives", x: 478, y: 692 },
  { title: "D1", sub: "warnings", x: 742, y: 692 },
];
const VERCEL = [{ title: "Next.js", sub: "website and checks" }, { title: "/mcp", sub: "4 read-only tools" }, { title: "Notion routes", sub: "OAuth and webhooks" }];
const PEOPLE = [{ title: "Browser", sub: "browse, check, share" }, { title: "AI assistants", sub: "ChatGPT and others" }, { title: "Notion list", sub: "review results" }];
const ALSO = [
  { title: "Open Food Facts", sub: "name and brand", x: 1090, w: 250 },
  { title: "Publisher RSS", sub: "BBC, CBS, Guardian", x: 1354, w: 220 },
  { title: "PostHog EU", sub: "opt-in counts", x: 1588, w: 220 },
];
const ALSO_Y = 862;
// Stretches the column-by-column build below; the finished map then holds while packets flow.
const BUILD = 2;

// Each route runs behind the opaque nodes, so packets read as passing through the Worker and Vercel.
const route = (row: number): Pt[] => [
  [SRC_RIGHT, MID[row]], [420, MID[row]], [420, WY], [WORKER.x, WY], [WORKER_RIGHT, WY], [1050, WY], [1050, MID[row]], [COL.vercel.x, MID[row]], [VERCEL_RIGHT, MID[row]], [COL.people.x, MID[row]],
];
const ROUTES = [0, 1, 2].map(route);
const INBOUND = ROUTES.map((points) => points.slice(0, 4));
const OUTBOUND = ROUTES.map((points) => points.slice(4, 8));
const DELIVER = ROUTES.map((points) => points.slice(8));
const INTERNAL: Pt[][] = CLOUDFLARE.map(({ x, y }) => (y < WORKER.y ? [[x + 120, y + H], [x + 120, WORKER.y]] : [[x + 120, WORKER.y + WORKER.h], [x + 120, y]]));
const BUS: Pt[] = [[1270, 820], [1270, 842]];
const TICKS: Pt[][] = ALSO.map(({ x, w }) => [[1270, 842], [x + w / 2, 842], [x + w / 2, ALSO_Y]]);

/** Closing map: sources, Cloudflare, Vercel and the people and tools that read the list. */
export function Recap() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = (at: number) => spring({ frame: frame - at * BUILD, fps, config: snappy });
  const draw = (from: number, to: number) => interpolate(frame, [from * BUILD, to * BUILD], [0, 1], { ...clamp, easing: easeOut });
  const push = interpolate(frame, [0, durationInFrames], [0.96, 1], { ...clamp, easing: easeOut });
  const summary = enter(72);
  const swipe = draw(80, 88);
  const label = { position: "absolute", top: 344, fontFamily: mono, fontSize: 21, lineHeight: "28px", letterSpacing: "0.1em", color: c.muted } as const;

  return (
    <ArchFrame chapter={CHAPTERS.length} kicker="THE WHOLE PICTURE" title={["How it fits together."]}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: "50% 60%" }}>
        <div style={{ ...label, left: COL.src.x + 12, opacity: enter(2) }}>SOURCES</div>
        <div style={{ ...label, left: COL.people.x + 12, opacity: enter(44) }}>PEOPLE</div>
        <Group x={450} y={360} w={560} h={460} label="CLOUDFLARE" enter={enter(12)} />
        <Group x={1090} y={360} w={360} h={460} label="VERCEL" enter={enter(30)} />
        <svg width={1920} height={1080} style={{ position: "absolute" }}>
          {INBOUND.map((points, i) => <Edge key={`in${i}`} points={points} progress={draw(18 + i * 2, 32 + i * 2)} />)}
          {INTERNAL.map((points, i) => <Edge key={`cf${i}`} points={points} progress={draw(24 + i * 2, 32 + i * 2)} />)}
          {OUTBOUND.map((points, i) => <Edge key={`out${i}`} points={points} progress={draw(36 + i * 2, 50 + i * 2)} />)}
          {DELIVER.map((points, i) => <Edge key={`to${i}`} points={points} progress={draw(50 + i * 2, 60 + i * 2)} />)}
          <Edge points={BUS} progress={draw(56, 60)} dashed />
          {TICKS.map((points, i) => <Edge key={`tick${i}`} points={points} progress={draw(58, 68)} dashed />)}
          {ROUTES.map((points, i) => <Packets key={`p${i}`} points={points} frame={frame} start={(64 + i * 6) * BUILD} period={150} count={3} />)}
        </svg>
        {SOURCES.map((node, i) => <Node key={node.title} x={COL.src.x} y={ROWS[i]} w={COL.src.w} h={H} titleSize={28} enter={enter(4 + i * 3)} {...node} />)}
        {CLOUDFLARE.map((node, i) => <Node key={node.title} x={node.x} y={node.y} w={240} h={H} titleSize={28} title={node.title} sub={node.sub} enter={enter(16 + i * 3)} />)}
        <Node {...WORKER} active title="Worker" sub="imports · API · Notion reviews" enter={enter(14)} />
        {VERCEL.map((node, i) => <Node key={node.title} x={COL.vercel.x} y={ROWS[i]} w={COL.vercel.w} h={H} titleSize={28} active={i === 0} enter={enter(32 + i * 3)} {...node} />)}
        {PEOPLE.map((node, i) => <Node key={node.title} x={COL.people.x} y={ROWS[i]} w={COL.people.w} h={H} titleSize={28} enter={enter(46 + i * 3)} {...node} />)}
        {ALSO.map((node, i) => (
          <Node key={node.title} x={node.x} y={ALSO_Y} w={node.w} h={74} titleSize={22} title={node.title} enter={enter(60 + i * 3)} style={{ padding: "10px 18px", borderStyle: "dashed", borderColor: "#d8cdb4", whiteSpace: "nowrap" }}>
            <div style={{ marginTop: 2, fontSize: 18, color: c.muted }}>{node.sub}</div>
          </Node>
        ))}
        <div style={{ position: "absolute", left: 112, top: 872, fontSize: 40, fontWeight: 850, letterSpacing: "-0.03em", opacity: summary, transform: `translateY(${(1 - summary) * 20}px)` }}>
          Official feeds in. <Marker swipe={swipe} pad={10} style={{ margin: "0 6px" }}>Sorted recalls</Marker> out.
        </div>
      </div>
    </ArchFrame>
  );
}
