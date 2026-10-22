/** Glyphs retained from the source Canva PDF. Other glyphs use the full local SF Pro face. */
export const SF_PRO_REFERENCE_CHARACTERS = {
  regular: " '-3ABCDEFGIKLMNOPRSTUWYaeghnoprtux‑",
  bold: " #,.01245789ADEFGILMNSTWYabcdefghiklmnoprstuvwx",
};

type FontRun = { text: string; font: string; weight: number; italic: boolean };

/** Match browser unicode-range fallback while keeping every PDF character selectable. */
export function referenceFontRuns<T extends FontRun>(runs: T[]): T[] {
  return runs.flatMap(run => {
    if (run.font !== "sfpro" || run.italic || !run.text) return [run];
    const characters = SF_PRO_REFERENCE_CHARACTERS[run.weight >= 600 ? "bold" : "regular"];
    const output: T[] = [];
    for (const character of run.text) {
      const font = characters.includes(character) || "\n\r\t".includes(character) ? "sfprocanva" : "sfpro";
      const previous = output.at(-1);
      if (previous?.font === font) previous.text += character;
      else output.push({ ...run, font, text: character });
    }
    return output;
  });
}
