/**
 * Built-in brand guides. ChatGPTricks is seeded from Ivan's ChatGPTricks Style
 * Guide (colors, type, layout, cover, media and writing) plus the house rules
 * Recreate already enforced. A workspace edits it in Brand → Guides; every
 * save is a new version and the seed below stays version 1.
 */
import { parseBrandGuide, type BrandGuide } from "./brand-guide";

export const CHATGPTRICKS_GUIDE_ID = "chatgptricks";
export const BUILT_IN_GUIDE_UPDATED_AT = "2026-11-08T00:00:00.000Z";

const chatgptricks = {
  id: CHATGPTRICKS_GUIDE_ID,
  name: "ChatGPTricks",
  version: 1,
  updatedAt: BUILT_IN_GUIDE_UPDATED_AT,
  source: "ChatGPTricks Style Guide and the Recreate house rules, Nov 2026",
  purpose: "ChatGPTricks turns AI and technology stories into clear explanations, useful examples and demonstrations people can understand at a glance",
  personality: "Direct, curious, informed and visually confident",
  principles: [
    { name: "Clarity", text: "Give every slide one recognizable idea" },
    { name: "Curiosity", text: "Make the headline worth stopping for" },
    { name: "Usefulness", text: "Show what the technology does and why it matters" },
    { name: "Consistency", text: "Repeat the visual language while adapting the composition to the content" },
    { name: "Philosophy", text: "Let a strong headline, concise context and meaningful media carry the story" },
  ],
  colors: [
    { id: "night", role: "background", name: "Night", value: "#0B1014", use: "The page behind everything, and the dark fade over cover photos" },
    { id: "white", role: "text", name: "White", value: "#FFFFFF", use: "Cover headlines, supporting text and FOLLOW THIS PAGE" },
    { id: "green", role: "accent", name: "Green", value: "#00D98A", use: "Top of the accent gradient. Flat green only where a gradient can't go" },
    { id: "mint", role: "accent-end", name: "Mint", value: "#32FFBB", use: "Bottom of the accent gradient" },
    { id: "slate", role: "surface", name: "Slate", value: "#1A242B", use: "Photo placeholders and post cards" },
    { id: "light-grey", role: "secondary", name: "Light grey", value: "#D9D9D9", use: "SWIPE FOR MORE and the cover remark" },
    { id: "source-grey", role: "source", name: "Source grey", value: "#7D858A", use: "Source lines and post stats" },
  ],
  accentGradient: { from: "#00D98A", to: "#32FFBB", angle: 180 },
  text: [
    { id: "title", role: "title", name: "Content title", font: "sfpro", size: 56, weight: 700, lineHeight: 1.04, tracking: -0.021, case: "sentence", color: "accent", fill: "accent-gradient", note: "42 pt at most in the design file. Keep title sizes consistent, balance two-line titles and never leave one word alone on a line" },
    { id: "body", role: "body", name: "Supporting text", font: "sfpro", size: 43, weight: 400, lineHeight: 1.115, tracking: -0.008, case: "as-written", color: "text", fill: "solid", note: "32 pt in the design file. Brief: two lines at most" },
    { id: "cover", role: "cover", name: "Cover headline", font: "bebas", size: 97, weight: 400, lineHeight: 0.836, tracking: -0.02, case: "upper", color: "text", fill: "solid", note: "Centered and white, with the key words in the accent gradient. Three balanced lines" },
    { id: "cover-remark", role: "cover-remark", name: "Cover remark", font: "sfpro", size: 32, weight: 700, lineHeight: 1, tracking: 0.01, case: "upper", color: "secondary", fill: "solid", note: "Brief and subordinate, under the headline" },
    { id: "source", role: "source", name: "Source line", font: "sfpro", size: 24, weight: 400, lineHeight: 1.25, tracking: 0, case: "as-written", color: "source", fill: "solid", note: "Pinned to the bottom margin, one or two lines" },
    { id: "follow", role: "follow", name: "Follow lines", font: "bebas", size: 122, weight: 400, lineHeight: 0.836, tracking: -0.02, case: "upper", color: "text", fill: "solid", note: "FOLLOW THIS PAGE in white, then a green line for the post's topic of about 21 characters at most" },
    { id: "list", role: "list", name: "List items", font: "sfpro", size: 34, weight: 400, lineHeight: 1.235, tracking: -0.012, case: "as-written", color: "text", fill: "solid", note: "Two columns under green column headings" },
  ],
  layout: { width: 1080, height: 1440, marginLeft: 72, marginRight: 72, marginTop: 90, marginBottom: 88, titleBodyGap: 26, headerContentGap: 64, minTextSize: 24, media: "natural" },
  logos: [
    { id: "tricks-logo", role: "brand", name: "Tricks logo", src: "/template-editor/chatgptricks-logo.png", width: 831, height: 832, topics: [], note: "On the cover it sits between two white hairlines, above the headline" },
  ],
  examples: [
    { id: "example-cover", name: "Cover", src: "/brand-guides/chatgptricks/example-cover.jpg", width: 599, height: 800, note: "Three balanced Bebas lines in white with the key words in the green gradient, the Tricks logo between its hairlines, two topic logos over the photo and a short remark under the headline" },
    { id: "example-wide-media", name: "Text with a wide video", src: "/brand-guides/chatgptricks/example-3d-eye.jpg", width: 599, height: 800, note: "Gradient title, two lines of text and a wide video across the page in its own proportions, the whole block balanced on the page" },
    { id: "example-tall-media", name: "Text with a tall video", src: "/brand-guides/chatgptricks/example-lost-phone.jpg", width: 599, height: 800, note: "A portrait video keeps its shape, centered about 64 px under the text with the background around it" },
  ],
  rules: [
    { id: "w-plain", area: "writing", use: "guide", text: "Plain English with enough substance to follow the story" },
    { id: "w-direct", area: "writing", use: "guide", text: "Headlines are direct, and the slide delivers what they promise" },
    { id: "w-context", area: "writing", use: "guide", text: "Paragraphs keep the essential context" },
    { id: "w-sentence-case", area: "writing", use: "check", check: "sentence-case-titles", text: "Content titles in sentence case" },
    { id: "w-no-period", area: "writing", use: "check", check: "no-final-period", text: "No slide text ends with a full stop" },
    { id: "w-no-em-dash", area: "writing", use: "check", check: "no-em-dash", text: "No em dashes" },
    { id: "w-two-lines", area: "writing", use: "check", check: "body-length", text: "Text under a title is two lines at most (about 75 characters), in simple words" },
    { id: "w-no-extras", area: "writing", use: "guide", text: "No routine eyebrow labels, extra takeaways or decorative footer text" },
    { id: "w-one-focus", area: "writing", use: "guide", text: "One clear idea and one visual focus per slide" },
    { id: "w-sources", area: "writing", use: "guide", text: "Every number comes from a primary source, and the slide's source line names it" },
    { id: "w-banned", area: "writing", use: "check", check: "banned-words", text: "Headlines never use BREAKING:, exciting, amazing, an ellipsis or more than one exclamation mark" },
    { id: "w-follow", area: "writing", use: "guide", text: "The Follow page's green line fits this post's topic in about 21 characters, in plain words, with no fear-bait" },
    { id: "c-caps", area: "cover", use: "check", check: "upper-cover", text: "The cover headline is in capitals" },
    { id: "c-emphasis", area: "cover", use: "check", check: "accent-fill", text: "The key words of the cover headline and every content title carry the green gradient, top to bottom inside the letters" },
    { id: "c-hype", area: "cover", use: "guide", text: "Hype words like INSANE are fine on a cover when the story backs them up" },
    { id: "c-logo", area: "cover", use: "guide", text: "The Tricks logo sits between its two hairlines above the headline, over the approved dark fade" },
    { id: "c-remark", area: "cover", use: "check", check: "cover-remark", text: "A brief remark under the headline when there's something worth saying, such as HERE'S OUR TOP 16 SELECTION; otherwise SWIPE FOR MORE" },
    { id: "l-topic-logo", area: "logos", use: "guide", text: "When the story is about a product or company with a logo on file, its logo can sit over the cover photo: a clean asset in its own proportions, two at most" },
    { id: "m-proportions", area: "media", use: "guide", text: "Photos, charts and videos keep their original proportions, with the background visible around them" },
    { id: "m-no-frames", area: "media", use: "guide", text: "No frames, stretching or blurred copies behind the media" },
    { id: "m-video", area: "media", use: "guide", text: "Real video for moving demonstrations" },
    { id: "m-editorial", area: "media", use: "guide", text: "Realistic editorial imagery" },
    { id: "m-diagrams", area: "media", use: "guide", text: "Diagrams in SF Pro with one consistent style. Interfaces may sit in a window frame" },
    { id: "y-margins", area: "layout", use: "check", check: "text-margins", text: "Text keeps 72 px margins on each side" },
    { id: "y-align", area: "layout", use: "guide", text: "Text aligned left, media centered" },
    { id: "y-spacing", area: "layout", use: "check", check: "spacing", text: "26 px from the title to the text, about 64 px from the text to the media" },
    { id: "y-balance", area: "layout", use: "guide", text: "The whole block stays balanced and is redistributed when the media's shape changes" },
    { id: "y-source", area: "layout", use: "check", check: "source-line", text: "The source line is 24 px Source grey, pinned to the bottom margin" },
    { id: "y-reactions", area: "layout", use: "guide", text: "Reaction pages keep their own design: no source line, since the X post cards show whose posts they are, and the title and cards centered between the 90 and 1352 px margins" },
    { id: "t-fonts", area: "type", use: "check", check: "fonts", text: "SF Pro Display for titles and text, Bebas Neue for the cover and Follow lines" },
    { id: "t-min", area: "type", use: "check", check: "min-text-size", text: "No text under 24 px" },
    { id: "k-palette", area: "color", use: "check", check: "palette", text: "Only the guide's colors" },
  ],
  bannedWords: ["BREAKING:", "exciting", "amazing", "...", "…"],
  hooks: {
    method: "headline-engine",
    notes: [
      "Classify the story, check its original headline (keep, light edit or rewrite), then write options from plain to most viral and pick the strongest",
      "ALL CAPS, using the cover's room (about three lines), told the way you'd tell a friend, holding one thing back so there's a reason to swipe",
      "Never invent numbers, time windows, rankings, names or quotes",
      "Hype words like INSANE are fine when the story backs them up",
    ],
  },
};

/** Built-in guides as shipped (fresh, checked copies). */
export function builtInBrandGuides(): BrandGuide[] {
  return [parseBrandGuide(structuredClone(chatgptricks))];
}
export const builtInBrandGuide = (id: string): BrandGuide | undefined => builtInBrandGuides().find(guide => guide.id === id);
export const isBuiltInBrandGuide = (id: string) => id === CHATGPTRICKS_GUIDE_ID;
