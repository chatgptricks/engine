/**
 * The headline engine, for Recreate's copywriter: Ivan's headline-engine skill
 * (built on 21,779 scored posts from 12 AI/tech pages) as instructions. The
 * copywriter classifies the story, checks the original headline, writes
 * options from plain to most viral and names its top pick, with the proven
 * covers for the story's archetype in front of it. The formulas and covers
 * are vendored in headline-engine-data.ts (scripts/build-headline-engine-data.py).
 */
import { z } from "zod";
import { HEADLINE_FORMULAS, PROVEN_COVERS } from "./headline-engine-data";

export const HOOK_ARCHETYPES: readonly { name: string; about: string; formulas: number[] }[] = [
  { name: "BREAKING NEWS", about: "Company announcement, launch, funding, acquisition", formulas: [1, 15, 18] },
  { name: "POWER QUOTE", about: "A notable figure said something provocative", formulas: [2] },
  { name: "UNDERDOG STORY", about: "An individual achieves something remarkable with AI", formulas: [3, 10] },
  { name: "AI GONE ROGUE", about: "AI does something unexpected, scary or autonomous", formulas: [7] },
  { name: "DISRUPTION", about: "An industry, tool or profession being replaced", formulas: [6, 20] },
  { name: "PRACTICAL VALUE", about: "Prompts, hacks, tools, free resources", formulas: [5, 8, 12] },
  { name: "GEOPOLITICAL RACE", about: "US vs China, national AI competition", formulas: [11] },
  { name: "BIZARRE/WEIRD", about: "An unusual, funny or absurd AI application", formulas: [10, 17] },
  { name: "MILESTONE", about: "Record-breaking, first-ever, historic", formulas: [9, 15] },
  { name: "CULTURAL MASHUP", about: "AI plus pop culture, movies, anime, gaming", formulas: [17] },
  { name: "STUDY/RESEARCH", about: "Data-backed findings, scientific results", formulas: [16] },
  { name: "INVESTMENT/MONEY", about: "Funding rounds, spending, financial stakes", formulas: [18] },
  { name: "FOUNDER STORY", about: "Origin, transformation, profile", formulas: [13] },
  { name: "LEAK/EXPOSED", about: "Inside information, accidental reveals", formulas: [14] },
];

/** The copywriter's answer when it writes hooks with the engine. */
export const EngineHooksSchema = z.object({
  archetype: z.string().describe("The story's archetype, one of the names listed"),
  original: z.object({
    verdict: z.enum(["keep", "light-edit", "rewrite", "none"]).describe("none when there is no original headline"),
    text: z.string().describe("For keep or light-edit: the original or its light edit in house style. Otherwise empty"),
    why: z.string(),
  }),
  baseline: z.string().describe("The story in one neutral, accurate sentence, no hype"),
  hooks: z.array(z.object({
    text: z.string(),
    framework: z.string().describe("The formula used, such as \"Formula 3: The Underdog\""),
    level: z.number().int().describe("1-3 journalistic, 4-7 stronger verbs and a clear hook, 8-10 maximum pull, still true"),
  })).describe("From least to most viral"),
  topPick: z.number().int().describe("Index in hooks of the strongest line, or -1 when the original or its light edit beats them all"),
  why: z.string().describe("One line: why the top pick wins"),
});
export type EngineHooks = z.infer<typeof EngineHooksSchema>;

const formula = (n: number) => HEADLINE_FORMULAS.find(item => item.n === n);

export type EngineOptions = {
  language: "en" | "es";
  /** Characters the cover headline holds; hooks must fit it. */
  room?: number;
  /** Notes from the page's brand guide (Brand → Guides → Hooks). */
  notes?: string[];
  /** The guide asks for plain hooks: the page's voice and the house rules, without the engine's formulas, data and proven covers. */
  plain?: boolean;
};

