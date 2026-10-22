import type { ComponentType } from "react";
import { Series } from "remotion";

import { BROWSE_FRAMES, Browse } from "./scenes/Browse";
import { Collage } from "./scenes/Collage";
import { KINETIC_FRAMES, Kinetic } from "./scenes/Kinetic";
import { Outro } from "./scenes/Outro";
import { PACK_CHECK_FRAMES, PackCheck } from "./scenes/PackCheck";
import { Problem } from "./scenes/Problem";
import { Stats } from "./scenes/Stats";
import { Title } from "./scenes/Title";

// Storyboard order. Hard cuts between scenes keep the pace; each scene animates its own entrance.
export const SCENES: { id: string; frames: number; Component: ComponentType }[] = [
  { id: "problem", frames: 88, Component: Problem },
  { id: "title", frames: 60, Component: Title },
  { id: "kinetic", frames: KINETIC_FRAMES, Component: Kinetic },
  { id: "browse", frames: BROWSE_FRAMES, Component: Browse },
  { id: "collage", frames: 84, Component: Collage },
  { id: "pack-check", frames: PACK_CHECK_FRAMES, Component: PackCheck },
  { id: "stats", frames: 76, Component: Stats },
  { id: "outro", frames: 90, Component: Outro },
];

export const SIZZLE_FRAMES = SCENES.reduce((sum, scene) => sum + scene.frames, 0);

export function Sizzle() {
  return (
    <Series>
      {SCENES.map(({ id, frames, Component }) => (
        <Series.Sequence key={id} name={id} durationInFrames={frames} premountFor={15}>
          <Component />
        </Series.Sequence>
      ))}
    </Series>
  );
}
