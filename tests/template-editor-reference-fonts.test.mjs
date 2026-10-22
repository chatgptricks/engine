import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const filename = new URL("../lib/template-editor/reference-fonts.ts", import.meta.url);
const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const unit = { exports: {} };
vm.runInThisContext(`(function(module,exports){${source}\n})`)(unit, unit.exports);
const { referenceFontRuns, SF_PRO_REFERENCE_CHARACTERS } = unit.exports;

test("PDF reference fallback preserves all text, styling, and source runs", () => {
  const input = Object.freeze({ font: "sfpro", weight: 400, italic: false, text: "EDIT ZQJé EDIT", size: 30, color: "#fff" });
  const runs = referenceFontRuns([input]);
  assert.deepEqual(runs.map(run => [run.font, run.text]), [["sfprocanva", "EDIT "], ["sfpro", "ZQJé"], ["sfprocanva", " EDIT"]]);
  assert.equal(runs.map(run => run.text).join(""), input.text);
  assert.ok(runs.every(run => run.size === 30 && run.color === "#fff"));
  assert.equal(input.font, "sfpro");
});

test("reference coverage distinguishes weights, keeps real italics, and preserves Unicode characters", () => {
  const base = { font: "sfpro", weight: 400, italic: false, text: "#,." };
  assert.equal(referenceFontRuns([base])[0].font, "sfpro");
  assert.equal(referenceFontRuns([{ ...base, weight: 700 }])[0].font, "sfprocanva");
  const italic = { ...base, italic: true, text: "EDIT" };
  assert.equal(referenceFontRuns([italic])[0], italic);
  const emoji = referenceFontRuns([{ ...base, text: "EDIT🙂EDIT" }]);
  assert.deepEqual(emoji.map(run => run.text), ["EDIT", "🙂", "EDIT"]);
  assert.equal(referenceFontRuns([{ ...base, text: "EDIT\nEDIT" }]).length, 1);
});

test("browser Unicode ranges and PDF reference glyph coverage remain identical", () => {
  const css = fs.readFileSync(new URL("../app/admin/(tool)/engine/licensed-fonts.css", import.meta.url), "utf8");
  for (const [style, characters] of Object.entries(SF_PRO_REFERENCE_CHARACTERS)) {
    const face = style === "bold" ? "Bold" : "Regular";
    const rule = css.split("\n").find(line => line.includes(`SF-Pro-Display-Canva-${face}.woff2`));
    const range = rule.match(/unicode-range:\s*([^;]+);/)[1];
    const points = range.split(",").map(point => Number.parseInt(point.slice(2), 16));
    assert.deepEqual(points, Array.from(characters, character => character.codePointAt(0)));
  }
});
