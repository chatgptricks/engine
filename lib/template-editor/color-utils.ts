export type ParsedColor = { rgb: string; alpha: number };
/** Native color pickers only accept RGB; retain alpha separately in the model. */
export function parseColor(value: string): ParsedColor | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "transparent") return { rgb: "#000000", alpha: 0 };
  if (normalized === "black" || normalized === "white") return { rgb: normalized === "black" ? "#000000" : "#ffffff", alpha: 1 };
  if (!/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(normalized)) return null;
  let hex = normalized.slice(1);
  if (hex.length <= 4) hex = [...hex].map(character => character + character).join("");
  return { rgb: `#${hex.slice(0, 6)}`, alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
}
export function colorWithAlpha(rgb: string, alpha: number): string {
  const parsed = parseColor(rgb);
  if (!parsed || !Number.isFinite(alpha)) return rgb;
  const channel = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return channel === 255 ? parsed.rgb : `${parsed.rgb}${channel.toString(16).padStart(2, "0")}`;
}
