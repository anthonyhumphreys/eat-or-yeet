import type { ComponentType } from "react";
import { Series } from "remotion";

import { Outro } from "./scenes/Outro";
import { BrowseWarnings, ChooseRegion, FilterWarnings, OptionalPackCheck, OverviewIntro, ReadWarning, ShareWarning } from "./scenes/OverviewFlow";

export const OVERVIEW_SCENES: { id: string; frames: number; Component: ComponentType }[] = [
  { id: "intro", frames: 75, Component: OverviewIntro },
  { id: "choose-region", frames: 90, Component: ChooseRegion },
  { id: "browse-warnings", frames: 120, Component: BrowseWarnings },
  { id: "filter-warnings", frames: 150, Component: FilterWarnings },
  { id: "read-warning", frames: 135, Component: ReadWarning },
  { id: "share-warning", frames: 90, Component: ShareWarning },
  { id: "optional-pack-check", frames: 120, Component: OptionalPackCheck },
  { id: "outro", frames: 90, Component: Outro },
];

export const OVERVIEW_FRAMES = OVERVIEW_SCENES.reduce((sum, scene) => sum + scene.frames, 0);

export function Overview() {
  return (
    <Series>
      {OVERVIEW_SCENES.map(({ id, frames, Component }) => (
        <Series.Sequence key={id} name={id} durationInFrames={frames} premountFor={15}>
          <Component />
        </Series.Sequence>
      ))}
    </Series>
  );
}
