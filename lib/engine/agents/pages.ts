/** The template's page types as the agents see them. */
import { agentTemplateSlots, type AgentTemplateSlot } from "../../template-editor/agent-decks";
import type { DesignTemplate } from "../../template-editor/model";

export type PageCatalog = {
  index: number;
  label: string;
  /** Post cards on a Reaction page (one to three real posts from X); 0 on every other page. */
  cards: number;
  /** Slots a writer fills. A reaction page's card slots are left out: code fills them from the real posts. */
  text: AgentTemplateSlot[];
  photo: AgentTemplateSlot[];
};

const isCardSlot = (slot: AgentTemplateSlot) => slot.slot.startsWith("reaction-");

export function templatePages(template: DesignTemplate): PageCatalog[] {
  const slots = agentTemplateSlots(template);
  return template.pages.map((page, index) => {
    const own = slots.filter(slot => slot.pageIndex === index);
    const cards = own.filter(slot => slot.type === "text" && /^reaction-name(?:-\d+)?$/.test(slot.slot)).length;
    return {
      index, label: page.label ?? `Page ${index + 1}`,
      cards,
      text: own.filter(slot => slot.type === "text" && !isCardSlot(slot)),
      photo: own.filter(slot => slot.type === "photo" && !isCardSlot(slot)),
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

export function describePages(pages: PageCatalog[]): string {
  return pages.map(page => {
    const text = page.text.map(slot => `    - text "${slot.slot}"${slot.role ? ` (${slot.role})` : ""}${slot.maxCharacters ? `, at most ~${slot.maxCharacters} characters` : ""}${slot.sample ? `, sample: ${JSON.stringify(slot.sample.slice(0, 120))}` : ""}`);
    const photo = page.photo.map(slot => `    - photo "${slot.slot}"`);
    const cards = page.cards ? [`    - ${page.cards} post card${page.cards === 1 ? "" : "s"} drawn like phone screenshots of X, filled with real posts in code; each card grows with its post and photo`] : [];
    return [`  Page ${page.index} · ${page.label}`, ...(text.length || photo.length || cards.length ? [...text, ...photo, ...cards] : ["    (no editable slots)"])].join("\n");
  }).join("\n");
}
