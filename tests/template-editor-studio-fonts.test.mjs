import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALLOWED_FONT_NAMES, REQUIRED_FONT_NAMES } from "../scripts/prepare-licensed-fonts.mjs";

// Studio's fonts, as Engine font ids. Every place that lists fonts must know each one.
const STUDIO = ["poppins", "neuemontreal", "supermolot", "helvetica", "arial", "georgia"];
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("every Studio font is in the editor, the connector, brand guides, templates and the HTML stacks", () => {
  const places = {
    "model.ts": read("lib/template-editor/model.ts"),
    "agent-decks.ts": read("lib/template-editor/agent-decks.ts"),
    "brand-guide.ts": read("lib/template-editor/brand-guide.ts"),
    "html-layer.ts": read("lib/template-editor/html-layer.ts"),
    "controls.tsx": read("components/template-editor/controls.tsx"),
    "slide-templates.tsx": read("components/engine/slide-templates.tsx"),
    "fonts.ts": read("app/admin/(tool)/engine/fonts.ts"),
  };
  for (const id of STUDIO) for (const [file, text] of Object.entries(places)) assert.ok(text.includes(`"${id}"`) || text.includes(`  ${id}: `), `${file} lists ${id}`);
  const css = read("app/admin/(tool)/engine/engine.css");
  for (const id of STUDIO) assert.match(css, new RegExp(`\\.gf-font-${id} \\{ font-family: [^}]+; \\}`), `engine.css has .gf-font-${id}`);
});

test("paid Studio fonts load from the licensed folder and ride in the deploy bundle; Poppins ships in the repo", () => {
  const licensed = read("app/admin/(tool)/engine/licensed-fonts.css");
  for (const file of ["NeueMontreal-Regular.otf", "NeueMontreal-Medium.otf", "NeueMontreal-Bold.otf", "TTSupermolot-Regular.otf", "TTSupermolot-Bold.otf"]) {
    assert.ok(licensed.includes(`/fonts/licensed/${file}`), `licensed-fonts.css loads ${file}`);
    assert.ok(ALLOWED_FONT_NAMES.includes(file) && !REQUIRED_FONT_NAMES.includes(file), `${file} is an optional bundle font`);
  }
  assert.match(licensed, /--gf-f-neuemontreal: "GF Neue Montreal";/);
  assert.match(licensed, /--gf-f-supermolot: "GF TT Supermolot";/);
  const fonts = read("app/admin/(tool)/engine/fonts.ts");
  for (const weight of ["regular", "500", "600", "700"]) assert.ok(fonts.includes(`./typefaces/google/poppins-latin-${weight}.ttf`), `Poppins ${weight} is self-hosted`);
});

test("PDF export draws each Studio font: its own files, or the PDF's standard faces for system fonts", () => {
  const pdf = read("lib/template-editor/pdf-document.ts");
  assert.match(pdf, /poppins:'poppins'/);
  assert.match(pdf, /font==='neuemontreal'.*NeueMontreal-/);
  assert.match(pdf, /font==='supermolot'.*TTSupermolot-/);
  assert.match(pdf, /helvetica:\['Helvetica'/);
  assert.match(pdf, /arial:\['Helvetica'/);
  assert.match(pdf, /georgia:\['Times-Roman'/);
});
