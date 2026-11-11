/**
 * Brand guides: what Engine's agents, critics and template designer need to
 * make a brand's posts look and read like the brand. One guide per brand,
 * entered once (Brand → Guide in the editor, or by an agent over MCP) and read
 * by Recreate, the editor and outside agents. Every save is a new version.
 *
 * Engine turns a guide into four things:
 *   - a brief: the guide in plain words, added to every agent's instructions
 *   - checks: the rules code can measure on a deck or a template
 *   - examples: approved posts the design critic compares our slides with
 *   - tokens: the colors, type and spacing templates are made from
 *
 * This module is pure (no server imports), so the editor, the API routes and
 * the agents share one parser. Storage lives in lib/engine/brand-guides.ts.
 */
import { BRAND_SVG_PREFIX, FORMATS, isSafeBrandSvgUrl, type CanvasElement, type DesignFormat, type DesignPage, type ShapeImageFill, type TextElement } from "./model";

export type GuideColorRole = "background" | "text" | "accent" | "accent-end" | "surface" | "secondary" | "source" | "other";
export type GuideColor = { id: string; role: GuideColorRole; name: string; value: string; use: string };
export type GuideTextRole = "title" | "body" | "cover" | "cover-remark" | "source" | "follow" | "list" | "other";
export type GuideTextStyle = {
  id: string;
  role: GuideTextRole;
  name: string;
  /** An editor font id, such as sfpro or bebas. */
  font: string;
  /** Pixels on the guide's canvas (1080 wide for Instagram). */
  size: number;
  weight: number;
  lineHeight: number;
  /** Letter spacing in em, so -0.02 is 2% tighter. */
  tracking: number;
  case: "sentence" | "upper" | "as-written";
  /** A color role from the guide, such as text or accent. */
  color: GuideColorRole;
  /** "accent-gradient" fills the letters with the guide's accent gradient. */
  fill: "solid" | "accent-gradient";
  note: string;
};
export type GuideLayout = {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  /** From the title to the text under it. */
  titleBodyGap: number;
  /** From the header group (title and text) to the media or list under it. */
  headerContentGap: number;
  minTextSize: number;
  /** Photos and videos keep their own shape ("natural") or fill their frame ("fill"). */
  media: "natural" | "fill";
};
export type GuideImage = { id: string; name: string; src: string; previewSrc?: string; width: number; height: number };
export type GuideLogo = GuideImage & {
  role: "brand" | "topic";
  /** What a topic logo stands for, such as Claude or Anthropic. A cover that names one can carry it. */
  topics: string[];
  note: string;
};
export type GuideExample = GuideImage & { note: string };
export type GuideRuleArea = "writing" | "cover" | "media" | "layout" | "type" | "color" | "logos";
export const GUIDE_CHECK_KINDS = [
  "no-final-period", "no-em-dash", "sentence-case-titles", "upper-cover", "body-length", "banned-words", "cover-remark",
  "palette", "fonts", "min-text-size", "text-margins", "source-line", "spacing", "accent-fill", "video-poster", "x-font",
] as const;
export type GuideCheckKind = typeof GUIDE_CHECK_KINDS[number];
export type GuideRule = {
  id: string;
  area: GuideRuleArea;
  text: string;
  /** Guide: writers and designers follow it. Check: code or a critic flags anything that breaks it. */
  use: "guide" | "check";
  /** The code check that measures this rule, when one can. */
  check?: GuideCheckKind;
};
export type BrandGuide = {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  /** Where the guide came from, such as "ChatGPTricks Style Guide, 8 Nov 2026". */
  source: string;
  purpose: string;
  personality: string;
  principles: { name: string; text: string }[];
  colors: GuideColor[];
  /** Applied inside letters, top to bottom (180°). */
  accentGradient: { from: string; to: string; angle: number } | null;
  text: GuideTextStyle[];
  layout: GuideLayout;
  logos: GuideLogo[];
  examples: GuideExample[];
  rules: GuideRule[];
  /** Words and marks our own headlines never use, such as "BREAKING:". */
  bannedWords: string[];
  hooks: { method: "headline-engine" | "plain"; notes: string[] };
};
export type GuideIssue = { slide: number; problem: string; fix: string; severity: "must_fix" | "should_fix" | "note"; route: "copy" | "data" | "images" | "none"; check: GuideCheckKind };

export const GUIDE_LIMITS = {
  id: 48, name: 80, source: 200, purpose: 600, personality: 300,
  principles: 8, principleName: 40, principleText: 300,
  colors: 20, colorName: 60, colorUse: 300,
  text: 16, textName: 60, textNote: 300,
  logos: 40, examples: 12, imageName: 200, imageNote: 300, topics: 12, topic: 40,
  imageUrl: 2_000, svgUrl: 400_000, dataUrl: 700_000,
  rules: 60, rule: 400, bannedWords: 40, bannedWord: 40, hookNotes: 12, hookNote: 300,
} as const;
export const GUIDE_FONT_IDS = ["serif", "sans", "walsheim", "walsheimcond", "kyoto", "century", "libre", "geist", "sfpro", "chirp", "playfair", "dmserif", "lora", "cormorant", "crimson", "inter", "space", "montserrat", "bebas", "bebascanva", "plexmono", "caveat", "poppins", "neuemontreal", "supermolot", "helvetica", "arial", "georgia"] as const;
const FONT_NAMES: Record<string, string> = { sfpro: "SF Pro Display", chirp: "Chirp (X)", poppins: "Poppins", neuemontreal: "Neue Montreal", supermolot: "TT Supermolot", helvetica: "Helvetica", arial: "Arial", georgia: "Georgia", bebas: "Bebas Neue", bebascanva: "Bebas Neue Bold", inter: "Inter", geist: "Geist Sans" };
export const fontName = (id: string) => FONT_NAMES[id] ?? id;

