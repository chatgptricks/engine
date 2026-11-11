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
 * its hidden `reaction-media` layer shows the post's photo (or a video's or GIF's
 * poster frame) when it's filled and unhidden at the photo's proportions. On a video
 * Recreate also shows X's play button (`reaction-play`) and the video's length in a
 * badge (`reaction-length`, `reaction-length-text`); on a GIF the badge says "GIF". `reactionSlots`, `packReactions` and
 * `reactionPhotoSizes` in lib/engine/x-reactions.ts build these values, trim the
 * text to the card and group posts onto pages; Recreate's deck stage
 * (`styleCards`) also sets each account's check mark (blue, gold for
 * organizations, grey for governments, hidden when unverified) and rounds an
 * organization's photo as a square. Keep each post's link (XReaction.url) in
 * the deck's caption or notes. Use these pages only for real posts.
 *
 * The simpler Recreate draws the same cards as HTML layers instead (`xCardHtml`
 * below, placed by `htmlReactionCards` in lib/engine/agents/deck.ts): one
 * platform card per post (platform-cards.ts), measured from the native card, so
 * a designer can edit a card as a design. The native layers stay for the first
 * team's exact copy until the cleanup. `redditCardHtml` draws a Reddit comment
 * the same way, as Ivan's design proof does.
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
import { BUILT_IN_TEMPLATES, X_BADGES, X_CARD, X_PLAY_BUTTON, X_POST_COLORS, type DesignTemplate } from "./model";
import { platformCardClass } from "./platform-cards";

export const CHATGPTRICKS_TEMPLATE_ID = "chatgptricks-3x4";
export const CHATGPTRICKS_SIZE = { width: 1080, height: 1440 } as const;

/** Slot names per page (the List page column by column). Photo slots take an image URL.
 * agentTemplateSlots() returns the same slots in top-to-bottom order with character guides. */
