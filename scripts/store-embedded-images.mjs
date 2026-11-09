/* Moves the images existing posts hold as data: URLs into media storage, the
 * way new posts made by agents store them (lib/template-editor/stored-images.ts),
 * so they stop counting against the 12 MB library limit. Templates keep their
 * artwork. Each image is stored once, keyed by its content hash.
 *
 * A dry run by default: it reads the library, checks every image and reports
 * what would move and how much of the save budget that frees. Nothing is written.
 *
 *   node scripts/store-embedded-images.mjs [--project <checkout>] [--owner <key>] [--apply] [--cloud]
 *
 *   --project  the checkout whose local development storage holds the library
 *              (development storage is kept per checkout folder). Default: this checkout.
 *   --owner    the workspace's owner key. Default "owner", the local development workspace.
 *   --apply    stores the images and saves the library. A copy of the library is
 *              written first, next to the development storage. Close the post's
 *              editor tabs before, so no open editor saves over the change.
 *              Run it only once the app that serves the library has this change:
 *              older versions can't read a stored SVG, so moved logos wouldn't load.
 *   --cloud    uses the Supabase workspace NEXT_PUBLIC_SUPABASE_URL and
 *              SUPABASE_SERVICE_ROLE_KEY point to, from the environment (for example
 *              node --env-file=.env.local …). Without it the script reads and writes
 *              local development storage only.
 *
 * The moved posts keep their previous version in their version history.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = name => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
};
const known = new Set(["--project", "--owner", "--apply", "--cloud", "--help"]);
const unknown = args.filter((arg, index) => arg.startsWith("--") ? !known.has(arg) : !["--project", "--owner"].includes(args[index - 1]));
if (args.includes("--help") || unknown.length) {
  if (unknown.length) console.error(`Unknown argument: ${unknown.join(" ")}`);
  console.log("Usage: node scripts/store-embedded-images.mjs [--project <checkout>] [--owner <key>] [--apply] [--cloud]");
  process.exit(unknown.length ? 1 : 0);
}
const apply = args.includes("--apply"), cloud = args.includes("--cloud");
const project = path.resolve(option("--project") ?? root), owner = option("--owner") ?? "owner";

// The app's TypeScript modules, compiled in memory as the tests do. They see the
// project as their working folder, so development storage is that checkout's.
const environment = {
  cwd: () => project,
  env: {...process.env, NODE_ENV: process.env.NODE_ENV === "production" ? "production" : "development", ...(cloud ? {} : {NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: ""})},
};
const nativeRequire = createRequire(path.join(root, "package.json"));
const ts = nativeRequire("typescript");
const modules = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const unit = {exports: {}};
  modules.set(filename, unit);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}, fileName: filename}).outputText;
  vm.runInThisContext(`(function(require,module,exports,process){${source}\n})`, {filename})(name => {
    const local = name.startsWith("@/") ? path.join(root, name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(filename), name) : null;
    if (!local) return nativeRequire(name);
    const file = [`${local}.ts`, `${local}.tsx`, local].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return load(path.relative(root, file));
  }, unit, unit.exports, environment);
  return unit.exports;
}

const persistence = load("lib/template-editor/persistence.ts");
const images = load("lib/template-editor/stored-images.ts");
const media = load("lib/template-editor/media-storage.ts");
const {checkLibrarySaveBudget, MAX_SAVE_LIBRARY_BYTES} = load("lib/template-editor/library-budget.ts");
const {parseLibrary} = load("lib/template-editor/model.ts");
const {developmentDirectory} = load("lib/template-editor/development-storage.ts");

const mb = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const kind = url => url.startsWith("data:image/svg") ? "SVG" : (url.match(/^data:image\/(\w+)/)?.[1] ?? "other").toUpperCase();

const stored = await persistence.getEditorLibrary(owner);
const place = stored.storage === "cloud" ? "cloud storage (Supabase)" : `local development storage in ${developmentDirectory("template-editor")}`;
console.log(`Library: ${place}, workspace "${owner}", revision ${stored.revision ?? "(none)"}`);
if (!stored.revision) { console.log("There is no saved library here."); process.exit(0); }
// A library over the limit is the case this is for, so it is measured, not refused.
const budgetOf = library => { const result = checkLibrarySaveBudget(library); if (result.bytes === null) throw new Error(result.error); return result; };
const usage = result => `${mb(result.bytes)} of ${mb(MAX_SAVE_LIBRARY_BYTES)}${result.ok ? "" : " (over the limit)"}`;
const before = budgetOf(stored.library);
console.log(`Save budget now: ${usage(before)}`);

// A dry run checks each image as storing it would, and writes nothing.
const checkOnly = {has: async () => false, store: (_owner, data, name) => media.inspectOriginalAsset(data, name)};
const planned = await images.storeLibraryImages(owner, stored.library, checkOnly);
const left = images.embeddedImages(planned.value.designs);
const moving = [...images.embeddedImages(stored.library.designs)].filter(url => !left.has(url));
const order = ["JPEG", "PNG", "WEBP", "SVG"], rank = name => order.includes(name) ? order.indexOf(name) : order.length;
const kinds = Object.entries(moving.reduce((counts, url) => ({...counts, [kind(url)]: (counts[kind(url)] ?? 0) + 1}), {})).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([name, count]) => `${count} ${name}`).join(", ");
const after = budgetOf(planned.value);
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
console.log(`\n${apply ? "Moving" : "Would move"} ${count(moving.length, "image")} (${kinds || "none"}) from ${count(planned.designs.length, "post")}, ${mb(planned.bytes)} of data: URLs counted once each.`);
console.log("Per post (an image several posts share counts in each):");
for (const design of [...planned.designs].sort((a, b) => b.bytes - a.bytes)) console.log(`  ${mb(design.bytes).padStart(9)}  ${count(design.images, "image").padStart(10)}  ${design.name}${design.deleted ? " (in Trash)" : ""}  [${design.id}]`);
console.log(`Staying embedded: ${count(planned.kept, "image")} from templates and photo-slot placeholders${planned.failed ? `, ${count(planned.failed, "image")} the store doesn't take (GIF, AVIF, animated or damaged)` : ""}.`);
console.log(`Save budget after: ${usage(after)}, which frees ${mb(before.bytes - after.bytes)}.`);

if (!apply) {
  console.log("\nDry run: nothing was written. Run again with --apply to move them, once the app serving this library has this change (older versions can't read stored SVGs).");
  process.exit(0);
}
if (!moving.length) { console.log("\nNothing to move."); process.exit(0); }

// A copy of the library as it was, in case the move has to be undone by hand.
const backups = path.join(path.dirname(developmentDirectory("template-editor")), "backups");
fs.mkdirSync(backups, {recursive: true, mode: 0o700});
const backup = path.join(backups, `library-before-storing-images-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(backup, JSON.stringify({owner, revision: stored.revision, library: stored.library}), {mode: 0o600});
console.log(`\nBackup of the library: ${backup}`);

const moved = await images.storeLibraryImages(owner, stored.library);
if (moved.failed > planned.failed) throw new Error(`${moved.failed - planned.failed} images couldn't be stored. Nothing was saved; run it again.`);
const next = parseLibrary(moved.value);
if (!next) throw new Error("The library with stored images doesn't read back. Nothing was saved.");
const budget = budgetOf(next);
if (!budget.ok) throw new Error(`${budget.error} Nothing was saved.`);
try {
  const saved = await persistence.saveEditorLibrary(owner, next, stored.revision, randomUUID());
  console.log(`Stored ${moved.stored} images (${moved.reused} were already stored) and saved the library: revision ${saved.revision}. Save budget: ${mb(budget.bytes)}.`);
} catch (error) {
  if (error instanceof persistence.LibraryConflictError) throw new Error("The library changed while the images were being stored, so nothing was saved. Run it again.");
  throw error;
}
