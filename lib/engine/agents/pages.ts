/** The template's page types as the agents see them. */
import { agentTemplateSlots, type AgentTemplateSlot } from "../../template-editor/agent-decks";
import type { DesignTemplate } from "../../template-editor/model";

export type PageCatalog = {
  index: number;
  label: string;
  /** Reaction pages show real posts from X: one card ("reaction") or two ("reactions"). */
  reaction: "reaction" | "reactions" | null;
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
      reaction: cards === 0 ? null : cards === 1 ? "reaction" as const : "reactions" as const,
      text: own.filter(slot => slot.type === "text" && !isCardSlot(slot)),
      photo: own.filter(slot => slot.type === "photo" && !isCardSlot(slot)),
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

export function describePages(pages: PageCatalog[]): string {
  return pages.map(page => {
    const text = page.text.map(slot => `    - text "${slot.slot}"${slot.role ? ` (${slot.role})` : ""}${slot.maxCharacters ? `, at most ~${slot.maxCharacters} characters` : ""}${slot.sample ? `, sample: ${JSON.stringify(slot.sample.slice(0, 120))}` : ""}`);
    const photo = page.photo.map(slot => `    - photo "${slot.slot}"`);
    const cards = page.reaction ? [`    - ${cardsOn(page)} post card${cardsOn(page) === 1 ? "" : "s"}, filled with real posts from X`] : [];
    return [`  Page ${page.index} · ${page.label}`, ...(text.length || photo.length || cards.length ? [...text, ...photo, ...cards] : ["    (no editable slots)"])].join("\n");
  }).join("\n");
}
