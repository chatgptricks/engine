/**
 * Stage 6, design (build step D): one Opus `work` loop builds every slide in
 * HTML layers, from the page's template and its saved layouts, in its brand,
 * with real assets (design-tools.ts, cut.ts). A fix round edits the same deck
 * with the critics' instructions. Its role cards are ../cards/design.ts.
 */
import { RecreateError } from "../claude";
import type { StageRunner } from "../context";

export const design: StageRunner = async () => {
  throw new RecreateError("Designing the slides isn't built yet (build step D).", 501);
};
