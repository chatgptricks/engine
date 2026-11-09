/**
 * Stage 1, source (build step A): imports the post (or reads the uploaded
 * screenshots), keeps its slides as workspace images, and makes one vision
 * call over the slides, the caption and the post's details (traction too) to
 * write the SourceNotes every later stage reads. Its role card is
 * ../cards/source.ts.
 */
import { RecreateError } from "../claude";
import type { StageRunner } from "../context";

export const source: StageRunner = async () => {
  throw new RecreateError("Reading the original post isn't built yet (build step A).", 501);
};