/** The skill's method, rules and proven covers, as a system prompt addition. */
export function headlineEngineInstructions(options: EngineOptions): string {
  const spanish = options.language === "es";
  const length = options.room
    ? `LENGTH: this page's cover holds about ${options.room} characters in big capitals (about three lines). Every hook must fit that. Within it, tell the whole story the way you'd tell a friend in one breath, and hold one thing back (the result, the list, the how) so there's a reason to swipe. In the data, 9-16 word covers are the weakest zone and longer story headlines win, so use the room you have rather than writing a slogan.`
    : "LENGTH: usually 15-30 words, told the way you'd tell a friend in one breath, holding one thing back (the result, the list, the how) so there's a reason to swipe. 9-16 word covers are the weakest zone in the data.";
  const archetypes = HOOK_ARCHETYPES.map(item => `- ${item.name}: ${item.about}. Formulas ${item.formulas.join(", ")}`).join("\n");
  const formulas = HEADLINE_FORMULAS.map(item => `${item.n}. ${item.name}: ${item.pattern}${item.use ? ` (use when: ${item.use})` : ""}`).join("\n");
  const covers = HOOK_ARCHETYPES.map(item => {
    const list = PROVEN_COVERS[item.name] ?? [];
    return list.length ? `${item.name}\n${list.map(cover => `- ${cover.text} (${cover.x}x)`).join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
  const plain = Boolean(options.plain);
  return [
    plain ? "HOOKS: WRITE THEM IN THE PAGE'S OWN VOICE" : "HOOKS: WRITE THEM WITH THE HEADLINE ENGINE",
    plain ? "This page's brand guide asks for plain hooks: its own voice and the house rules below, no borrowed formulas. Follow the steps." : "The headline engine is this page's proven method, built on 21,779 scored posts from 12 AI and tech pages. Follow it step by step.",
    plain ? "1. Name the story's archetype in a word or two (for example BREAKING NEWS or PRACTICAL VALUE) and write \"Plain\" as each hook's framework." : "1. Classify the story into one archetype below and choose its best one or two formulas. You may combine formulas.",
    "2. Check the original headline when there is one: keep it when it is already strong (fix only the house formatting), make a light edit that changes as few words as possible when it is strong but slightly off, or rewrite it when it is weak. A rewrite has to clearly beat the original to win.",
    "3. Write the baseline: the story in one neutral, accurate sentence.",
    "4. Write the options from least to most viral: 1-3 journalistic and credible, 4-7 stronger verbs and a clear emotional hook (where most winners live), 8-10 maximum pull through stakes, conflict or social proof, still plausible and true.",
    "5. Pick the strongest line (or the original, or its light edit) and say in one line why it stops the scroll.",
    length,
    [
      "STYLE",
      "- ALL CAPS. No emojis. Never the em dash character: use a comma, a colon or a hyphen.",
      "- Lead with the most surprising or newsworthy element; never bury the hook.",
      "- Specific numbers from the story beat vague words ($4.75B beats \"billions\"). Name real entities (NVIDIA, GOOGLE, OPENAI, ANTHROPIC).",
      "- JUST for recency (JUST DROPPED, JUST RELEASED) when it is recent. People by role first, then name (NVIDIA CEO JENSEN HUANG).",
      "- Concrete beats abstract, human stakes beat technical specs, active voice beats passive. No jargon a 25-year-old wouldn't know.",
      "- Unconfirmed stories say so: REPORTEDLY, LEAK SUGGESTS, REPORTS SAY. Serious accusations without a clear source become REPORTS ALLEGE or CRITICS SAY.",
    ].join("\n"),
    plain ? "" : [
      "WHAT THE DATA SAYS (leans, not laws)",
      "- A named person at the center of the story: +23%. THIS GUY…, THIS CEO… structures win.",
      "- Plain announcement framing (X ANNOUNCES, X LAUNCHES): -24%. Reframe it as a consequence or reaction: PEOPLE ARE ALREADY…, THESE 10…, THE INTERNET IS…",
      "- AI-made content (AI video, music, images) and China lean up. Leading with a dollar amount, Elon Musk or OpenAI as the subject leans slightly down.",
      "- THIS or THESE pointing at the content, and questions, lean up (+8-9%).",
      "- Holding one hook back beats giving everything away by 10-15%.",
    ].join("\n"),
    [
      "NEVER",
      "- Start with BREAKING:. Use an ellipsis. Use more than one exclamation mark. Use the words exciting or amazing.",
      "- Invent anything the story doesn't state: numbers, time windows (24 HOURS SINCE…, IN 3 DAYS), view counts, money, rankings (LARGEST IN HISTORY), names, quotes or outcomes. Use the time-window formula only when the story's dates make it true. In blind tests, invented details were the main reason strong-sounding headlines were rejected.",
      "- Clickbait the post can't deliver.",
    ].join("\n"),
    "CHECK YOUR TOP THREE before you hand them in: would a thumb stop mid-scroll? Is there a gap the reader needs to close? Would someone send it to a friend? Are there concrete names, numbers or details? Does it hit fear, awe, outrage or desire in the first five words? Does it work alone on the cover? Is every date, number, name, quote and outcome in the source? Rewrite any that fail.",
    spanish ? "SPANISH: write natively in Spanish, not a translation. Match the energy and cadence of the best English covers, with everyday phrasing and no corporate filler. Keep accents on capitals (MÁS, not MAS) and opening ¿ and ¡." : "",
    options.notes?.length ? `THIS PAGE'S BRAND GUIDE SAYS\n${options.notes.map(note => `- ${note}`).join("\n")}` : "",
    plain ? "" : `ARCHETYPES\n${archetypes}`,
    plain ? "" : `FORMULAS\n${formulas}`,
    plain ? "" : `PROVEN COVERS BY ARCHETYPE (carousel and image covers that landed in the top 10% of their page, with likes against that page's usual post). Use them for style, structure and angle. Never copy facts from them into a different story.\n\n${covers}`,
  ].filter(Boolean).join("\n\n");
}

/** Formula numbers an archetype leans on, for labels. */
export const archetypeFormulas = (name: string) => (HOOK_ARCHETYPES.find(item => item.name === name.trim().toUpperCase())?.formulas ?? []).map(formula).filter(Boolean);
