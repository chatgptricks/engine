import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accentedText, accentGradientTexture, accentProblem, textAccents } from "./text-accents";
import { agentCapabilities, agentDeckView, agentTemplateSlots, createAgentDeck, updateAgentDeck } from "./agent-decks";
import { builtInBrandGuide } from "./brand-guide-seed";
import { runGuideChecks } from "./brand-guide";
import { HTML_FONT_STACKS, htmlLayerFonts } from "./html-layer";
import { BUILT_IN_TEMPLATES, COVER_REMARK_DEFAULT, EMPTY_LIBRARY, X_FONT, parseCanvasScene, parseLibrary, type DesignDocument, type TextElement } from "./model";
import { xFontInstalled, X_FONT_FILES } from "./x-font";

const HEADLINE = "JENSEN HUANG REPORTEDLY HAS NO PRENUP, MEANING A DIVORCE COULD COST HIM $75 BILLION";
const span = (text: string, word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length });
const ACCENTS = [{ ...span(HEADLINE, "NO PRENUP"), style: "accent" }, { ...span(HEADLINE, "$75 BILLION"), style: "accent" }];
const texts = (document: DesignDocument, page = 0) => (document.pages[page].canvas?.elements ?? []).filter((element): element is TextElement => element.type === "text");
const bySlot = (document: DesignDocument, slot: string, page = 0) => texts(document, page).find(element => element.slot === slot)!;
const valid = (document: DesignDocument) => assert.ok(parseLibrary({ ...structuredClone(EMPTY_LIBRARY), designs: [document] }), "the deck is a valid document");
const cover = (slots: Record<string, unknown>) => createAgentDeck({ name: "Cover", templateId: "chatgptricks-3x4", slides: [{ templatePage: 0, slots }] });

test("accent ranges: create, serialize and read back", () => {
  const styled = accentedText(HEADLINE, ACCENTS);
  assert.equal(styled.richText, 'JENSEN HUANG REPORTEDLY HAS <span data-texture-id="accent">NO PRENUP</span>, MEANING A DIVORCE COULD COST HIM <span data-texture-id="accent">$75 BILLION</span>');
  assert.deepEqual(styled.wordTextures, [accentGradientTexture()], "one gradient texture serves every accent range");
  assert.match(decodeURIComponent(styled.wordTextures![0].src), /stop-color="#00D98A".*stop-color="#32FFBB"/);
  // The layer survives Engine's own document parser unchanged, and reads back as the same ranges.
  const element = { ...bySlot(cover({}), "cover-headline"), text: HEADLINE, ...styled } as TextElement;
  const parsed = parseCanvasScene({ background: "#000000", elements: [element] })!.elements[0] as TextElement;
  assert.equal(parsed.richText, styled.richText);
  assert.deepEqual(textAccents(parsed), ACCENTS);
  // Colors, line breaks and characters that need escaping keep their offsets.
  const post = "Up 5% & <rising>\n$NVDA and $MSFT";
  const colors = [{ ...span(post, "$NVDA"), style: "#1D9BF0" }, { ...span(post, "$MSFT"), style: "#1D9BF0" }];
  const html = accentedText(post, colors);
  assert.equal(html.richText, 'Up 5% &amp; &lt;rising&gt;<br><span style="color: #1D9BF0">$NVDA</span> and <span style="color: #1D9BF0">$MSFT</span>');
  assert.equal(html.wordTextures, undefined);
  assert.deepEqual(textAccents(html), colors);
  // The editor's own colored words read as accents too.
  assert.deepEqual(textAccents({ richText: 'A <span style="color:#00d98a">GREEN</span> word' }), [{ start: 2, end: 7, style: "#00D98A" }]);
  assert.deepEqual(accentedText("plain", []), { richText: undefined, wordTextures: undefined });
  // Saved decks keep the gradient as a media file; its id still says it's the accent.
  assert.deepEqual(textAccents({ ...styled, wordTextures: [{ ...styled.wordTextures![0], src: "/api/template-editor/assets/" + "a".repeat(64) }] }), ACCENTS);
});

test("accent ranges are checked against the text", () => {
  assert.equal(accentProblem("abc", [{ start: 0, end: 3, style: "accent" }]), null);
  assert.match(accentProblem("abc", [{ start: 0, end: 4, style: "accent" }])!, /0 ≤ start < end ≤ 3/);
  assert.match(accentProblem("abc", [{ start: 2, end: 2, style: "accent" }])!, /0 ≤ start < end/);
  assert.match(accentProblem("abcdef", [{ start: 0, end: 3, style: "accent" }, { start: 2, end: 4, style: "#FFFFFF" }])!, /overlaps/);
  assert.match(accentProblem("abc", [{ start: 0, end: 1, style: "green" }])!, /"accent" or a hex color/);
});

