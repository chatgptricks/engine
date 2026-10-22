import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { BUNDLE_AAD, BUNDLE_VERSION, MAX_DECOMPRESSED_BYTES, REQUIRED_FONT_NAMES, decodeFontBundle, parseBundleKey, prepareLicensedFonts } from "../scripts/prepare-licensed-fonts.mjs";

// Public, deterministic fixture values. These are never deployment credentials.
const key = Buffer.alloc(32, 0x12), iv = Buffer.alloc(12, 0x34);
const fixture = () => ({ version: 1, files: REQUIRED_FONT_NAMES.map((name, index) => {
  const data = Buffer.from(`fixture font ${index}\u0000`);
  return { name, sha256: createHash("sha256").update(data).digest("hex"), data: data.toString("base64") };
}) });
function encrypt(compressed, fixtureKey = key) {
  const cipher = createCipheriv("aes-256-gcm", fixtureKey, iv);
  cipher.setAAD(BUNDLE_AAD);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([Buffer.from([BUNDLE_VERSION]), iv, cipher.getAuthTag(), encrypted]);
}
const encode = manifest => encrypt(gzipSync(JSON.stringify(manifest)));
async function workspace(t, bundle = encode(fixture())) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "engine-fonts-test-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  await mkdir(path.join(rootDir, "assets"));
  await writeFile(path.join(rootDir, "assets", "licensed-fonts.enc"), bundle);
  return { rootDir, secretPath: path.join(rootDir, "missing-key"), env: {} };
}

test("encrypted font bundle roundtrip preserves every original byte and checksum", () => {
  const original = fixture(), decoded = decodeFontBundle(encode(original), key);
  assert.deepEqual(decoded.map(file => file.name), REQUIRED_FONT_NAMES);
  for (const [index, file] of decoded.entries()) {
    assert.deepEqual(file.data, Buffer.from(original.files[index].data, "base64"));
    assert.equal(file.sha256, original.files[index].sha256);
  }
});

test("ciphertext, authentication tag, IV, key and version tampering are rejected", () => {
  const bundle = encode(fixture());
  for (const index of [1, 13, bundle.length - 1]) {
    const tampered = Buffer.from(bundle); tampered[index] ^= 1;
    assert.throws(() => decodeFontBundle(tampered, key), /authentication failed/);
  }
  assert.throws(() => decodeFontBundle(bundle, Buffer.alloc(32, 0x13)), /authentication failed/);
  const version = Buffer.from(bundle); version[0] = 2;
  assert.throws(() => decodeFontBundle(version, key), /Unsupported/);
  assert.throws(() => decodeFontBundle(Buffer.alloc(29), key), /invalid size/);
});

test("manifest rejects traversal, unknown names, duplicate entries and missing required faces", () => {
  for (const name of ["../escaped.otf", "/tmp/escaped.otf", "SF-Pro-Display-Regular.otf/child", "unrecognized.ttf"]) {
    const manifest = fixture(); manifest.files[0].name = name;
    assert.throws(() => decodeFontBundle(encode(manifest), key), /unknown or duplicate filename/);
  }
  const duplicate = fixture(); duplicate.files[1] = duplicate.files[0];
  assert.throws(() => decodeFontBundle(encode(duplicate), key), /duplicate filename/);
  const missing = fixture(); missing.files.pop();
  assert.throws(() => decodeFontBundle(encode(missing), key), /missing required/);
});

test("manifest validates font checksums and canonical base64 instead of accepting damaged bytes", () => {
  const checksum = fixture(); checksum.files[0].sha256 = "0".repeat(64);
  assert.throws(() => decodeFontBundle(encode(checksum), key), /checksum mismatch/);
  const malformed = fixture(); malformed.files[0].data += "!";
  assert.throws(() => decodeFontBundle(encode(malformed), key), /canonical base64/);
  assert.throws(() => parseBundleKey("not-a-valid-key"), /base64/);
  assert.throws(() => parseBundleKey(Buffer.alloc(31).toString("base64")), /32 bytes/);
  assert.deepEqual(parseBundleKey(`  ${key.toString("base64")}\n`), key);
});

test("gzip expansion is capped at 64 MiB before parsing JSON", () => {
  const compressed = gzipSync(Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1, 0x20));
  assert.throws(() => decodeFontBundle(encrypt(compressed), key), /no larger than 64 MiB/);
  assert.throws(() => decodeFontBundle(encrypt(Buffer.from("not gzip")), key), /valid gzip JSON/);
});

test("provisioning installs all validated files, preserves README and leaves no staging artifacts", async t => {
  const options = await workspace(t);
  const destination = path.join(options.rootDir, "public", "fonts", "licensed");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "README.md"), "keep this file");
  const result = await prepareLicensedFonts({ ...options, env: { RENDER: "true", ENGINE_FONT_BUNDLE_KEY: key.toString("base64") } });
  assert.deepEqual(result, { status: "installed", count: REQUIRED_FONT_NAMES.length });
  for (const file of fixture().files) assert.deepEqual(await readFile(path.join(destination, file.name)), Buffer.from(file.data, "base64"));
  assert.equal(await readFile(path.join(destination, "README.md"), "utf8"), "keep this file");
  assert.deepEqual((await readdir(destination)).sort(), [...REQUIRED_FONT_NAMES, "README.md"].sort());
});

test("secret-file key works and an invalid environment key cannot silently fall back", async t => {
  const options = await workspace(t);
  await writeFile(options.secretPath, `${key.toString("base64")}\n`);
  assert.equal((await prepareLicensedFonts({ ...options, env: { RENDER: "true" } })).status, "installed");
  await assert.rejects(prepareLicensedFonts({ ...options, env: { ENGINE_FONT_BUNDLE_KEY: "invalid" } }), /canonical base64/);
});

test("local clones retain fallback builds; Render requires a key even when fonts already exist", async t => {
  const options = await workspace(t);
  assert.deepEqual(await prepareLicensedFonts(options), { status: "fallback", count: 0 });
  await assert.rejects(prepareLicensedFonts({ ...options, env: { RENDER: "true" } }), /Render requires/);
  await prepareLicensedFonts({ ...options, env: { ENGINE_FONT_BUNDLE_KEY: key.toString("base64") } });
  assert.deepEqual(await prepareLicensedFonts(options), { status: "existing", count: 0 });
  await assert.rejects(prepareLicensedFonts({ ...options, env: { RENDER: "true" } }), /Render requires/);
});

test("an invalid bundle changes no preexisting files and symlinked destinations are rejected", async t => {
  const bad = fixture(); bad.files.at(-1).sha256 = "0".repeat(64);
  const options = await workspace(t, encode(bad));
  const destination = path.join(options.rootDir, "public", "fonts", "licensed");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, REQUIRED_FONT_NAMES[0]), "original");
  const withKey = { ...options, env: { ENGINE_FONT_BUNDLE_KEY: key.toString("base64") } };
  await assert.rejects(prepareLicensedFonts(withKey), /checksum mismatch/);
  assert.equal(await readFile(path.join(destination, REQUIRED_FONT_NAMES[0]), "utf8"), "original");
  assert.deepEqual(await readdir(destination), [REQUIRED_FONT_NAMES[0]]);
  await writeFile(path.join(options.rootDir, "assets", "licensed-fonts.enc"), encode(fixture()));
  await rm(destination, { recursive: true });
  const external = path.join(options.rootDir, "external"); await mkdir(external);
  await symlink(external, destination, "dir");
  await assert.rejects(prepareLicensedFonts(withKey), /not symlinks/);
  assert.deepEqual(await readdir(external), []);
});