/** What each code check measures, how serious a miss is, and who fixes it. */
export const GUIDE_CHECKS: Record<GuideCheckKind, { label: string; severity: GuideIssue["severity"]; route: GuideIssue["route"]; scope: "copy" | "layer" | "template" }> = {
  "no-final-period": { label: "No slide text ends with a full stop", severity: "must_fix", route: "copy", scope: "copy" },
  "no-em-dash": { label: "No em dashes", severity: "should_fix", route: "copy", scope: "copy" },
  "sentence-case-titles": { label: "Content titles in sentence case", severity: "should_fix", route: "copy", scope: "copy" },
  "upper-cover": { label: "Cover headline in capitals", severity: "must_fix", route: "copy", scope: "copy" },
  "body-length": { label: "Text under a title is at most two lines", severity: "should_fix", route: "copy", scope: "copy" },
  "banned-words": { label: "No banned words or marks in headlines", severity: "should_fix", route: "copy", scope: "copy" },
  "cover-remark": { label: "Cover remark brief", severity: "should_fix", route: "copy", scope: "copy" },
  palette: { label: "Colors from the guide", severity: "should_fix", route: "none", scope: "layer" },
  fonts: { label: "Fonts from the guide", severity: "should_fix", route: "none", scope: "layer" },
  "min-text-size": { label: "No text under the minimum size", severity: "should_fix", route: "none", scope: "layer" },
  "text-margins": { label: "Text inside the margins", severity: "should_fix", route: "none", scope: "layer" },
  "source-line": { label: "Source line style and position", severity: "should_fix", route: "none", scope: "template" },
  spacing: { label: "Spacing under the title and header", severity: "should_fix", route: "none", scope: "template" },
  "accent-fill": { label: "Accent gradient inside titles", severity: "should_fix", route: "none", scope: "template" },
  // Always on: a video without a poster shows a dark frame in thumbnails, PNG and PDF, whatever the guide says.
  "video-poster": { label: "Every video has a poster", severity: "must_fix", route: "images", scope: "layer" },
  // Always on when the server lacks X's font: post cards in chirp show SF Pro instead.
  "x-font": { label: "X's font is installed for post cards", severity: "should_fix", route: "none", scope: "layer" },
};

export class BrandGuideError extends Error {
  constructor(message: string, public status = 400, public issues: string[] = []) {
    super(message);
    this.name = "BrandGuideError";
  }
}

/* ─── Validation ─────────────────────────────────────────────────────────── */

const ID = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ITEM_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const COLOR_ROLES: GuideColorRole[] = ["background", "text", "accent", "accent-end", "surface", "secondary", "source", "other"];
const TEXT_ROLES: GuideTextRole[] = ["title", "body", "cover", "cover-remark", "source", "follow", "list", "other"];
const AREAS: GuideRuleArea[] = ["writing", "cover", "media", "layout", "type", "color", "logos"];
export const isBrandGuideId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Lowercase ASCII slug for a new guide id, such as "ChatGPT Tricks" → "chatgpt-tricks". */
export function brandGuideSlug(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, GUIDE_LIMITS.id).replace(/-+$/g, "");
}

/** Image sources a guide may keep: site paths, HTTPS URLs, safe brand SVGs and small raster data URLs. */
export function isSafeGuideImage(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  if (value.startsWith(BRAND_SVG_PREFIX)) return value.length <= GUIDE_LIMITS.svgUrl && isSafeBrandSvgUrl(value);
  if (value.startsWith("data:")) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    return Boolean(match) && value.length <= GUIDE_LIMITS.dataUrl && match![2].length % 4 === 0;
  }
  if (value.length > GUIDE_LIMITS.imageUrl) return false;
  if (value.startsWith("/")) return /^\/(?!\/)[a-zA-Z0-9_./%?=&-]+$/.test(value) && !/%(?:2f|5c)/i.test(value) && !value.includes("..");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string, allowNewlines: boolean): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (allowNewlines && code === 10) continue;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

