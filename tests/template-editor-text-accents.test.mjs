/* Run: node --test tests/template-editor-text-accents.test.mjs
 * Loads lib/template-editor/text-accents.test.ts (accent ranges, the cover's
 * bottom line and X's font) with the installed TypeScript compiler. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const unit = { exports: {} };
  cache.set(filename, unit);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : requireModule(name), unit, unit.exports);
  return unit.exports;
}
process.chdir(root);
load("lib/template-editor/text-accents.test.ts");
