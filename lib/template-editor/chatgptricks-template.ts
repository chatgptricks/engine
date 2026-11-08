/** The built-in @chatgptricks carousel at Instagram's 3:4 size (1080 × 1440).
 *
 * Pages, in order: Cover, Text + Media, List, Follow, Reaction, Two reactions, Three
 * reactions, then the Wide photo pair (Wide photo · start, Wide photo · end). Every
 * layer is a native text, image or shape layer. Agents fill a copy by slot name, for example
 * `createAgentDeck({name, templateId: CHATGPTRICKS_TEMPLATE_ID, slides: [{slots: {"cover-headline": "…"}}, …]})`.
 * The logo, hairlines, photo fades, "SWIPE FOR MORE", "FOLLOW THIS PAGE", the
 * post cards, their check marks and the X marks are fixed brand layers and never take copy.
 *
 * The Reaction pages (4 to 6) show one, two or three real posts from X under a
 * one-line title, each card drawn like a phone screenshot of the X app: a black
 * box with slightly rounded corners, a thin grey border and black padding inside,
 * the profile photo, the name and its check mark, the @handle, the X.com mark and
 * the post word for word, scaled with the screenshot so it wraps like X. Each card
 * is as tall as its post, so a page holds one long post, two medium ones or three
 * short ones, and the title and cards are centred on the page together. These
 * pages have no source line: the cards show whose posts they are. The second and third
 * cards' slots end in "-2" and "-3". A card takes the author's name, @handle,
 * profile photo (`reaction-avatar`, a pbs.twimg.com URL) and the post's text;
 * its hidden `reaction-media` layer shows the post's photo when it's filled and
 * unhidden at the photo's proportions. `reactionSlots`, `packReactions` and
 * `reactionPhotoSizes` in lib/engine/x-reactions.ts build these values, trim the
 * text to the card and group posts onto pages; Recreate's deck stage
 * (`styleCards`) also sets each account's check mark (blue, gold for
 * organizations, grey for governments, hidden when unverified) and rounds an
 * organization's photo as a square. Keep each post's link (XReaction.url) in
 * the deck's caption or notes. Use these pages only for real posts.
 *
 * The Wide photo pair (pages 7 and 8, after the Reaction pages) shows one photo
 * that starts on page 7 and continues on page 8, split at the seam as people
 * swipe. Always use them together, page 7 then page 8, and fill `wide-photo`
 * once, on page 7: the frame takes the photo's own proportions (pass the
 * photo's size as `photoSize`) and an optional `seam` (0.1 to 0.9, the share of
 * the photo on page 7) keeps faces and text off the cut. The source line is on
 * page 8. Agents get these page numbers from the template (each page type's
 * `pair`), so they follow the pair wherever it moves.
 *
 * The definition lives in model.ts (see `chatgptricksTemplate` there) so that
 * model.ts keeps no runtime imports; this module is its typed entry point. */
import { BUILT_IN_TEMPLATES, type DesignTemplate } from "./model";

export const CHATGPTRICKS_TEMPLATE_ID = "chatgptricks-3x4";
export const CHATGPTRICKS_SIZE = { width: 1080, height: 1440 } as const;

/** Slot names per page (the List page column by column). Photo slots take an image URL.
 * agentTemplateSlots() returns the same slots in top-to-bottom order with character guides. */
export const CHATGPTRICKS_SLOTS = [
  { page: 0, label: "Cover", text: ["cover-headline"], photo: ["photo"] },
  { page: 1, label: "Text + Media", text: ["title", "body", "source"], photo: ["media"] },
  { page: 2, label: "List", text: ["title", "body", "list-left-heading", "list-left-items", "list-right-heading", "list-right-items", "source"], photo: [] },
  { page: 3, label: "Follow", text: ["cta"], photo: ["photo"] },
  { page: 4, label: "Reaction", text: ["title", "reaction-name", "reaction-handle", "reaction-text"], photo: ["reaction-avatar"] },
  { page: 5, label: "Two reactions", text: ["title", "reaction-name", "reaction-handle", "reaction-text", "reaction-name-2", "reaction-handle-2", "reaction-text-2"], photo: ["reaction-avatar", "reaction-avatar-2"] },
  { page: 6, label: "Three reactions", text: ["title", "reaction-name", "reaction-handle", "reaction-text", "reaction-name-2", "reaction-handle-2", "reaction-text-2", "reaction-name-3", "reaction-handle-3", "reaction-text-3"], photo: ["reaction-avatar", "reaction-avatar-2", "reaction-avatar-3"] },
  // One photo across pages 7 and 8: filled once, on page 7.
  { page: 7, label: "Wide photo · start", text: ["title", "body"], photo: ["wide-photo"] },
  { page: 8, label: "Wide photo · end", text: ["title", "body", "source"], photo: [] },
] as const;

function find(): DesignTemplate {
  const template = BUILT_IN_TEMPLATES.find(candidate => candidate.id === CHATGPTRICKS_TEMPLATE_ID);
  if (!template) throw new Error(`The built-in template ${CHATGPTRICKS_TEMPLATE_ID} is missing.`);
  return template;
}

export const CHATGPTRICKS_TEMPLATE: DesignTemplate = find();