class Reader {
  issues: string[] = [];
  text(field: string, value: unknown, max: number, { required = true, multiline = false } = {}): string {
    if (value === undefined || value === null || value === "") {
      if (required) this.issues.push(`${field} is required.`);
      return "";
    }
    if (typeof value !== "string") { this.issues.push(`${field} must be text.`); return ""; }
    const trimmed = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
    if (!trimmed && required) this.issues.push(`${field} is required.`);
    else if (trimmed.length > max) this.issues.push(`${field} must be ${max} characters or fewer.`);
    else if (hasControlCharacters(trimmed, multiline)) this.issues.push(`${field} contains unsupported characters.`);
    return trimmed;
  }
  number(field: string, value: unknown, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      this.issues.push(`${field} must be a number from ${min} to ${max}.`);
      return fallback;
    }
    return Math.round(value * 1000) / 1000;
  }
  color(field: string, value: unknown): string {
    if (typeof value !== "string" || !HEX.test(value)) { this.issues.push(`${field} must be a color like #00D98A.`); return "#000000"; }
    return value.toUpperCase();
  }
  choice<T extends string>(field: string, value: unknown, options: readonly T[]): T {
    if (typeof value !== "string" || !options.includes(value as T)) { this.issues.push(`${field} must be one of ${options.join(", ")}.`); return options[0]; }
    return value as T;
  }
  list(field: string, value: unknown, max: number): unknown[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) { this.issues.push(`${field} must be a list.`); return []; }
    if (value.length > max) this.issues.push(`${field} can have at most ${max} items.`);
    return value.slice(0, max);
  }
  id(field: string, value: unknown, seen: Set<string>): string {
    if (typeof value !== "string" || !ITEM_ID.test(value)) { this.issues.push(`${field} must be an id of letters, numbers, dots, dashes or colons.`); return ""; }
    if (seen.has(value)) this.issues.push(`${field} repeats the id ${value}.`);
    seen.add(value);
    return value;
  }
}

function readImage(read: Reader, field: string, value: unknown, seen: Set<string>): GuideImage | null {
  if (!isRecord(value)) { read.issues.push(`${field} must be an object.`); return null; }
  const id = read.id(`${field}.id`, value.id, seen);
  const name = read.text(`${field}.name`, value.name, GUIDE_LIMITS.imageName);
  if (!isSafeGuideImage(value.src)) read.issues.push(`${field}.src must be a site path, an HTTPS URL, a safe SVG or a PNG, JPEG or WebP data URL under 700 KB.`);
  if (value.previewSrc !== undefined && !isSafeGuideImage(value.previewSrc)) read.issues.push(`${field}.previewSrc is not a supported image.`);
  const width = read.number(`${field}.width`, value.width, 1, 100_000, 1), height = read.number(`${field}.height`, value.height, 1, 100_000, 1);
  return { id, name, src: String(value.src ?? ""), ...(typeof value.previewSrc === "string" ? { previewSrc: value.previewSrc } : {}), width, height };
}

/**
 * Checks a guide and returns a clean copy (unknown fields dropped). Throws a
 * BrandGuideError listing every problem. `version` and `updatedAt` are set by
 * storage; a candidate may leave them out.
 */
