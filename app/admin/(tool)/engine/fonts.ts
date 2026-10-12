import localFont from "next/font/local";

/**
 * The slide editor's font palette — the same Google faces, but their
 * woff2 files live IN THE REPO (./typefaces/google) and load through
 * next/font/local. next/font/google downloads every family from
 * Google's CDN on every build, and one flaky fetch fails the whole
 * deploy — that killed three production builds on 2026-08-14 alone.
 * Self-hosting deletes the failure class; nothing changes visually.
 * `preload: false` keeps the page light; a font's files load only
 * once a slide actually uses it.
 *
 * Libre Baskerville (serif) and Geist (sans) come from the site's root layout
 * (`--font-serif` / `--font-sans`), so they aren't re-declared here.
 */

const playfair = localFont({
  src: [
    { path: "./typefaces/google/playfair-display-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/playfair-display-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-playfair",
  preload: false,
});
const dmserif = localFont({
  src: [
    { path: "./typefaces/google/dm-serif-display-latin-regular.woff2", weight: "400", style: "normal" },
  ],
  variable: "--gf-f-dmserif",
  preload: false,
});
const lora = localFont({
  src: [
    { path: "./typefaces/google/lora-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/lora-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-lora",
  preload: false,
});
const cormorant = localFont({
  src: [
    { path: "./typefaces/google/cormorant-garamond-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/cormorant-garamond-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-cormorant",
  preload: false,
});
const crimson = localFont({
  src: [
    { path: "./typefaces/google/crimson-text-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/crimson-text-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-crimson",
  preload: false,
});
const inter = localFont({
  src: [
    { path: "./typefaces/google/inter-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/inter-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-inter",
  preload: false,
});
const space = localFont({
  src: [
    { path: "./typefaces/google/space-grotesk-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/space-grotesk-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-space",
  preload: false,
});
const montserrat = localFont({
  src: [
    { path: "./typefaces/google/montserrat-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/montserrat-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-montserrat",
  preload: false,
});
const bebas = localFont({
  src: [
    { path: "./typefaces/google/bebas-neue-latin-regular.woff2", weight: "400", style: "normal" },
  ],
  variable: "--gf-f-bebas",
  preload: false,
});
const plexmono = localFont({
  src: [
    { path: "./typefaces/google/ibm-plex-mono-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/ibm-plex-mono-latin-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--gf-f-plexmono",
  preload: false,
});
const caveat = localFont({
  src: [
    { path: "./typefaces/google/caveat-latin-regular.woff2", weight: "400", style: "normal" },
    { path: "./typefaces/google/caveat-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--gf-f-caveat",
  preload: false,
});

/* ── Licensed typefaces (GT Walsheim, PP Kyoto, Century Gothic) ──
 * These are commercial fonts, so their files are NOT in the repo. They
 * load through plain @font-face rules in ./licensed-fonts.css from
 * public/fonts/licensed/ (gitignored). Drop your own licensed copies
 * there; without them the picker's options fall back to system fonts. */

/** Class string that exposes every font variable — applied to .gf-root. */
export const ENGINE_FONT_VARS = [
  playfair.variable,
  dmserif.variable,
  lora.variable,
  cormorant.variable,
  crimson.variable,
  inter.variable,
  space.variable,
  montserrat.variable,
  bebas.variable,
  plexmono.variable,
  caveat.variable,
].join(" ");

/** The picker's options. `id` is stored on SlideStyle.font ("serif"/"sans"
 * from older slides map to libre/geist). */
export const ENGINE_FONTS: Array<{ id: string; label: string }> = [
  { id: "walsheim", label: "GT Walsheim" },
  { id: "walsheimcond", label: "GT Walsheim Condensed" },
  { id: "kyoto", label: "PP Kyoto" },
  { id: "century", label: "Century Gothic" },
  { id: "libre", label: "Libre Baskerville" },
  { id: "geist", label: "Geist Sans" },
  { id: "playfair", label: "Playfair Display" },
  { id: "dmserif", label: "DM Serif Display" },
  { id: "lora", label: "Lora" },
  { id: "cormorant", label: "Cormorant Garamond" },
  { id: "crimson", label: "Crimson Text" },
  { id: "inter", label: "Inter" },
  { id: "space", label: "Space Grotesk" },
  { id: "montserrat", label: "Montserrat" },
  { id: "bebas", label: "Bebas Neue" },
  { id: "plexmono", label: "IBM Plex Mono" },
  { id: "caveat", label: "Caveat" },
];
