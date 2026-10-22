Put your own licensed copies of these fonts here (they are not in git):

- GT-Walsheim-Regular-Trial.otf, GT-Walsheim-Medium-Trial.otf, GT-Walsheim-Bold-Trial.otf
- GT-Walsheim-Condensed-Regular-Trial.otf, GT-Walsheim-Condensed-Medium-Trial.otf, GT-Walsheim-Condensed-Bold-Trial.otf
- PPKyoto-Light.otf, PPKyoto-Medium.otf, PPKyoto-Extrabold.otf
- Century Gothic.otf, Century Gothic Bold.otf
- SF-Pro-Display-Regular.otf, SF-Pro-Display-Bold.otf
- SF-Pro-Display-RegularItalic.otf, SF-Pro-Display-BoldItalic.otf
- SF-Pro-Display-Canva-Regular.woff2, SF-Pro-Display-Canva-Bold.woff2
- SF-Pro-Display-Canva-Regular.ttf, SF-Pro-Display-Canva-Bold.ttf (PDF export)
- BebasNeueBold-Canva.woff2

Without them the app still works; those font options fall back to system fonts.
The file names are wired up in app/admin/(tool)/engine/licensed-fonts.css.

SF Pro Display uses the `sfpro` font ID. The original Canva Bebas Neue Bold
face uses `bebascanva`; its metrics differ from the bundled Google Bebas Neue
regular (`bebas`). Both remain editable text and use these same font files for
PDF export. These assets are deliberately ignored by git and must be supplied
separately on any machine or deployment that needs exact matching.

The optional `SF-Pro-Display-Canva-*` files contain exact glyphs retained from
the reference PDF's older SF Pro version. Their CSS Unicode ranges and PDF
coverage in `lib/template-editor/reference-fonts.ts` must match these subsets.
Existing reference text uses those glyphs; newly typed characters outside the
subsets use the full installed SF Pro files, preserving editable text throughout.

## Deployment provisioning

`npm run build` first runs `scripts/prepare-licensed-fonts.mjs`. The production
bundle is `assets/licensed-fonts.enc`; its key comes from the secret environment
variable `ENGINE_FONT_BUNDLE_KEY` or `/etc/secrets/engine-fonts-key`. Store the key
as canonical base64 encoding of 32 bytes. Never commit the key or raw font files.
The script authenticates and validates every file before installing it. Local
builds without a key keep their existing fonts or use fallbacks; Render requires
the key and complete bundle.

Bundle version 1 is binary: one version byte (`0x01`), a 12-byte IV, a 16-byte
AES-256-GCM authentication tag, then ciphertext. Authentication uses UTF-8 AAD
`engine-licensed-fonts:v1`. The plaintext is gzip-compressed JSON with the shape
`{ "version": 1, "files": [{ "name": "...", "sha256": "...", "data": "..." }] }`.
`sha256` is the lowercase hexadecimal digest of the original font bytes; `data`
contains those bytes encoded as base64. Decompression is limited to 64 MiB.
Only the documented font filenames are accepted. The nine SF Pro/Canva files
listed above are required; other documented faces are optional.
