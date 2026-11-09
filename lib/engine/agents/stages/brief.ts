/**
 * Stage 4, brief (build step C): the six sections (what happened, backstory,
 * positions and reactions, guardrails, template notes, links) and the slide
 * plan in the house shape. A full recreation only. Its role card is
 * ../cards/brief.ts.
 */
import { RecreateError } from "../claude";
import type { StageRunner } from "../context";

export const brief: StageRunner = async () => {
  throw new RecreateError("Writing the brief isn't built yet (build step C).", 501);
};
