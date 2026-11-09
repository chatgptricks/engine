/**
 * Save as layout (build step E, decision 3): a slide becomes a new page in its
 * page's template, with a name and a "use when" line. Its HTML keeps the
 * pattern and its native text and photo layers become slots, so the designer
 * sees it in describePages. The editor's page menu and the chat's save_layout
 * call this.
 */
import { RecreateError } from "./claude";

export type SaveLayoutInput = {
  /** The deck the slide is on. */
  deckId: string;
  /** The slide (deck page) to save. */
  pageId: string;
  name: string;
  /** When the designer should pick it, in one line. */
  useWhen: string;
};
export type SavedLayout = { templateId: string; pageIndex: number; name: string };

export async function saveLayout(ownerKey: string, input: SaveLayoutInput): Promise<SavedLayout> {
  void ownerKey; void input;
  throw new RecreateError("Saving a slide as a layout isn't built yet (build step E).", 501);
}
