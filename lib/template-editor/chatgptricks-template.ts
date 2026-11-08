/** The built-in @chatgptricks carousel at Instagram's 3:4 size (1080 × 1440).
 *
 * Pages, in order: Cover, Text + Media, List, Follow, Reaction, Reactions, then
 * the Wide photo pair (Wide photo · start, Wide photo · end). Every
 * layer is a native text, image or shape layer. Agents fill a copy by slot name, for example
 * `createAgentDeck({name, templateId: CHATGPTRICKS_TEMPLATE_ID, slides: [{slots: {"cover-headline": "…"}}, …]})`.
 * The logo, hairlines, photo fades, "SWIPE FOR MORE", "FOLLOW THIS PAGE", the
 * post cards and the X marks are fixed brand layers and never take copy.
 *
 * Reaction (page 4) shows one real post from X as a card under a one-line
 * title; Reactions (page 5) stacks two, the second card's slots ending in "-2".
 * A card takes the author's name, @handle, profile photo (`reaction-avatar`,
 * a pbs.twimg.com URL), the post's text word for word and a stats line such as
 * "48K likes · 3.1K reposts · Nov 3, 2026". `reactionSlots` in
 * lib/engine/x-reactions.ts builds these values and trims the text to the card
 * (about 280 characters on Reaction, 160 per card on Reactions). Keep the
 * post's link (XReaction.url) in the deck's caption or notes. Use these pages
 * only for real posts.
 *
 * The Wide photo pair (pages 6 and 7) shows one photo that starts on page 6 and
 * continues on page 7, split at the seam as people swipe. Always use them
 * together, page 6 then page 7, and fill `wide-photo` once, on page 6: the
 * frame takes the photo's own proportions (pass the photo's size as
 * `photoSize`) and an optional `seam` (0.1 to 0.9, the share of the photo on
 * page 6) keeps faces and text off the cut. The source line is on page 7.
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
  { page: 4, label: "Reaction", text: ["title", "reaction-name", "reaction-handle", "reaction-text", "reaction-meta", "source"], photo: ["reaction-avatar"] },
  { page: 5, label: "Reactions", text: ["title", "reaction-name", "reaction-handle", "reaction-text", "reaction-meta", "reaction-name-2", "reaction-handle-2", "reaction-text-2", "reaction-meta-2", "source"], photo: ["reaction-avatar", "reaction-avatar-2"] },
  // One photo across pages 6 and 7: filled once, on page 6.
  { page: 6, label: "Wide photo · start", text: ["title", "body"], photo: ["wide-photo"] },
  { page: 7, label: "Wide photo · end", text: ["title", "body", "source"], photo: [] },
] as const;

function find(): DesignTemplate {
  const template = BUILT_IN_TEMPLATES.find(candidate => candidate.id === CHATGPTRICKS_TEMPLATE_ID);
  if (!template) throw new Error(`The built-in template ${CHATGPTRICKS_TEMPLATE_ID} is missing.`);
  return template;
}

export const CHATGPTRICKS_TEMPLATE: DesignTemplate = find();