export function parseBrandGuide(input: unknown, stamp: { version?: number; updatedAt?: string } = {}): BrandGuide {
  if (!isRecord(input)) throw new BrandGuideError("A brand guide object is required.");
  const read = new Reader();
  const id = typeof input.id === "string" ? input.id : "";
  if (!ID.test(id)) read.issues.push(`id must be 1–${GUIDE_LIMITS.id} lowercase letters, numbers or dashes.`);
  const name = read.text("name", input.name, GUIDE_LIMITS.name);
  const source = read.text("source", input.source, GUIDE_LIMITS.source, { required: false });
  const purpose = read.text("purpose", input.purpose, GUIDE_LIMITS.purpose, { required: false, multiline: true });
  const personality = read.text("personality", input.personality, GUIDE_LIMITS.personality, { required: false });
  const principles = read.list("principles", input.principles, GUIDE_LIMITS.principles).flatMap((value, index) => {
    if (!isRecord(value)) { read.issues.push(`principles[${index}] must be an object.`); return []; }
    return [{ name: read.text(`principles[${index}].name`, value.name, GUIDE_LIMITS.principleName), text: read.text(`principles[${index}].text`, value.text, GUIDE_LIMITS.principleText) }];
  });
  const colorIds = new Set<string>();
  const colors = read.list("colors", input.colors, GUIDE_LIMITS.colors).flatMap((value, index): GuideColor[] => {
    if (!isRecord(value)) { read.issues.push(`colors[${index}] must be an object.`); return []; }
    return [{
      id: read.id(`colors[${index}].id`, value.id, colorIds), role: read.choice(`colors[${index}].role`, value.role, COLOR_ROLES),
      name: read.text(`colors[${index}].name`, value.name, GUIDE_LIMITS.colorName), value: read.color(`colors[${index}].value`, value.value),
      use: read.text(`colors[${index}].use`, value.use, GUIDE_LIMITS.colorUse, { required: false }),
    }];
  });
  for (const role of ["background", "text", "accent"] as const) if (!colors.some(color => color.role === role)) read.issues.push(`colors needs ${role === "accent" ? "an" : "a"} ${role} color.`);
  let accentGradient: BrandGuide["accentGradient"] = null;
  if (input.accentGradient !== undefined && input.accentGradient !== null) {
    const value = input.accentGradient;
    if (!isRecord(value)) read.issues.push("accentGradient must be an object or null.");
    else accentGradient = { from: read.color("accentGradient.from", value.from), to: read.color("accentGradient.to", value.to), angle: read.number("accentGradient.angle", value.angle ?? 180, 0, 360, 180) };
  }
  const textIds = new Set<string>();
  const text = read.list("text", input.text, GUIDE_LIMITS.text).flatMap((value, index): GuideTextStyle[] => {
    if (!isRecord(value)) { read.issues.push(`text[${index}] must be an object.`); return []; }
    const field = `text[${index}]`;
    const font = read.choice(`${field}.font`, value.font, GUIDE_FONT_IDS);
    return [{
      id: read.id(`${field}.id`, value.id, textIds), role: read.choice(`${field}.role`, value.role, TEXT_ROLES),
      name: read.text(`${field}.name`, value.name, GUIDE_LIMITS.textName), font,
      size: read.number(`${field}.size`, value.size, 8, 400, 32), weight: read.number(`${field}.weight`, value.weight, 100, 900, 400),
      lineHeight: read.number(`${field}.lineHeight`, value.lineHeight, 0.5, 3, 1.2), tracking: read.number(`${field}.tracking`, value.tracking ?? 0, -0.2, 0.5, 0),
      case: read.choice(`${field}.case`, value.case ?? "as-written", ["sentence", "upper", "as-written"] as const),
      color: read.choice(`${field}.color`, value.color ?? "text", COLOR_ROLES), fill: read.choice(`${field}.fill`, value.fill ?? "solid", ["solid", "accent-gradient"] as const),
      note: read.text(`${field}.note`, value.note, GUIDE_LIMITS.textNote, { required: false }),
    }];
  });
  if (text.some(style => style.fill === "accent-gradient") && !accentGradient) read.issues.push("A text style uses the accent gradient, so accentGradient is required.");
  const layoutInput = isRecord(input.layout) ? input.layout : {};
  if (!isRecord(input.layout)) read.issues.push("layout must be an object.");
  const layout: GuideLayout = {
    width: read.number("layout.width", layoutInput.width, 100, 10_000, 1080), height: read.number("layout.height", layoutInput.height, 100, 10_000, 1440),
    marginLeft: read.number("layout.marginLeft", layoutInput.marginLeft, 0, 1000, 72), marginRight: read.number("layout.marginRight", layoutInput.marginRight, 0, 1000, 72),
    marginTop: read.number("layout.marginTop", layoutInput.marginTop, 0, 1000, 90), marginBottom: read.number("layout.marginBottom", layoutInput.marginBottom, 0, 1000, 88),
    titleBodyGap: read.number("layout.titleBodyGap", layoutInput.titleBodyGap, 0, 400, 26), headerContentGap: read.number("layout.headerContentGap", layoutInput.headerContentGap, 0, 400, 64),
    minTextSize: read.number("layout.minTextSize", layoutInput.minTextSize, 6, 200, 24), media: read.choice("layout.media", layoutInput.media ?? "natural", ["natural", "fill"] as const),
  };
  if (layout.marginLeft + layout.marginRight >= layout.width) read.issues.push("layout margins leave no room for text.");
  const imageIds = new Set<string>();
  const logos = read.list("logos", input.logos, GUIDE_LIMITS.logos).flatMap((value, index): GuideLogo[] => {
    const image = readImage(read, `logos[${index}]`, value, imageIds);
    if (!image || !isRecord(value)) return [];
    const topics = read.list(`logos[${index}].topics`, value.topics, GUIDE_LIMITS.topics).map((topic, n) => read.text(`logos[${index}].topics[${n}]`, topic, GUIDE_LIMITS.topic)).filter(Boolean);
    const role = read.choice(`logos[${index}].role`, value.role ?? "brand", ["brand", "topic"] as const);
    if (role === "topic" && !topics.length) read.issues.push(`logos[${index}] is a topic logo, so name at least one topic it stands for.`);
    return [{ ...image, role, topics, note: read.text(`logos[${index}].note`, value.note, GUIDE_LIMITS.imageNote, { required: false }) }];
  });
  const examples = read.list("examples", input.examples, GUIDE_LIMITS.examples).flatMap((value, index): GuideExample[] => {
    const image = readImage(read, `examples[${index}]`, value, imageIds);
    return image && isRecord(value) ? [{ ...image, note: read.text(`examples[${index}].note`, value.note, GUIDE_LIMITS.imageNote, { required: false }) }] : [];
  });
  const ruleIds = new Set<string>();
  const rules = read.list("rules", input.rules, GUIDE_LIMITS.rules).flatMap((value, index): GuideRule[] => {
    if (!isRecord(value)) { read.issues.push(`rules[${index}] must be an object.`); return []; }
    const field = `rules[${index}]`;
    const rule: GuideRule = {
      id: read.id(`${field}.id`, value.id, ruleIds), area: read.choice(`${field}.area`, value.area ?? "writing", AREAS),
      text: read.text(`${field}.text`, value.text, GUIDE_LIMITS.rule), use: read.choice(`${field}.use`, value.use ?? "guide", ["guide", "check"] as const),
    };
    if (value.check !== undefined && value.check !== null && value.check !== "") rule.check = read.choice(`${field}.check`, value.check, GUIDE_CHECK_KINDS);
    return [rule];
  });
  const bannedWords = read.list("bannedWords", input.bannedWords, GUIDE_LIMITS.bannedWords).map((word, index) => read.text(`bannedWords[${index}]`, word, GUIDE_LIMITS.bannedWord)).filter(Boolean);
  const hooksInput = isRecord(input.hooks) ? input.hooks : {};
  const hooks = {
    method: read.choice("hooks.method", hooksInput.method ?? "headline-engine", ["headline-engine", "plain"] as const),
    notes: read.list("hooks.notes", hooksInput.notes, GUIDE_LIMITS.hookNotes).map((note, index) => read.text(`hooks.notes[${index}]`, note, GUIDE_LIMITS.hookNote)).filter(Boolean),
  };
  const version = stamp.version ?? (typeof input.version === "number" && Number.isSafeInteger(input.version) && input.version >= 1 ? input.version : 1);
  const updatedAt = stamp.updatedAt ?? (typeof input.updatedAt === "string" && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : new Date(0).toISOString());
  if (read.issues.length) throw new BrandGuideError(read.issues.length === 1 ? read.issues[0] : `${read.issues[0]} (${read.issues.length - 1} more issue${read.issues.length === 2 ? "" : "s"})`, 400, read.issues);
  return { id, name, version, updatedAt, source, purpose, personality, principles, colors, accentGradient, text, layout, logos, examples, rules, bannedWords, hooks };
}