export const CHATGPTRICKS_SLOTS = [
  // cover-remark is the fixed SWIPE FOR MORE until a post writes its own bottom line.
  { page: 0, label: "Cover", text: ["cover-headline", "cover-remark"], photo: ["photo"] },
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

// ── Post cards as HTML layers ────────────────────────────────────────────────

/** X's logo, as a card's top right corner draws it (viewBox 0 0 1200 1227). */
export const X_LOGO_PATH = "M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z";

/** One post from X as its HTML card draws it. Images are workspace files (an HTML layer loads
 * nothing from outside Engine); without an avatar the card draws a grey one. The media's size
 * is its size on the page, in 1080-wide pixels (reactionPhotoSizes). */
export type XCard = {
  name: string;
  /** With its @. */
  handle: string;
  text: string;
  badge?: "blue" | "gold" | "grey" | null;
  /** Organizations' profile photos are rounded squares. */
  square?: boolean;
  avatar?: string | null;
  media?: { src: string; width: number; height: number; alt: string; kind?: "photo" | "video" | "gif"; badge?: string | null } | null;
};

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** The native card's measurements (model.ts, xPost), in px from the card's outer edge. */
const X_LAYOUT = (() => {
  const shot = (value: number) => value * X_CARD.scale, inCard = (value: number) => X_CARD.pad + shot(value);
  // SF Pro Display's baseline sits 0.95 em plus half the leading under the top of its line box.
  const lineTop = (baseline: number, size: number) => inCard(baseline) - ((1.2 - 1.19) / 2 + .95) * size;
  const name = shot(49.7), handle = shot(51.2), com = shot(61.5), mark = shot(44), markX = inCard(969), nameX = inCard(194);
  return {
    avatar: shot(142), avatarTop: inCard(37), name, nameX, nameTop: lineTop(95, name), handle, handleTop: lineTop(154.5, handle),
    badge: shot(44), badgeGap: shot(11), nameWidth: markX - shot(31) - shot(11) - shot(44) - nameX,
    mark, markX, markTop: inCard(56), markWidth: mark * 1200 / 1227, com, comTop: lineTop(99, com),
  };
})();

const PLAY_BUTTON_SVG = decodeURIComponent(X_PLAY_BUTTON.slice(X_PLAY_BUTTON.indexOf(",") + 1)).replace("<svg ", '<svg class="play" aria-hidden="true" ');

/**
 * A post from X as one HTML layer, drawn like the native card: X's dark mode, the profile
 * photo, the bold name and its check mark, the grey @handle, the X.com mark, the post word for
 * word at the screenshot's size, and its photo (a video's poster frame with the play button and
 * its length, a GIF's with "GIF"). Lay it out 936 px wide (designWidth). The card hugs its post
 * in the middle of its layer, or from the top when the post runs longer than the layer.
 * The outermost element carries the platform mark, so X's colors are allowed in it.
 */
export function xCardHtml(card: XCard): { html: string; css: string } {
  const border = X_CARD.border, at = (value: number) => px(value - border), g = X_LAYOUT, length = X_CARD.length;
  const css = [
    ":root{display:flex;flex-direction:column}",
    `.platform-card{position:relative;margin:auto 0;width:${px(X_CARD.width)};box-sizing:border-box;background:${X_POST_COLORS.card};border:${px(border)} solid ${X_POST_COLORS.border};border-radius:${px(X_CARD.radius)};padding:${at(X_CARD.textTop)} ${at(X_CARD.inset)} ${at(X_CARD.foot)};font-family:"Chirp","SF Pro Display",sans-serif;color:${X_POST_COLORS.text}}`,
    `.avatar{position:absolute;left:${at(X_CARD.inset)};top:${at(g.avatarTop)};width:${px(g.avatar)};height:${px(g.avatar)};border-radius:${card.square ? px(g.avatar * .113) : "50%"};overflow:hidden;object-fit:cover;display:block}`,
    `.who{position:absolute;left:${at(g.nameX)};top:${at(g.nameTop)};height:${px(g.name * 1.2)};display:flex;align-items:center;gap:${px(g.badgeGap)};white-space:nowrap}`,
    `.name{font-weight:700;font-size:${px(g.name)};line-height:${px(g.name * 1.2)};max-width:${px(g.nameWidth)};overflow:hidden;text-overflow:ellipsis}`,
    `.badge{flex:none;width:${px(g.badge)};height:${px(g.badge)};display:block}`,
    `.handle{position:absolute;left:${at(g.nameX)};top:${at(g.handleTop)};font-size:${px(g.handle)};line-height:${px(g.handle * 1.2)};color:${X_POST_COLORS.handle};white-space:nowrap}`,
    `.x-logo{position:absolute;left:${at(g.markX)};top:${at(g.markTop)};width:${px(g.markWidth)};height:${px(g.mark)};display:block}`,
    `.x-com{position:absolute;left:${at(g.markX + g.markWidth)};top:${at(g.comTop)};font-weight:700;font-size:${px(g.com)};line-height:${px(g.com * 1.2)}}`,
    `.text{margin:0;font-size:${px(X_CARD.size)};line-height:${px(X_CARD.line)};white-space:pre-line;overflow-wrap:anywhere}`,
    `.media{position:relative;margin-top:${px(X_CARD.mediaGap)};overflow:hidden;border-radius:${px(X_CARD.mediaRadius)}}`,
    ".media img{display:block;width:100%;height:100%;object-fit:cover}",
    `.play{position:absolute;left:50%;top:50%;width:${px(X_CARD.play)};height:${px(X_CARD.play)};margin:${px(-X_CARD.play / 2)} 0 0 ${px(-X_CARD.play / 2)};display:block}`,
    `.length{position:absolute;left:${px(length.inset)};bottom:${px(length.inset)};height:${px(length.height)};padding:0 ${px(length.pad)};border-radius:${px(length.radius)};background:${length.fill};color:${length.color};font-size:${px(length.size)};font-weight:600;line-height:${px(length.height)}}`,
  ].join("");
  // The gold seal is a gradient (135°, top left to bottom right); the rosettes are flat.
  const look = card.badge ? X_BADGES[card.badge] : null, gold = card.badge === "gold";
  const badge = !look ? "" : `<svg class="badge" viewBox="0 0 100 100" aria-hidden="true">${gold ? `<defs><linearGradient id="badge-fill" x1="0" y1="0" x2="1" y2="1">${X_BADGES.gold.gradient.stops.map(stop => `<stop offset="${stop.position / 100}" stop-color="${stop.color}"/>`).join("")}</linearGradient></defs>` : ""}<path d="${look.path}" fill-rule="evenodd" fill="${gold ? "url(#badge-fill)" : look.fill}"/></svg>`;
  const avatar = card.avatar
    ? `<img class="avatar" src="${escapeHtml(card.avatar)}" alt="">`
    : `<svg class="avatar" viewBox="0 0 104 104" aria-hidden="true"><path d="M0 0H104V104H0Z" fill="${X_POST_COLORS.handle}"/><path d="M32 40a20 20 0 1 0 40 0a20 20 0 1 0 -40 0Z" fill="${X_POST_COLORS.border}"/><path d="M16 104C16 74 88 74 88 104Z" fill="${X_POST_COLORS.border}"/></svg>`;
  const media = !card.media ? "" : `<div class="media" style="width:${px(card.media.width)};height:${px(card.media.height)}"><img src="${escapeHtml(card.media.src)}" alt="${escapeHtml(card.media.alt)}">${card.media.kind === "video" ? PLAY_BUTTON_SVG : ""}${card.media.badge ? `<span class="length">${escapeHtml(card.media.badge)}</span>` : ""}</div>`;
  const html = `<div class="${platformCardClass("x")}">${avatar}<div class="who"><span class="name">${escapeHtml(card.name)}</span>${badge}</div><div class="handle">${escapeHtml(card.handle)}</div>`
    + `<svg class="x-logo" viewBox="0 0 1200 1227" aria-hidden="true"><path d="${X_LOGO_PATH}" fill="${X_POST_COLORS.text}"/></svg><span class="x-com">.com</span><p class="text">${escapeHtml(card.text)}</p>${media}</div>`;
  return { html, css };
}

/** One Reddit comment as its HTML card draws it (Ivan's design proof): Reddit's dark mode, its
 * default avatar in the comment's colour, the name in bold and the time in grey, then the words.
 * A story card has 50 px text on 63 px lines; a cover's card 38 on 49. Lay it out 936 px wide. */
export type RedditCard = { name: string; when: string; text: string; avatar: "red" | "orange" | "blue" | "green"; size?: "story" | "cover" };
const REDDIT_AVATARS = { red: "#FF4500", orange: "#FF8717", blue: "#24A0ED", green: "#46D160" } as const;
const REDDIT_SIZES = {
  story: { avatar: 92, name: 40, text: 50, line: 63, top: 44, side: 48, bottom: 52, gap: 24, textGap: 28 },
  cover: { avatar: 64, name: 32, text: 38, line: 49, top: 34, side: 40, bottom: 40, gap: 18, textGap: 18 },
} as const;
export function redditCardHtml(card: RedditCard): { html: string; css: string } {
  const size = REDDIT_SIZES[card.size ?? "story"], color = REDDIT_AVATARS[card.avatar];
  const css = ":root{display:flex;flex-direction:column}"
    + `.platform-card{margin:auto 0;width:936px;box-sizing:border-box;background:#0E1113;border:3px solid #2F3336;border-radius:24px;padding:${size.top}px ${size.side}px ${size.bottom}px;font-family:"SF Pro Display",sans-serif}`
    + `.who{display:flex;align-items:center;gap:${size.gap}px;white-space:nowrap}.who svg{flex:none;display:block}`
    + `.name{font-weight:700;color:#F2F4F5;font-size:${size.name}px}.when{color:#8BA2AD;font-size:${size.name}px;margin-left:-${Math.round(size.gap * .45)}px}`
    + `.text{margin:${size.textGap}px 0 0;font-size:${size.text}px;line-height:${size.line}px;color:#EEF1F3;letter-spacing:-0.003em;white-space:pre-line;text-wrap:pretty}`;
  const avatar = `<svg width="${size.avatar}" height="${size.avatar}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${color}"/><path d="M33 25 L36.5 14.5" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/><circle cx="38.6" cy="13.4" r="3.8" fill="#FFFFFF"/><circle cx="16.5" cy="31" r="5" fill="#FFFFFF"/><circle cx="47.5" cy="31" r="5" fill="#FFFFFF"/>`
    + `<ellipse cx="32" cy="38" rx="17.5" ry="12.5" fill="#FFFFFF"/><circle cx="25.5" cy="36.5" r="3" fill="${color}"/><circle cx="38.5" cy="36.5" r="3" fill="${color}"/><path d="M26 43.2 Q32 47.2 38 43.2" stroke="${color}" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;
  return { html: `<div class="${platformCardClass("reddit")}"><div class="who">${avatar}<span class="name">${escapeHtml(card.name)}</span><span class="when">&middot; ${escapeHtml(card.when)}</span></div><p class="text">${escapeHtml(card.text)}</p></div>`, css };
}
