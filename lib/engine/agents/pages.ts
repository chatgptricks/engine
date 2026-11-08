/** The template's page types as the agents see them. */
import { agentTemplateSlots, type AgentTemplateSlot } from "../../template-editor/agent-decks";
import type { DesignTemplate } from "../../template-editor/model";
import { spanPairs } from "../../template-editor/spanning-photos";

export type PageCatalog = {
  index: number;
  label: string;
  /** Reaction pages show real posts from X: one card ("reaction") or two ("reactions"). */
  reaction: "reaction" | "reactions" | null;
  /** Slots a writer fills. A reaction page's card slots are left out: code fills them from the real posts. */
  text: AgentTemplateSlot[];
  photo: AgentTemplateSlot[];
  /** One photo across two slides: it starts on this page and continues on page `with` (or the reverse). The photo is filled once, on the start page. */
  pair?: { part: "start" | "end"; with: number };
};

const isCardSlot = (slot: AgentTemplateSlot) => slot.slot.startsWith("reaction-");

export function templatePages(template: DesignTemplate): PageCatalog[] {
  const slots = agentTemplateSlots(template), pairs = spanPairs(template);
  return template.pages.map((page, index) => {
    const own = slots.filter(slot => slot.pageIndex === index);
    const cards = own.filter(slot => slot.type === "text" && /^reaction-name(?:-\d+)?$/.test(slot.slot)).length;
    const pair = pairs.find(item => item.startPage === index || item.endPage === index);
    return {
      index, label: page.label ?? `Page ${index + 1}`,
      reaction: cards === 0 ? null : cards === 1 ? "reaction" as const : "reactions" as const,
      text: own.filter(slot => slot.type === "text" && !isCardSlot(slot)),
      photo: own.filter(slot => slot.type === "photo" && !isCardSlot(slot)),
      ...(pair ? { pair: pair.startPage === index ? { part: "start" as const, with: pair.endPage } : { part: "end" as const, with: pair.startPage } } : {}),
    };
  });
}

/** The pages a writer may use when there are no real posts to show. */
export function writerPages(template: DesignTemplate): PageCatalog[] {
  return templatePages(template).filter(page => !page.reaction);
}

export const coverPage = (pages: PageCatalog[]) => pages.find(page => /cover/i.test(page.label)) ?? pages[0];
export const followPage = (pages: PageCatalog[]) => pages.find(page => /follow/i.test(page.label));
export const cardsOn = (page: PageCatalog) => page.reaction === "reactions" ? 2 : page.reaction === "reaction" ? 1 : 0;
/** The one-slide photo page (Text + Media): where half of a photo pair goes without its partner. */
export const singlePhotoPage = (pages: PageCatalog[]) => pages.find(page => !page.pair && !page.reaction && page.photo.length > 0 && page.text.some(slot => slot.role === "heading"));

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
    const cards = page.reaction ? [`    - ${cardsOn(page)} post card${cardsOn(page) === 1 ? "" : "s"}, filled with real posts from X`] : [];
    const pair = page.pair?.part === "start"
      ? [`    - one landscape photo runs across this page and page ${page.pair.with}, split at the slide edge as people swipe. Page ${page.pair.with} always comes right after it. The photo is chosen here, never a chart`]
      : page.pair ? [`    - the second half of page ${page.pair.with}'s photo. Only right after page ${page.pair.with}`] : [];
    return [`  Page ${page.index} · ${page.label}`, ...(text.length || photo.length || cards.length ? [...text, ...photo, ...cards, ...pair] : ["    (no editable slots)"])].join("\n");
  }).join("\n");
}