/* ─── Reading a guide ────────────────────────────────────────────────────── */

const strip = (value: string) => value.slice(0, 7).toUpperCase();
export function guideColor(guide: BrandGuide, role: GuideColorRole): string | undefined {
  return guide.colors.find(color => color.role === role)?.value;
}
export function guideTextStyle(guide: BrandGuide, role: GuideTextRole): GuideTextStyle | undefined {
  return guide.text.find(style => style.role === role);
}
/** Every color a layer may use: the guide's colors and its gradient ends. */
export function guidePalette(guide: BrandGuide): Set<string> {
  return new Set([...guide.colors.map(color => color.value.toUpperCase()), ...(guide.accentGradient ? [guide.accentGradient.from, guide.accentGradient.to] : [])].map(strip));
}
export const guideFonts = (guide: BrandGuide) => new Set(guide.text.map(style => style.font));
export const guideCheckRules = (guide: BrandGuide) => guide.rules.filter(rule => rule.use === "check");
/** The code checks this guide turns on. */
export function enabledChecks(guide: BrandGuide): Set<GuideCheckKind> {
  return new Set(guide.rules.flatMap(rule => rule.use === "check" && rule.check ? [rule.check] : []));
}

export type GuideTokens = {
  background: string; text: string; accent: string; accentEnd: string; surface: string; secondary: string; source: string;
  gradient: BrandGuide["accentGradient"];
  styles: Partial<Record<GuideTextRole, GuideTextStyle>>;
  layout: GuideLayout;
};
/** The values templates are built from. */
export function guideTokens(guide: BrandGuide): GuideTokens {
  const text = guideColor(guide, "text") ?? "#FFFFFF", accent = guideColor(guide, "accent") ?? "#00D98A";
  return {
    background: guideColor(guide, "background") ?? "#000000", text, accent,
    accentEnd: guideColor(guide, "accent-end") ?? guide.accentGradient?.to ?? accent,
    surface: guideColor(guide, "surface") ?? guideColor(guide, "background") ?? "#000000",
    secondary: guideColor(guide, "secondary") ?? text,
    source: guideColor(guide, "source") ?? guideColor(guide, "secondary") ?? text,
    gradient: guide.accentGradient,
    styles: Object.fromEntries(guide.text.map(style => [style.role, style])) as GuideTokens["styles"],
    layout: guide.layout,
  };
}

