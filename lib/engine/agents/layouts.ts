/**
 * Save as layout (build step E, decision 3), for the chat's save_layout: a
 * slide becomes a new page in the template its post was made from, with a name
 * and a "use when" line, so the designer sees it in describePages (pages.ts)
 * and can start a slide from it. Its HTML layers keep the pattern; its own text
 * and photo layers become slots. The conversion is shared with the editor's
 * page menu (lib/template-editor/saved-layouts.ts); this saves it to the
 * workspace, the way saveDeck saves a deck.
 */
import { randomUUID } from "node:crypto";
import { checkLibrarySaveBudget } from "../../template-editor/library-budget";
import { parseLibrary, type DesignDocument } from "../../template-editor/model";
import { getEditorLibrary, LibraryConflictError, saveEditorLibrary } from "../../template-editor/persistence";
import { SavedLayoutError, withSavedLayout, type SavedLayoutResult } from "../../template-editor/saved-layouts";
import { storeNewImages } from "../../template-editor/stored-images";
import { RecreateError } from "./claude";

export type SaveLayoutInput = {
  /** The deck the slide is on. */
  deckId: string;
  /** The slide (deck page) to save. */
  pageId: string;
  name: string;
  /** When the designer should pick it, in one line. */
  useWhen: string;
  /** The deck as people see it now (the chat reads it from the live room). Without it, the saved deck is read from the workspace. */
  document?: DesignDocument;
};
export type SavedLayout = SavedLayoutResult;

export async function saveLayout(ownerKey: string, input: SaveLayoutInput): Promise<SavedLayout> {
  const images = new Map<string, string | null>();
  for (let attempt = 0; attempt < 4; attempt++) {
    const stored = await getEditorLibrary(ownerKey);
    const document = input.document ?? stored.library.designs.find(item => item.id === input.deckId && !item.deletedAt);
    if (!document || document.id !== input.deckId) throw new RecreateError("That post isn't in the workspace anymore.", 404);
    let result: ReturnType<typeof withSavedLayout>;
    try {
      result = withSavedLayout(stored.library, document, input);
    } catch (error) {
      throw error instanceof SavedLayoutError ? new RecreateError(error.message, error.status) : error;
    }
    // Images new to the workspace (data: images in HTML layers, say) become media files, as a deck's do.
    const templates = await Promise.all(result.library.templates.map(async template => template.id === result.saved.templateId ? (await storeNewImages(ownerKey, template, stored.library, images)).value : template));
    const next = parseLibrary({ ...result.library, templates });
    if (!next) throw new RecreateError("The layout doesn't fit Engine's workspace limits. Delete old drafts or saved layouts, then retry.", 413);
    const budget = checkLibrarySaveBudget(next);
    if (!budget.ok) throw new RecreateError(budget.error, 413);
    try {
      await saveEditorLibrary(ownerKey, next, stored.revision, randomUUID());
      return result.saved;
    } catch (error) {
      if (!(error instanceof LibraryConflictError) || attempt === 3) throw error;
    }
  }
  throw new RecreateError("The workspace is busy. Retry in a moment.", 409);
}
