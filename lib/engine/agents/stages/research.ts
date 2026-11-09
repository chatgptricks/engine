/**
 * Stage 2, research (build step B): Muse's steps in an Opus `work` loop, with
 * web search and fetch, search_x, x_post, page_posts (../page-posts.ts) and
 * our_library. An exact copy runs the quick check: the post, the origin and
 * fabrication signs only. Its role cards are ../cards/research.ts.
 */
import { RecreateError } from "../claude";
import type { StageRunner } from "../context";

export const research: StageRunner = async () => {
  throw new RecreateError("Researching the story isn't built yet (build step B).", 501);
};