/** A vertical gradient as a brand-safe SVG, so selected words can carry it as a word texture. */
export function accentTexture(guide: BrandGuide, id = "accent"): ShapeImageFill & { id: string } | null {
  const gradient = guide.accentGradient;
  if (!gradient) return null;
  const rad = (gradient.angle - 90) * Math.PI / 180;
  const [dx, dy] = [Math.cos(rad) * 50, Math.sin(rad) * 50];
  const point = (value: number) => `${Math.round((50 + value) * 100) / 100}%`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><linearGradient id="brand-g0" x1="${point(-dx)}" y1="${point(-dy)}" x2="${point(dx)}" y2="${point(dy)}"><stop offset="0%" stop-color="${gradient.from}"/><stop offset="100%" stop-color="${gradient.to}"/></linearGradient></defs><path d="M0 0H100V100H0Z" fill="url(#brand-g0)"/></svg>`;
  return { id, src: BRAND_SVG_PREFIX + encodeURIComponent(svg), objectFit: "cover", cropX: 50, cropY: 50, intrinsicWidth: 100, intrinsicHeight: 100 };
}

/** Topic logos for whatever a cover names, in the order the cover names them. */
export function topicLogosFor(text: string, guide: BrandGuide, max = 2): GuideLogo[] {
  const plain = ` ${text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ")} `;
  const found = guide.logos.flatMap(logo => {
    if (logo.role !== "topic") return [];
    const at = Math.min(...logo.topics.map(topic => {
      const needle = ` ${topic.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").trim()} `;
      const index = needle.trim() ? plain.indexOf(needle) : -1;
      return index < 0 ? Infinity : index;
    }));
    return Number.isFinite(at) ? [{ logo, at }] : [];
  });
  return found.sort((a, b) => a.at - b.at).slice(0, max).map(item => item.logo);
}

const sentence = (value: string) => value.trim().replace(/[.\s]+$/, "");
/**
 * The guide in plain words, for every agent's instructions. About a page: the
 * brand, colors, type, layout, cover, media, writing and the checks a critic
 * or code will hold the post to.
 */
export function guideBrief(guide: BrandGuide): string {
  const t = guideTokens(guide);
  const rulesFor = (areas: GuideRuleArea[], use?: GuideRule["use"]) => guide.rules.filter(rule => areas.includes(rule.area) && (!use || rule.use === use)).map(rule => `- ${sentence(rule.text)}`);
  const style = (item: GuideTextStyle) => `- ${item.name}: ${fontName(item.font)} ${item.size} px, weight ${item.weight}, line height ${item.lineHeight}${item.case === "sentence" ? ", sentence case" : item.case === "upper" ? ", capitals" : ""}${item.fill === "accent-gradient" ? ", accent gradient inside the letters" : `, ${item.color}`}${item.note ? `. ${sentence(item.note)}` : ""}`;
  const { layout } = guide;
  const topics = guide.logos.filter(logo => logo.role === "topic").flatMap(logo => logo.topics.slice(0, 1));
  return [
    `BRAND GUIDE: ${guide.name}, version ${guide.version}${guide.source ? ` (from ${guide.source})` : ""}`,
    [guide.purpose && `Purpose: ${sentence(guide.purpose)}`, guide.personality && `Personality: ${sentence(guide.personality)}`].filter(Boolean).join("\n"),
    guide.principles.length ? `Principles:\n${guide.principles.map(item => `- ${item.name}: ${sentence(item.text)}`).join("\n")}` : "",
    `Colors:\n${guide.colors.map(color => `- ${color.name} ${color.value}${color.use ? `: ${sentence(color.use)}` : ""}`).join("\n")}${t.gradient ? `\n- Accent gradient ${t.gradient.from} to ${t.gradient.to}, top to bottom inside the letters` : ""}`,
    guide.text.length ? `Type:\n${guide.text.map(style).join("\n")}` : "",
    `Layout: ${layout.width} × ${layout.height} px. Text margins ${layout.marginLeft} px left and ${layout.marginRight} px right (text ${layout.width - layout.marginLeft - layout.marginRight} px wide), ${layout.titleBodyGap} px from title to text, about ${layout.headerContentGap} px from the text to the media. Nothing under ${layout.minTextSize} px. ${layout.media === "natural" ? "Photos and videos keep their own proportions" : "Photos fill their frames"}`,
    ...([["Cover", ["cover", "logos"]], ["Media", ["media"]], ["Writing", ["writing", "type", "layout", "color"]]] as [string, GuideRuleArea[]][]).map(([title, areas]) => {
      const lines = rulesFor(areas);
      return lines.length ? `${title}:\n${lines.join("\n")}` : "";
    }),
    topics.length ? `Topic logos on file: ${topics.join(", ")}. A cover that names one of these carries its logo` : "",
    guide.bannedWords.length ? `Never in our headlines: ${guide.bannedWords.join(", ")}` : "",
    guide.examples.length ? `Approved example posts: ${guide.examples.map(example => example.note ? `${example.name} (${sentence(example.note)})` : example.name).join("; ")}` : "",
    guideCheckRules(guide).length ? `Checked on every post (a critic or code flags anything that breaks these):\n${guideCheckRules(guide).map(rule => `- ${sentence(rule.text)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** A short line for lists: name, version and what it holds. */
export function guideSummary(guide: BrandGuide) {
  return {
    id: guide.id, name: guide.name, version: guide.version, updatedAt: guide.updatedAt, source: guide.source,
    colors: guide.colors.length, textStyles: guide.text.length, logos: guide.logos.length, topicLogos: guide.logos.filter(logo => logo.role === "topic").length,
    examples: guide.examples.length, rules: guide.rules.length, checks: enabledChecks(guide).size,
  };
}

/* ─── Checks ─────────────────────────────────────────────────────────────── */

type CheckTarget = { format: DesignFormat; customSize?: { width: number; height: number }; pages: DesignPage[] };
export type CheckOptions = {
  /** "deck": copy and the layers people or agents added. "template": every layer of a template draft. */
  scope: "deck" | "template";
  /** 1-based slide number for page `index`; defaults to index + 1. */
  slideOf?: (index: number) => number;
  language?: "en" | "es";
  /** Kinds another check already covers (the page's own format rules). */
  skip?: GuideCheckKind[];
  /** X's font (Chirp) isn't installed here, so text in it falls back to SF Pro. */
  xFontMissing?: boolean;
};

const isReactionPage = (page: DesignPage) => (page.canvas?.elements ?? []).some(element => element.slot?.startsWith("reaction-"));
/** Layers whose look the template sets; a deck can't restyle them, so deck checks leave their style to the template's own check. */
const templateStyled = (element: CanvasElement) => element.templateRole === "brand" || Boolean(element.protected?.includes("style"));
const spanColors = (element: CanvasElement) => element.type === "text" ? [...(element.richText ?? "").matchAll(/color\s*:\s*(#[0-9A-Fa-f]{6,8})/g)].map(match => match[1]) : [];
function colorsOf(element: CanvasElement): string[] {
  const colors: string[] = [];
  const add = (value: unknown) => { if (typeof value === "string" && /^#[0-9A-Fa-f]{6}/.test(value)) colors.push(value); };
  if (element.type === "text") {
    if (!element.gradient && !element.textureFill) add(element.color);
  } else if (element.type === "shape") {
    // Fades and scrims (a stop at 0 opacity, or a page-dark overlay) are part of the look, not new colors.
    if (!element.gradient && !element.imageFill) add(element.fill);
    if (element.strokeWidth > 0) add(element.stroke);
  }
  for (const stop of element.gradient?.stops ?? []) add(stop.color);
  return [...colors, ...spanColors(element)];
}
const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
const titleCaseWord = /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/;
/** A content title written In Title Case or ALL CAPS rather than sentence case. */
export function notSentenceCase(text: string, locale = "en"): "capitals" | "title case" | null {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length > 3 && text === text.toLocaleUpperCase(locale) && /\p{Ll}/u.test(text.toLocaleLowerCase(locale))) {
    const words = text.split(/\s+/).filter(word => /\p{L}{2,}/u.test(word));
    // Short acronyms alone (AI, GPT-5) are fine; a title of capital words is not.
    if (words.filter(word => word.replace(/[^\p{L}]/gu, "").length > 3).length >= 2) return "capitals";
  }
  const words = text.split(/\s+/).slice(1).map(word => word.replace(/[^\p{L}]/gu, "")).filter(word => word.length >= 4);
  const titled = words.filter(word => titleCaseWord.test(word)).length;
  return titled >= 3 && titled / Math.max(words.length, 1) >= 0.6 ? "title case" : null;
}

/** Runs the guide's code checks on a deck or a template draft. */
export function runGuideChecks(target: CheckTarget, guide: BrandGuide, options: CheckOptions): GuideIssue[] {
  const enabled = enabledChecks(guide), skip = new Set(options.skip ?? []);
  const on = (kind: GuideCheckKind) => enabled.has(kind) && !skip.has(kind);
  const issues: GuideIssue[] = [];
  const width = target.customSize?.width ?? FORMATS[target.format].width, height = target.customSize?.height ?? FORMATS[target.format].height;
  const k = width / 360, locale = options.language === "es" ? "es" : "en";
  const palette = guidePalette(guide), fonts = guideFonts(guide), { layout } = guide;
  const scaleX = width / layout.width, scaleY = height / layout.height;
  const add = (kind: GuideCheckKind, slide: number, problem: string, fix: string, overrides: Partial<GuideIssue> = {}) => {
    const meta = GUIDE_CHECKS[kind];
    issues.push({ slide, problem, fix, severity: meta.severity, route: options.scope === "template" ? "none" : meta.route, check: kind, ...overrides });
  };
  const titleStyle = guideTextStyle(guide, "title"), sourceColor = guideColor(guide, "source");
  const remarkLimit = 40;
  target.pages.forEach((page, index) => {
    const slide = options.slideOf?.(index) ?? index + 1;
    // A video is checked like a photo (no colors to match), except that it needs a poster.
    for (const element of page.canvas?.elements ?? []) {
      const clip = element.type === "image" ? element.video : element.type === "shape" ? element.imageFill?.video : undefined;
      if (!element.hidden && clip?.noPoster && !skip.has("video-poster")) add("video-poster", slide, `The video “${element.name}” has no poster, so thumbnails, PNG and PDF show a dark frame`, "Set a poster: in the editor's Video tab choose Use this frame as cover, or send update_element with poster (an image from the clip)");
    }
    const chirp = (page.canvas?.elements ?? []).filter(element => element.type === "text" && !element.hidden && element.font === "chirp");
    if (options.xFontMissing && options.scope === "deck" && chirp.length && !skip.has("x-font") && !issues.some(issue => issue.check === "x-font")) add("x-font", slide, `X's font (Chirp) isn't installed, so “${chirp[0].name}” and the other post text in Chirp show SF Pro instead`, "Add Chirp-Regular.woff2 and Chirp-Bold.woff2 to public/fonts/licensed (and to the licensed font bundle for deploys)");
    if (isReactionPage(page)) return; // Reaction pages keep their own post-card design.
    for (const element of page.canvas?.elements ?? []) {
      if (element.hidden) continue;
      // In a deck, the template's own layers keep the template's look; only what was added or written is checked.
      const fromTemplate = options.scope === "deck" && templateStyled(element);
      if (on("palette")) {
        const off = [...new Set((fromTemplate ? spanColors(element) : colorsOf(element)).map(strip))].filter(color => !palette.has(color));
        if (off.length) add("palette", slide, `“${element.name}” uses ${off.join(", ")}, which isn't in the ${guide.name} colors`, `Use a guide color: ${[...palette].join(", ")}`, fromTemplate ? { route: "copy" } : {});
      }
      if (element.type !== "text") continue;
      const label = element.slot ?? element.name;
      // Padding (accent room on Spanish templates) is box, not text: measure where the words are.
      const pad = element.padding ?? 0;
      if (!fromTemplate) {
        // X's font is always allowed: post cards look like X, whatever the page's own fonts.
        if (on("fonts") && !fonts.has(element.font) && element.font !== "chirp") add("fonts", slide, `“${element.name}” is set in ${fontName(element.font)}, which the guide doesn't use`, `Use ${[...fonts].map(fontName).join(" or ")}`);
        const px = element.fontSize * k;
        if (on("min-text-size") && px < layout.minTextSize * scaleX - 0.5) add("min-text-size", slide, `“${element.name}” is ${Math.round(px * 10) / 10} px, under the ${layout.minTextSize} px minimum`, `Set it to at least ${layout.minTextSize} px`);
      }
      if (on("text-margins") && !fromTemplate) {
        const left = (element.x + pad) * k, right = (element.x + element.width - pad) * k;
        const symmetric = element.align !== "left" && Math.abs(left - (width - right)) < 2;
        const min = layout.marginLeft * scaleX - 6, max = width - layout.marginRight * scaleX + 6;
        if (!symmetric && (left < min || right > max)) {
          const past = left < min ? Math.round(layout.marginLeft * scaleX - left) : Math.round(right - (width - layout.marginRight * scaleX));
          add("text-margins", slide, `“${element.name}” sits ${past} px past the ${left < min ? "left" : "right"} margin`, `Keep text ${layout.marginLeft} px from the left edge and ${layout.marginRight} px from the right`);
        }
      }
      if (options.scope === "template") {
        if (on("source-line") && element.slot === "source") {
          const bottom = (element.y + element.height - pad) * k, wanted = height - layout.marginBottom * scaleY;
          if (sourceColor && strip(element.color) !== strip(sourceColor)) add("source-line", slide, `The source line is ${element.color}, not ${sourceColor}`, `Set the source line to ${sourceColor}`);
          if (Math.abs(bottom - wanted) > 4) add("source-line", slide, `The source line ends at ${Math.round(bottom)} px, not on the bottom margin (${Math.round(wanted)} px)`, "Pin the source line to the bottom margin");
        }
        if (on("spacing") && element.smartFlow) {
          const flow = element.smartFlow, elements = page.canvas?.elements ?? [];
          const anchor = elements.find(other => other.id === flow.after) ?? elements.find(other => other.slot === flow.after);
          const gap = (flow.gap + (anchor?.type === "text" ? anchor.padding ?? 0 : 0) + pad) * k;
          if (element.slot === "body" && element.smartFlow.after === "title" && Math.abs(gap - layout.titleBodyGap * scaleY) > 1) add("spacing", slide, `The text sits ${Math.round(gap)} px under the title, not ${layout.titleBodyGap} px`, `Set the gap under the title to ${layout.titleBodyGap} px`);
        }
        if (on("accent-fill") && element.slot === "title" && titleStyle?.fill === "accent-gradient" && !element.gradient) add("accent-fill", slide, "The title is a flat color, not the accent gradient", "Fill the title with the accent gradient");
      }
      // A template's sample copy isn't a post, so copy checks run on decks only.
      const text = element.text.trim();
      if (options.scope === "template" || !text || !element.slot || element.templateRole === "brand") continue;
      const copyRoute = {};
      if (on("no-final-period") && lines(text).some(line => /(?<!\.)\.$/.test(line))) add("no-final-period", slide, `The ${label} text ends with a full stop`, "Drop the final full stop", copyRoute);
      if (on("no-em-dash") && text.includes("—")) add("no-em-dash", slide, `The ${label} text uses an em dash`, "Use a comma, colon or a new sentence instead", copyRoute);
      if (on("sentence-case-titles") && element.slot === "title") {
        const found = notSentenceCase(text, locale);
        if (found) add("sentence-case-titles", slide, `The title is in ${found}, not sentence case`, "Write the title in sentence case: a capital only on the first word and on names", copyRoute);
      }
      if (on("upper-cover") && element.slot === "cover-headline" && text !== text.toLocaleUpperCase(locale)) add("upper-cover", slide, "The cover headline isn't in capitals", "Write the cover headline in ALL CAPS", copyRoute);
      if (on("body-length") && element.slot === "body" && [...text].length > 80) add("body-length", slide, `The body is ${[...text].length} characters, more than two short lines`, "Cut it to about 75 characters, one short sentence", copyRoute);
      if (on("banned-words") && (element.slot === "cover-headline" || element.slot === "title")) {
        const lower = text.toLocaleLowerCase(locale);
        const hits = guide.bannedWords.filter(word => {
          const needle = word.toLocaleLowerCase(locale);
          return /^[\p{L}\p{N}]+$/u.test(needle) ? new RegExp(`(?<![\\p{L}\\p{N}])${needle}(?![\\p{L}\\p{N}])`, "u").test(lower) : lower.includes(needle);
        });
        if ((text.match(/!/g) ?? []).length > 1) hits.push("more than one !");
        if (hits.length) add("banned-words", slide, `The ${label} uses ${hits.map(hit => `“${hit}”`).join(", ")}`, "Rewrite it without them", copyRoute);
      }
      if (on("cover-remark") && element.slot === "cover-remark" && [...text].length > remarkLimit) add("cover-remark", slide, `The cover remark is ${[...text].length} characters; keep it brief`, `Cut it to at most ${remarkLimit} characters`, copyRoute);
    }
  });
  return issues;
}

/** True when a text layer is a content title the guide fills with its accent. */
export const isContentTitle = (element: CanvasElement): element is TextElement => element.type === "text" && element.slot === "title";
