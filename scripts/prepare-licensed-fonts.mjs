import { createDecipheriv, createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const BUNDLE_VERSION = 1;
export const BUNDLE_AAD = Buffer.from("engine-licensed-fonts:v1", "utf8");
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
export const REQUIRED_FONT_NAMES = Object.freeze([
  "SF-Pro-Display-Regular.otf", "SF-Pro-Display-Bold.otf",
  "SF-Pro-Display-RegularItalic.otf", "SF-Pro-Display-BoldItalic.otf",
  "SF-Pro-Display-Canva-Regular.woff2", "SF-Pro-Display-Canva-Bold.woff2",
  "SF-Pro-Display-Canva-Regular.ttf", "SF-Pro-Display-Canva-Bold.ttf",
  "BebasNeueBold-Canva.woff2",
]);
export const ALLOWED_FONT_NAMES = Object.freeze([
  ...REQUIRED_FONT_NAMES,
  "GT-Walsheim-Regular-Trial.otf", "GT-Walsheim-Medium-Trial.otf", "GT-Walsheim-Bold-Trial.otf",
  "GT-Walsheim-Condensed-Regular-Trial.otf", "GT-Walsheim-Condensed-Medium-Trial.otf", "GT-Walsheim-Condensed-Bold-Trial.otf",
  "PPKyoto-Light.otf", "PPKyoto-Medium.otf", "PPKyoto-Extrabold.otf",
  "Century Gothic.otf", "Century Gothic Bold.otf",
]);
const allowedNames = new Set(ALLOWED_FONT_NAMES);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function strictBase64(value, label) {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error(`${label} must use canonical base64.`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw new Error(`${label} must use canonical base64.`);
  return bytes;
}

export function parseBundleKey(value) {
  const key = strictBase64(typeof value === "string" ? value.trim() : value, "Font bundle key");
  if (key.length !== 32) throw new Error("Font bundle key must decode to exactly 32 bytes.");
  return key;
}

/** Version byte | 12-byte IV | 16-byte GCM tag | encrypted gzip JSON. */
export function decodeFontBundle(bundle, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("Font bundle key must contain exactly 32 bytes.");
  if (!Buffer.isBuffer(bundle) || bundle.length <= 29 || bundle.length > MAX_BUNDLE_BYTES) throw new Error("Font bundle has an invalid size.");
  if (bundle[0] !== BUNDLE_VERSION) throw new Error("Unsupported font bundle version.");
  let compressed;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, bundle.subarray(1, 13));
    decipher.setAAD(BUNDLE_AAD);
    decipher.setAuthTag(bundle.subarray(13, 29));
    compressed = Buffer.concat([decipher.update(bundle.subarray(29)), decipher.final()]);
  } catch {
    throw new Error("Font bundle authentication failed. Check the deployment key and encrypted asset.");
  }
  let manifest;
  try {
    manifest = JSON.parse(gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString("utf8"));
  } catch {
    throw new Error("Font bundle must contain valid gzip JSON no larger than 64 MiB.");
  }
  if (!manifest || manifest.version !== BUNDLE_VERSION || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > ALLOWED_FONT_NAMES.length) throw new Error("Font bundle has an invalid manifest.");
  const names = new Set();
  const files = manifest.files.map(file => {
    if (!file || typeof file.name !== "string" || !allowedNames.has(file.name) || names.has(file.name)) throw new Error("Font bundle contains an unknown or duplicate filename.");
    names.add(file.name);
    if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Font bundle contains an invalid SHA-256 checksum.");
    const data = strictBase64(file.data, "Font data");
    if (!data.length || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error(`Font checksum mismatch: ${file.name}.`);
    return { name: file.name, data, sha256: file.sha256 };
  });
  if (REQUIRED_FONT_NAMES.some(name => !names.has(name))) throw new Error("Font bundle is missing required editor fonts.");
  return files;
}

async function optionalRead(filename) {
  try { return await readFile(filename, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function hasRequiredFonts(directory) {
  const present = await Promise.all(REQUIRED_FONT_NAMES.map(async name => {
    try { const info = await lstat(path.join(directory, name)); return info.isFile() && info.size > 0; }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }));
  return present.every(Boolean);
}

async function ensureFontDirectory(rootDir) {
  let directory = rootDir;
  for (const part of ["public", "fonts", "licensed"]) {
    directory = path.join(directory, part);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Font destination must contain regular directories, not symlinks.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(directory);
    }
  }
  return directory;
}

export async function prepareLicensedFonts({ rootDir = repositoryRoot, env = process.env, secretPath = "/etc/secrets/engine-fonts-key" } = {}) {
  const directory = path.join(rootDir, "public", "fonts", "licensed");
  const keyText = env.ENGINE_FONT_BUNDLE_KEY?.trim() || (await optionalRead(secretPath))?.trim();
  if (!keyText) {
    if (env.RENDER === "true") throw new Error("Render requires ENGINE_FONT_BUNDLE_KEY or /etc/secrets/engine-fonts-key to install licensed fonts.");
    return { status: await hasRequiredFonts(directory) ? "existing" : "fallback", count: 0 };
  }
  const key = parseBundleKey(keyText);
  const bundlePath = path.join(rootDir, "assets", "licensed-fonts.enc");
  const info = await lstat(bundlePath);
  if (!info.isFile() || info.size > MAX_BUNDLE_BYTES) throw new Error("Font bundle has an invalid size or file type.");
  const files = decodeFontBundle(await readFile(bundlePath), key);
  const destination = await ensureFontDirectory(rootDir);
  const staging = await mkdtemp(path.join(destination, ".engine-fonts-"));
  try {
    for (const file of files) await writeFile(path.join(staging, file.name), file.data, { flag: "wx", mode: 0o644 });
    // All content is authenticated, validated and staged before replacing a font.
    // rename replaces destination symlinks instead of following them.
    for (const file of files) await rename(path.join(staging, file.name), path.join(destination, file.name));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { status: "installed", count: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareLicensedFonts();
    if (result.status === "installed") console.log(`Installed ${result.count} licensed font files.`);
    else if (result.status === "existing") console.log("Using the existing local licensed font files.");
    else console.warn("Licensed font key is not configured; this local build will use available fonts and system fallbacks.");
  } catch (error) {
    console.error(`Unable to prepare licensed fonts: ${error.message}`);
    process.exitCode = 1;
  }
}
