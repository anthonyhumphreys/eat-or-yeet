import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { ArchFrame } from "../../components/ArchFrame";
import { Edge, Packets, type Pt } from "../../components/Diagram";
import { c, clamp, mono, snappy } from "../../theme";

const TOOLS = [
  { name: "check_product", text: "Compare a pack with published warnings" },
  { name: "search_warnings", text: "Search a country's warnings" },
  { name: "get_warning", text: "Open one warning and its advice" },
  { name: "get_coverage", text: "Show source freshness" },
];
const HUB: Pt = [1420, 600];
const RING = 320;
// Hosts listed on the public integrations page.
const CLIENTS = [
  { name: "ChatGPT", tag: "plugin", angle: -90 },
  { name: "Codex", angle: -30 },
  { name: "Cursor", angle: 30 },
  { name: "Gemini CLI", angle: 90 },
  { name: "Hermes", angle: 150 },
  { name: "OpenClaw", angle: 210 },
].map((client) => {
  const rad = (client.angle * Math.PI) / 180;
  return { ...client, at: [HUB[0] + RING * Math.cos(rad), HUB[1] + RING * Math.sin(rad)] as Pt };
});
const TOOLS_AT = 80;
const TOOL_FRAMES = 36;

/** Chapter 6: the public MCP endpoint and the assistants that connect to it. */
export function Assistants() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hub = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 180 } });
  const activeTool = frame >= TOOLS_AT ? Math.floor((frame - TOOLS_AT) / TOOL_FRAMES) % TOOLS.length : -1;
  const caption = spring({ frame: frame - 150, fps, config: snappy });

  return (
    <ArchFrame chapter={5} title={["One MCP server", <span style={{ color: c.maybe }}>for AI assistants.</span>]} sub="Streamable HTTP. Read-only. No account or API key.">
      <div style={{ position: "absolute", left: 112, top: 498 }}>
        {TOOLS.map((tool, i) => {
          const p = spring({ frame: frame - 28 - i * 8, fps, config: snappy });
          const active = i === activeTool;
          return (
            <div key={tool.name} style={{ display: "flex", alignItems: "center", gap: 22, height: 76, marginBottom: 8, padding: "0 22px", borderRadius: 18, background: active ? c.marigold : "transparent", opacity: p, transform: `translateX(${(1 - p) * -30}px)` }}>
              <span style={{ width: 260, fontFamily: mono, fontSize: 27, color: c.ink }}>{tool.name}</span>
              <span style={{ fontSize: 25, fontWeight: 600, color: active ? c.ink : c.muted }}>{tool.text}</span>
            </div>
          );
        })}
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute" }}>
        <circle cx={HUB[0]} cy={HUB[1]} r={RING} fill="none" stroke={c.border} strokeWidth={2} strokeDasharray="8 12" opacity={hub} />
        {CLIENTS.map((client, i) => {
          const spoke: Pt[] = [client.at, HUB];
          return (
            <g key={client.name}>
              <Edge points={spoke} progress={interpolate(frame, [26 + i * 5, 44 + i * 5], [0, 1], clamp)} />
              <Packets points={spoke} frame={frame} start={54 + i * 8} period={60} count={1} size={18} />
            </g>
          );
        })}
      </svg>
      <div style={{ position: "absolute", left: HUB[0] - 130, top: HUB[1] - 130, width: 260, height: 260, borderRadius: 130, background: c.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transform: `scale(${hub})` }}>
        <div style={{ fontFamily: mono, fontSize: 52, color: c.cream }}>/mcp</div>
        <div style={{ marginTop: 6, fontFamily: mono, fontSize: 20, color: c.darkMuted }}>eatoryeet.app</div>
      </div>
      {CLIENTS.map((client, i) => {
        const p = spring({ frame: frame - 20 - i * 5, fps, config: snappy });
        return (
          <div key={client.name} style={{ position: "absolute", left: client.at[0], top: client.at[1], transform: `translate(-50%, -50%) scale(${p})`, display: "flex", alignItems: "center", gap: 10, padding: "12px 24px", borderRadius: 999, background: c.card, border: `3px solid ${c.border}`, fontSize: 28, fontWeight: 800, whiteSpace: "nowrap" }}>
            {client.name}
            {client.tag ? <span style={{ padding: "2px 12px", borderRadius: 999, background: c.marigold, fontSize: 19, fontWeight: 750 }}>{client.tag}</span> : null}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 112, top: 866, width: 900, opacity: caption, transform: `translateY(${(1 - caption) * 20}px)` }}>
        <div style={{ fontSize: 30, fontWeight: 750, letterSpacing: "-0.015em" }}>Same matcher and source-health gate as the website.</div>
        <div style={{ marginTop: 6, fontSize: 24, color: c.muted }}>Hosts that support MCP Apps can show an embedded result card.</div>
      </div>
    </ArchFrame>
  );
}
