"use client";

import type { WordColor } from "@/lib/template-editor/word-colors";

type Props = {
  /** The deck's highlight colors (wordHighlightColors). */
  colors: WordColor[];
  /** A color for the selected words, or null to give them back the text's own color. */
  onColor: (color: string | null) => void;
  disabled?: boolean;
};

/** Colors for the selected words of template text whose style is fixed, and No color. */
export function WordColorControls({ colors, onColor, disabled = false }: Props) {
  return <span className="te-word-colors" role="group" aria-label="Word colors">
    {colors.map(({ name, color }) => <button key={color} type="button" className="te-word-color" aria-label={`Color selected text ${name}`} title={name} disabled={disabled} onClick={() => onColor(color)}>
      <span className="te-word-color-chip" style={{ background: color }} aria-hidden />
    </button>)}
    <button type="button" className="te-word-color" aria-label="Remove color from selected text" title="No color" disabled={disabled} onClick={() => onColor(null)}>
      <span className="te-word-color-chip is-none" aria-hidden />
    </button>
  </span>;
}
