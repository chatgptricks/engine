/** The template's page types as the agents see them: its own pages, and the layouts people saved
 * from slides ("Save as layout", lib/template-editor/saved-layouts.ts), each with the line that
 * says when to use it. */
import { agentTemplateSlots, type AgentTemplateSlot } from "../../template-editor/agent-decks";
import type { DesignTemplate, HtmlElement } from "../../template-editor/model";
import { platformOfLayer, type Platform } from "../../template-editor/platform-cards";
import { layoutUseWhen } from "../../template-editor/saved-layouts";
import { spanPairs } from "../../template-editor/spanning-photos";

export type PageCatalog = {
  index: number;
  label: string;
  /** Post cards on a Reaction page (one to three real posts from X); 0 on every other page. */
  cards: number;
  /** Slots a writer fills. A reaction page's card slots are left out: code fills them from the real posts. */
  text: AgentTemplateSlot[];
  photo: AgentTemplateSlot[];
  /** One photo across two slides: it starts on this page and continues on page `with` (or the reverse). The photo is filled once, on the start page. */
  pair?: { part: "start" | "end"; with: number };
  /** A layout saved from a slide, and when to use it. */
  layout?: { useWhen: string };
  /** The page's HTML layers other than its X post cards (those count in `cards`): designs to keep, such as a chart or a Reddit comment card, filled with the new post's own data. */
  html?: { name: string; platform?: Platform }[];
};

const isCardSlot = (slot: AgentTemplateSlot) => slot.slot.startsWith("reaction-");

export function templatePages(template: DesignTemplate): PageCatalog[] {
  const slots = agentTemplateSlots(template), pairs = spanPairs(template);
  return template.pages.map((page, index) => {
    const own = slots.filter(slot => slot.pageIndex === index);
    const layers = (page.canvas?.elements ?? []).filter((element): element is HtmlElement => element.type === "html" && !element.hidden);
    // A card is a native one (its name slot) or an HTML X card (htmlReactionCards in deck.ts, or a saved layout's).
    const xCards = layers.filter(layer => platformOfLayer(layer.html) === "x").length;
    const cards = own.filter(slot => slot.type === "text" && /^reaction-name(?:-\d+)?$/.test(slot.slot)).length + xCards;
    const html = layers.flatMap(layer => {
      const platform = platformOfLayer(layer.html);
      return platform === "x" ? [] : [{ name: layer.name?.trim() || "HTML layer", ...(platform ? { platform } : {}) }];
    });
    const pair = pairs.find(item => item.startPage === index || item.endPage === index), useWhen = layoutUseWhen(page);
    return {
      index, label: page.label ?? `Page ${index + 1}`,
      cards,
      text: own.filter(slot => slot.type === "text" && !isCardSlot(slot)),
      photo: own.filter(slot => slot.type === "photo" && !isCardSlot(slot)),
      ...(pair ? { pair: pair.startPage === index ? { part: "start" as const, with: pair.endPage } : { part: "end" as const, with: pair.startPage } } : {}),
      ...(useWhen ? { layout: { useWhen } } : {}),
      ...(html.length ? { html } : {}),
    };
  });
}

/** The pages a writer may use when there are no real posts to show. */
export function writerPages(template: DesignTemplate): PageCatalog[] {
  return templatePages(template).filter(page => !page.cards);
}

export const coverPage = (pages: PageCatalog[]) => pages.find(page => /cover/i.test(page.label)) ?? pages[0];
export const followPage = (pages: PageCatalog[]) => pages.find(page => /follow/i.test(page.label));
/** The Reaction page for `posts` posts: the one with that many cards, else the largest with fewer. */
export function reactionPageFor(pages: PageCatalog[], posts: number): PageCatalog | undefined {
  return pages.filter(page => page.cards > 0 && page.cards <= Math.max(1, posts)).sort((a, b) => b.cards - a.cards)[0];
}
/** The one-slide photo page (Text + Media): where half of a photo pair goes without its partner. */
export const singlePhotoPage = (pages: PageCatalog[]) => pages.find(page => !page.pair && !page.cards && page.photo.length > 0 && page.text.some(slot => slot.role === "heading"));

type PairSlide = { page: PageCatalog; chart?: boolean };
const joins = (first?: PairSlide, second?: PairSlide) => Boolean(first && second && first.page.pair?.part === "start" && first.page.pair.with === second.page.index && !first.chart && !second.chart);
/**
 * Each slide's page, in order. A photo pair works only as two slides in a row,
 * its start page then its end page, and holds no chart (the slide edge would
 * cut it). A half without its partner moves to the one-slide photo page, or is
 * dropped (null) when the template has none.
 */
export function pairedPages(slides: PairSlide[], pages: PageCatalog[]): (PageCatalog | null)[] {
  const single = singlePhotoPage(pages) ?? null;
  return slides.map((slide, index) => !slide.page.pair || joins(slide, slides[index + 1]) || joins(slides[index - 1], slide) ? slide.page : single);
}

export function describePages(pages: PageCatalog[]): string {
  return pages.map(page => {
    const text = page.text.map(slot => `    - text "${slot.slot}"${slot.role ? ` (${slot.role})` : ""}${slot.maxCharacters ? `, at most ~${slot.maxCharacters} characters` : ""}${slot.sample ? `, sample: ${JSON.stringify(slot.sample.slice(0, 120))}` : ""}`);
    const photo = page.photo.map(slot => `    - photo "${slot.slot}"`);
    const cards = page.cards ? [`    - ${page.cards} post card${page.cards === 1 ? "" : "s"} drawn like phone screenshots of X, filled with real posts in code; each card grows with its post and photo`] : [];
    const pair = page.pair?.part === "start"
      ? [`    - one landscape photo runs across this page and page ${page.pair.with}, split at the slide edge as people swipe. Page ${page.pair.with} always comes right after it. The photo is chosen here, never a chart`]
      : page.pair ? [`    - the second half of page ${page.pair.with}'s photo. Only right after page ${page.pair.with}`] : [];
    const layout = page.layout ? [`    - a layout saved from a slide; use it when: ${JSON.stringify(page.layout.useWhen)}`] : [];
    const html = (page.html ?? []).map(layer => `    - HTML layer "${layer.name}": ${layer.platform === "reddit" ? "a Reddit comment card; give it the comment's own name, time and words" : "a design to keep, filled with this post's own data"}`);
    return [`  Page ${page.index} · ${page.label}`, ...layout, ...(text.length || photo.length || cards.length || html.length ? [...text, ...photo, ...cards, ...html, ...pair] : ["    (no editable slots)"])].join("\n");
  }).join("\n");
}
