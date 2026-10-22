import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { SearchIcon } from "../components/brand";
import { Scribble } from "../components/Scribble";
import { c, clamp, sans, snappy } from "../theme";

const QUERY = "food recalls this week";
const TYPE_START = 8;
const CHARS_PER_FRAME = 0.9;
const SCRIBBLE_AT = 50;

/** Scene 1: the old way. A search for recalls gets crossed out. */
export function Problem() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: snappy });
  const typed = QUERY.slice(0, Math.max(0, Math.floor((frame - TYPE_START) * CHARS_PER_FRAME)));
  const typingDone = typed.length === QUERY.length;
  const cursorOn = !typingDone || Math.floor(frame / 8) % 2 === 0;
  const hit = spring({ frame: frame - SCRIBBLE_AT, fps, config: { damping: 12, stiffness: 260 } });
  const dim = interpolate(frame, [SCRIBBLE_AT, SCRIBBLE_AT + 10], [1, 0.45], clamp);

  return (
    <AbsoluteFill style={{ background: c.cream, alignItems: "center", justifyContent: "center", fontFamily: sans }}>
      <div style={{ position: "relative", transform: `scale(${interpolate(enter, [0, 1], [0.92, 1]) - hit * 0.03})`, opacity: enter }}>
        <div
          style={{
            width: 1560,
            height: 200,
            borderRadius: 100,
            background: c.card,
            border: `5px solid ${c.border}`,
            display: "flex",
            alignItems: "center",
            gap: 44,
            padding: "0 78px",
            color: c.ink,
            opacity: dim,
          }}
        >
          <SearchIcon size={78} color={c.muted} />
          <span style={{ fontSize: 96, fontWeight: 600, letterSpacing: "-0.03em", whiteSpace: "pre" }}>
            {typed}
            <span style={{ display: "inline-block", width: 7, height: 100, marginLeft: 8, verticalAlign: "-14px", background: c.ink, opacity: cursorOn && frame < SCRIBBLE_AT ? 1 : 0 }} />
          </span>
        </div>
        <Scribble width={1440} height={360} start={SCRIBBLE_AT} strokeFrames={8} stroke={32} />
      </div>
    </AbsoluteFill>
  );
}
