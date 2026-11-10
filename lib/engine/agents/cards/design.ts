/** Build step D: the designer's cards, for a full recreation and for an exact copy. */
import { DATA_RULE, type RoleCard } from "./card";

const BUILD = [
  "Template first: start from the page's template pages and its saved layouts. A better layout is allowed when the content fits it: two columns, a timeline, a quote card",
  "Brand only: the brand's CSS variables for colors, type roles, margins and gaps; the brand's fonts; and keep the branding layers (logo, handle, page number)",
  "Editable layers: headlines and photos people will change stay native text and photo layers, never drawn inside HTML",
  "Real assets only, from your tools. Images go in as workspace assets, never as data URLs",
  "A chart is drawn from real data (chart_data): FRED, the S&P 500's history, or values printed in the source; never read off a picture",
  "Look at the slides you built before you hand them in",
  DATA_RULE,
];
const OUTPUT = "DesignSchema: deckId, name, slideCount, savedAt, caption, pages[] {pageId, slide, layout}, notes[], held";

export const DESIGN_CARD: RoleCard = {
  stage: "design", title: "Designer", by: "designer",
  job: "Build every slide of the post in the page's template and brand, with HTML layers where the template's own layers can't show the content, and real assets.",
  rules: [
    "The words come from the brief and the approved headline",
    ...BUILD,
    "A full recreation's chart has one scale",
  ],
  bar: "A reader can't tell it wasn't made by hand by the page's own designer.",
  output: OUTPUT,
};

export const EXACT_DESIGN_CARD: RoleCard = {
  stage: "design", title: "Designer", by: "designer",
  job: "Rebuild the original post as it is in the page's template: the same slides in the same order with the same words, every part rebuilt in our style, and only photos cut from the original.",
  rules: [
    "The original's words and order, from the source notes (translated faithfully when the page's language differs). Nothing is added, cut, merged or reworded",
    ...BUILD,
    "A chart has two scales only when the original prints them",
  ],
  bar: "Side by side with the original, a reader sees the same post in our template.",
  output: OUTPUT,
};