test("the cover headline slot takes accent words, and the deck shows them", () => {
  const deck = cover({ "cover-headline": { text: HEADLINE, accents: ACCENTS } });
  valid(deck);
  const headline = bySlot(deck, "cover-headline");
  assert.equal(headline.text, HEADLINE, "one text box");
  assert.deepEqual(textAccents(headline), ACCENTS);
  const view = (agentDeckView(deck).slides[0].elements as unknown as { id: string; accents?: unknown }[]).find(element => element.id === headline.id)!;
  assert.deepEqual(view.accents, ACCENTS, "engine_get_deck returns the accents");
  // A plain string still fills the slot without the template's sample accent.
  const plain = bySlot(cover({ "cover-headline": "JUST WORDS" }), "cover-headline");
  assert.equal(plain.richText, undefined);
  assert.throws(() => cover({ "cover-headline": { text: "SHORT", accents: [{ start: 0, end: 9, style: "accent" }] } }), /cover-headline\.accents/);
  const photo = agentTemplateSlots(BUILT_IN_TEMPLATES.find(template => template.id === "chatgptricks-3x4")!).find(item => item.pageIndex === 0 && item.type === "photo")!.slot;
  assert.throws(() => cover({ [photo]: { text: "x" } }), /takes an image source/);
});

test("content titles take accents, and update_element changes them", () => {
  const deck = createAgentDeck({ name: "Title", templateId: "chatgptricks-3x4", slides: [{ templatePage: 1, slots: { title: { text: "AI vs Jobs", accents: [{ start: 0, end: 2, style: "accent" }] } } }] });
  const title = bySlot(deck, "title");
  assert.deepEqual(textAccents(title), [{ start: 0, end: 2, style: "accent" }]);
  const pageId = deck.pages[0].id;
  const recolored = updateAgentDeck(deck, { operations: [{ op: "update_element", pageId, elementId: title.id, properties: { accents: [{ start: 6, end: 10, style: "#1D9BF0" }] } }] });
  assert.deepEqual(textAccents(bySlot(recolored, "title")), [{ start: 6, end: 10, style: "#1D9BF0" }], "accents alone restyle the current text");
  assert.equal(bySlot(recolored, "title").wordTextures, undefined, "the unused gradient goes");
  const rewritten = updateAgentDeck(recolored, { operations: [{ op: "update_element", pageId, elementId: title.id, properties: { text: "New title" } }] });
  assert.equal(bySlot(rewritten, "title").richText, undefined, "new text without accents is plain");
  const both = updateAgentDeck(rewritten, { operations: [{ op: "update_element", pageId, elementId: title.id, properties: { text: "Two words", accents: [{ start: 4, end: 9, style: "accent" }] } }] });
  assert.deepEqual(textAccents(bySlot(both, "title")), [{ start: 4, end: 9, style: "accent" }]);
  valid(both);
});

test("a post's words are one text box with blue cashtags", () => {
  const words = "BREAKING: Nvidia has erased its 2026 gain.\n$NVDA has crashed 31% in the last month";
  const deck = createAgentDeck({ name: "Post", format: "portrait", slides: [{ id: "post", elements: [{ type: "text", id: "words", text: words, x: 72, y: 400, width: 936, height: 200, font: "chirp", fontSize: 43, color: "#E7E9EA", accents: [{ ...span(words, "$NVDA"), style: "#1D9BF0" }] }] }] });
  const box = texts(deck)[0];
  assert.equal(box.font, X_FONT);
  assert.deepEqual(textAccents(box), [{ ...span(words, "$NVDA"), style: "#1D9BF0" }]);
  assert.throws(() => createAgentDeck({ name: "Shape", format: "portrait", slides: [{ elements: [{ type: "shape", x: 0, y: 0, width: 10, height: 10, accents: [] }] }] }), /accents/);
});

test("the cover's bottom line: a remark of its own, or SWIPE FOR MORE when empty", () => {
  const template = BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4")!;
  const slot = agentTemplateSlots(template).find(item => item.slot === "cover-remark");
  assert.ok(slot && slot.type === "text" && slot.pageIndex === 0 && slot.maxCharacters === 40 && slot.fixedStyle, "listed as a text slot on the cover, 40 characters at most, style fixed");
  const swipe = (document: DesignDocument) => texts(document).find(element => element.name === "Swipe for more")!;
  const untouched = swipe(cover({}));
  assert.equal(untouched.text, COVER_REMARK_DEFAULT);
  assert.equal(untouched.templateRole, "brand", "left out, the line stays the template's own SWIPE FOR MORE");
  const emptied = swipe(cover({ "cover-remark": "" }));
  assert.deepEqual(emptied, { ...untouched, id: emptied.id }, "empty keeps it too");
  const line = swipe(cover({ "cover-remark": "THE MOST EXPENSIVE DIVORCE EVER" }));
  assert.equal(line.text, "THE MOST EXPENSIVE DIVORCE EVER");
  assert.equal(line.slot, "cover-remark");
  for (const key of ["x", "y", "width", "height", "font", "fontSize", "fontWeight", "color", "align", "letterSpacing", "lineHeight", "textMode"] as const) assert.equal(line[key], untouched[key], `same ${key} as SWIPE FOR MORE`);
  assert.equal(swipe(cover({ "cover-subline": "READ THE CAPTION" })).text, "READ THE CAPTION", "cover-subline names the same line");
  assert.throws(() => cover({ "cover-remark": "X".repeat(41) }), /at most 40 characters/);
  valid(cover({ "cover-remark": "READ THE CAPTION" }));
});

