import { existsSync } from "node:fs";
import path from "node:path";

/** X's typeface files (font id `chirp`), supplied like the other licensed fonts. */
export const X_FONT_FILES = ["Chirp-Regular.woff2", "Chirp-Bold.woff2"] as const;

/** Whether this server has X's font; without it, text in `chirp` shows SF Pro. */
export function xFontInstalled(root = process.cwd()): boolean {
  return X_FONT_FILES.every(name => existsSync(/*turbopackIgnore: true*/ path.join(root, "public/fonts/licensed", name)));
}
