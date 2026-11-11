/**
 * Adds licensed font files to the encrypted production bundle
 * (assets/licensed-fonts.enc), the reverse of prepare-licensed-fonts.mjs.
 *
 *   node --env-file=.env.local scripts/build-licensed-fonts-bundle.mjs [file names…]
 *
 * It opens the current bundle with ENGINE_FONT_BUNDLE_KEY (so the deploy key
 * stays the same), keeps every font in it, and adds the named files from
 * public/fonts/licensed. With no names, it adds every documented font found
 * there that the bundle doesn't have yet. The key is never printed.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ALLOWED_FONT_NAMES, BUNDLE_AAD, BUNDLE_VERSION, MAX_BUNDLE_BYTES, decodeFontBundle, parseBundleKey } from "./prepare-licensed-fonts.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Version byte | 12-byte IV | 16-byte GCM tag | encrypted gzip JSON, as decodeFontBundle reads it. */
export function encodeFontBundle(files, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Font bundle key must contain exactly 32 bytes.");
  const manifest = { version: BUNDLE_VERSION, files: files.map(file => ({ name: file.name, sha256: createHash("sha256").update(file.data).digest("hex"), data: file.data.toString("base64") })) };
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(BUNDLE_AAD);
  const body = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"), { level: 9 })), cipher.final()]);
  const bundle = Buffer.concat([Buffer.from([BUNDLE_VERSION]), iv, cipher.getAuthTag(), body]);
  if (bundle.length > MAX_BUNDLE_BYTES) throw new Error("Font bundle would be larger than 64 MiB.");
  return bundle;
}

/** The current bundle's fonts plus `names` from `fontDir` (or every documented font there it lacks). */
export async function buildFontBundle({ rootDir = repositoryRoot, keyText, names = [] }) {
  if (!keyText?.trim()) throw new Error("Set ENGINE_FONT_BUNDLE_KEY (for example with node --env-file=.env.local).");
  const key = parseBundleKey(keyText), bundlePath = path.join(rootDir, "assets", "licensed-fonts.enc"), fontDir = path.join(rootDir, "public", "fonts", "licensed");
  const files = decodeFontBundle(await readFile(bundlePath), key).map(({ name, data }) => ({ name, data }));
  const have = new Set(files.map(file => file.name));
  const unknown = names.find(name => !ALLOWED_FONT_NAMES.includes(name));
  if (unknown) throw new Error(`${unknown} isn't a documented font file name (see ALLOWED_FONT_NAMES).`);
  const wanted = names.length ? names : ALLOWED_FONT_NAMES.filter(name => !have.has(name));
  const added = [];
  for (const name of wanted) {
    const data = await readFile(path.join(fontDir, name)).catch(error => { if (error.code === "ENOENT" && !names.length) return null; throw error; });
    if (!data) continue;
    if (!data.length) throw new Error(`${name} is empty.`);
    const at = files.findIndex(file => file.name === name);
    if (at >= 0) files[at] = { name, data }; else files.push({ name, data });
    added.push(name);
  }
  const bundle = encodeFontBundle(files, key);
  decodeFontBundle(bundle, key); // the deploy's own check, before anything is replaced
  const staging = `${bundlePath}.new`;
  await writeFile(staging, bundle);
  await rename(staging, bundlePath);
  return { added, total: files.length, bytes: bundle.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { added, total, bytes } = await buildFontBundle({ keyText: process.env.ENGINE_FONT_BUNDLE_KEY, names: process.argv.slice(2) });
    console.log(added.length ? `Added ${added.join(", ")}.` : "Nothing new to add.");
    console.log(`The bundle now holds ${total} font files (${(bytes / 1048576).toFixed(1)} MB).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Couldn't build the font bundle.");
    process.exitCode = 1;
  }
}
