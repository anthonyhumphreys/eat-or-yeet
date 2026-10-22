import { Composition } from "remotion";

import { SIZZLE_FRAMES, Sizzle } from "./Sizzle";
import { OVERVIEW_FRAMES, Overview } from "./Overview";
import { ARCHITECTURE_FRAMES, Architecture } from "./Architecture";
import { FPS } from "./theme";

export function Root() {
  return <>
    <Composition id="Sizzle" component={Sizzle} durationInFrames={SIZZLE_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="Overview" component={Overview} durationInFrames={OVERVIEW_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="Architecture" component={Architecture} durationInFrames={ARCHITECTURE_FRAMES} fps={FPS} width={1920} height={1080} />
  </>;
}
