/**
 * Platform cards: our redraw of a post from another platform, such as an X post
 * or a Reddit comment. A card keeps that platform's own colors on purpose, the
 * way our X card copies X's dark mode. So the designer's brand-variables rule
 * and the review's off-palette check allow those colors inside a platform card,
 * and nowhere else.
 *
 * The mark: a platform card is one HTML layer, and the outermost element of its
 * markup carries two classes, `platform-card` and the platform's own:
 *
 *   <div class="platform-card platform-reddit">…</div>
 *
 * It's a class because the layer's cleaner (html-layer.ts) keeps class
 * attributes and drops data-* ones. Inside a marked layer, a color written out
 * must be one of that platform's own (PLATFORM_COLORS). Every other color still
 * comes from the brand's variables.
 */
import { X_POST_COLORS } from "./model";

export const PLATFORM_CARD_CLASS = "platform-card";
export const PLATFORMS = ["x", "reddit"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Each platform's own colors, as #RRGGBB in capitals. */
export const PLATFORM_COLORS: Readonly<Record<Platform, readonly string[]>> = {
  // X's dark mode (X_POST_COLORS); the check marks' blue, grey and gold (X_BADGES, with the gold's two gradient stops); and white.
  x: [...new Set([...Object.values(X_POST_COLORS), "#1D9BF0", "#829AAB", "#E2B719", "#F8DF5C", "#D9A21B", "#FFFFFF"].map(color => color.toUpperCase()))],
  // Reddit's dark mode: card, border, name, time and text. Then the default avatar's four colors, and its white.
  reddit: ["#0E1113", "#2F3336", "#F2F4F5", "#8BA2AD", "#EEF1F3", "#FF4500", "#FF8717", "#24A0ED", "#46D160", "#FFFFFF"],
};

/** The class attribute that marks a platform card, such as "platform-card platform-reddit". */
export const platformCardClass = (platform: Platform) => `${PLATFORM_CARD_CLASS} platform-${platform}`;

/** The platform a class attribute marks a card of, or null. */
export function platformOfClass(value: string | null | undefined): Platform | null {
  const classes = new Set((value ?? "").split(/\s+/).filter(Boolean));
  if (!classes.has(PLATFORM_CARD_CLASS)) return null;
  return PLATFORMS.find(platform => classes.has(`platform-${platform}`)) ?? null;
}

const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const FIRST_TAG = /<([a-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/i;
const CLASS_ATTRIBUTE = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** The platform an HTML layer is a card of, read from its outermost element's classes, or null. */
export function platformOfLayer(html: string | null | undefined): Platform | null {
  const tag = (html ?? "").replace(STYLE_BLOCK, " ").replace(COMMENT, " ").match(FIRST_TAG);
  const found = tag?.[2].match(CLASS_ATTRIBUTE);
  return found ? platformOfClass(found[1] ?? found[2] ?? found[3]) : null;
}

/**
 * A written-out color as #RRGGBB in capitals, or null when it isn't one. Takes
 * #rgb, #rgba, #rrggbb and #rrggbbaa, and rgb() or rgba() in either syntax
 * (what a render page's computed style gives). The alpha is dropped: a
 * see-through platform color is still the platform's.
 */
export function hexColor(value: string): string | null {
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1].slice(0, 3)].map(digit => digit + digit).join("") : hex[1].slice(0, 6);
    return `#${digits.toUpperCase()}`;
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i);
  if (!rgb) return null;
  const channels = rgb.slice(1, 4).map(part => part.endsWith("%") ? parseFloat(part) * 2.55 : parseFloat(part));
  if (channels.some(channel => !Number.isFinite(channel))) return null;
  return `#${channels.map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Whether a written-out color is one of the platform's own. */
export function isPlatformColor(platform: Platform, color: string): boolean {
  const hex = hexColor(color);
  return hex !== null && PLATFORM_COLORS[platform].includes(hex);
}