test("an existing cover takes its own bottom line through update_element, and otherwise stays as it was", () => {
  const deck = cover({ "cover-headline": "OLD COVER" });
  const before = structuredClone(deck);
  valid(deck);
  assert.deepEqual(deck, before, "loading a deck changes nothing");
  const swipe = texts(deck).find(element => element.name === "Swipe for more")!;
  const pageId = deck.pages[0].id;
  const updated = updateAgentDeck(deck, { operations: [{ op: "update_element", pageId, elementId: swipe.id, properties: { text: "THE MOST EXPENSIVE DIVORCE EVER" } }] });
  const line = texts(updated).find(element => element.id === swipe.id)!;
  assert.equal(line.text, "THE MOST EXPENSIVE DIVORCE EVER");
  assert.equal(line.slot, "cover-remark");
  assert.deepEqual(line.protected, ["position", "style", "delete"]);
  assert.throws(() => updateAgentDeck(updated, { operations: [{ op: "update_element", pageId, elementId: swipe.id, properties: { fontSize: 50 } }] }), /style is protected/);
  assert.equal(texts(updateAgentDeck(updated, { operations: [{ op: "update_element", pageId, elementId: swipe.id, properties: { text: "" } }] })).find(element => element.id === swipe.id)!.text, COVER_REMARK_DEFAULT, "emptied, it says SWIPE FOR MORE again");
  assert.throws(() => updateAgentDeck(deck, { operations: [{ op: "update_element", pageId, elementId: swipe.id, properties: { color: "#FFFFFF" } }] }), /protected/, "its look stays fixed");
});

test("X's font: post cards use it, it falls back to SF Pro, and a missing font is reported", () => {
  const template = BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4")!;
  const post = template.pages.flatMap(page => page.canvas?.elements ?? []).filter((element): element is TextElement => element.type === "text" && /^reaction-(?:name|handle|text)(?:-\d+)?$/.test(element.slot ?? ""));
  assert.ok(post.length >= 3 && post.every(element => element.font === "chirp"), "every post card's name, handle and words are set in Chirp");
  assert.ok(agentCapabilities().fonts.includes("chirp"));
  assert.match(agentCapabilities().notes.join(" "), /use font chirp/);
  // Without the files, the browser (editor, thumbnails, PNG and MP4) takes the next family: SF Pro.
  assert.match(HTML_FONT_STACKS.chirp, /^var\(--gf-f-chirp\), var\(--gf-f-sfpro\)/);
  const css = fs.readFileSync(path.join(process.cwd(), "app/admin/(tool)/engine/engine.css"), "utf8");
  assert.match(css, /\.gf-font-chirp \{ font-family: var\(--gf-f-chirp\), var\(--gf-f-sfpro\)/);
  assert.ok(htmlLayerFonts({ "--body-font": HTML_FONT_STACKS.sfpro }).has("chirp"), "HTML post cards may use Chirp on any brand");
  // The server knows whether the files are installed.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "x-font-"));
  assert.equal(xFontInstalled(root), false);
  fs.mkdirSync(path.join(root, "public/fonts/licensed"), { recursive: true });
  for (const name of X_FONT_FILES) fs.writeFileSync(path.join(root, "public/fonts/licensed", name), "");
  assert.equal(xFontInstalled(root), true);
  fs.rmSync(root, { recursive: true, force: true });
  // engine_check_deck says so once per deck, and Chirp is never an off-brand font.
  const deck = createAgentDeck({ name: "Posts", format: "portrait", slides: [{ elements: [{ type: "text", text: "Bull Theory", x: 72, y: 400, width: 600, height: 60, font: "chirp", fontSize: 42 }, { type: "text", text: "@BullTheoryio", x: 72, y: 460, width: 600, height: 60, font: "chirp", fontSize: 38 }] }] });
  const base = builtInBrandGuide("chatgptricks")!;
  const guide = { ...base, rules: [...base.rules, { id: "fonts-check", text: "Fonts", use: "check" as const, check: "fonts" as const, area: "type" as const }] };
  const missing = runGuideChecks(deck, guide, { scope: "deck", xFontMissing: true });
  assert.equal(missing.filter(issue => issue.check === "x-font").length, 1);
  assert.match(missing.find(issue => issue.check === "x-font")!.problem, /X's font \(Chirp\) isn't installed/);
  assert.equal(missing.filter(issue => issue.check === "fonts").length, 0);
  assert.equal(runGuideChecks(deck, guide, { scope: "deck", xFontMissing: false }).filter(issue => issue.check === "x-font").length, 0);
});
