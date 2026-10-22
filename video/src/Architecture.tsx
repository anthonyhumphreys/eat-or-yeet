import type { ComponentType } from "react";
import { Series } from "remotion";

import { Outro } from "./scenes/Outro";
import { Assistants } from "./scenes/architecture/Assistants";
import { Health } from "./scenes/architecture/Health";
import { ArchIntro } from "./scenes/architecture/Intro";
import { Notion } from "./scenes/architecture/Notion";
import { PackFlow } from "./scenes/architecture/PackFlow";
import { Pipeline } from "./scenes/architecture/Pipeline";
import { Recap } from "./scenes/architecture/Recap";
import { Sources } from "./scenes/architecture/Sources";
import { Website } from "./scenes/architecture/Website";

// How the app works: sources, the Cloudflare pipeline, the website and the integrations. Hard cuts, as in the sizzle.
export const ARCHITECTURE_SCENES: { id: string; frames: number; Component: ComponentType }[] = [
  { id: "intro", frames: 140, Component: ArchIntro },
  { id: "sources", frames: 220, Component: Sources },
  { id: "pipeline", frames: 370, Component: Pipeline },
  { id: "health", frames: 280, Component: Health },
  { id: "website", frames: 260, Component: Website },
  { id: "pack-check", frames: 240, Component: PackFlow },
  { id: "assistants", frames: 290, Component: Assistants },
  { id: "notion", frames: 300, Component: Notion },
  { id: "recap", frames: 330, Component: Recap },
  { id: "outro", frames: 96, Component: Outro },
];

export const ARCHITECTURE_FRAMES = ARCHITECTURE_SCENES.reduce((sum, scene) => sum + scene.frames, 0);

export function Architecture() {
  return (
    <Series>
      {ARCHITECTURE_SCENES.map(({ id, frames, Component }) => (
        <Series.Sequence key={id} name={id} durationInFrames={frames} premountFor={15}>
          <Component />
        </Series.Sequence>
      ))}
    </Series>
  );
}
