/**
 * Colored words in template text whose style is fixed. A word's color is part
 * of a text box's content, as in the chat's `style_words` and in a template's
 * own highlighted words, so a person can color the selected words of such text
 * with the deck's highlight colors. Everything else about its words stays
 * fixed: bold, italic, underline, strikethrough, size, font and textures.
 */
import { canEditElement } from "./commands";
import { parseColor } from "./color-utils";
import type { CanvasScene, DocumentResources, TextElement } from "./model";
import type { TextFormattingPatch } from "./rich-text-editing";

export type WordColor = { name: string; color: string };

const MAX_WORD_COLORS = 6;

/** The deck's highlight colors: its accent color roles, such as Accent green
 * (#00D98A) on @chatgptricks, each color once. They're lowercase, as the chat's
 * style_words writes them. */
export function wordHighlightColors(roles: DocumentResources["colorRoles"]): WordColor[] {
  const colors: WordColor[] = [], seen = new Set<string>();
  for (const role of roles ?? []) {
    if (!/accent|highlight/i.test(`${role.id} ${role.name}`)) continue;
    const color = role.color.trim().toLowerCase(), parsed = parseColor(color);
    if (!parsed || parsed.alpha === 0 || seen.has(parsed.rgb + parsed.alpha)) continue;
    seen.add(parsed.rgb + parsed.alpha);
    colors.push({ name: role.name.trim() || "Accent", color });
    if (colors.length === MAX_WORD_COLORS) break;
  }
  return colors;
}

/** A change that only colors words, or takes their color off with `color: null`. */
export function isWordColorPatch(patch: TextFormattingPatch): boolean {
  const keys = Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key);
  if (keys.length !== 1 || keys[0] !== "color") return false;
  const parsed = patch.color === null ? null : parseColor(patch.color ?? "");
  return patch.color === null || Boolean(parsed && parsed.alpha > 0);
}

/** Template text whose words take colors and nothing else: its text can change, its style can't. */
export function takesWordColorsOnly(scene: CanvasScene, element: TextElement): boolean {
  return canEditElement(scene, element, "content") && !canEditElement(scene, element, "style");
}

/** Whether `patch` may format selected words of `element`: anything when its
 * style is editable, and only a color when the template fixes its style. */
export function canFormatWords(scene: CanvasScene, element: TextElement, patch: TextFormattingPatch): boolean {
  if (!canEditElement(scene, element, "content")) return false;
  return canEditElement(scene, element, "style") || isWordColorPatch(patch);
}
