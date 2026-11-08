/* Run: node --test tests/template-editor-chatgptricks-template.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
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
const model = load("lib/template-editor/model.ts");
const entry = load("lib/template-editor/chatgptricks-template.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const smart = load("lib/template-editor/smart-text.ts");
const { CHATGPTRICKS_TEMPLATE: template, CHATGPTRICKS_TEMPLATE_ID, CHATGPTRICKS_SLOTS } = entry;

const scene = px => px / 3;
const near = (actual, expected, message, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${message ?? ""} ${actual} != ${expected}`);
// Smart layout rounds fitted heights up to 0.01 scene px.
const close = (actual, expected, message) => near(actual, expected, message, .02);
const layer = (pageIndex, id) => template.pages[pageIndex].canvas.elements.find(element => element.id === `cgt-${id}`);
const bySlot = (canvas, slot) => canvas.elements.find(element => element.slot === slot);
const FIXED = ["cover-top-fade", "cover-bottom-fade", "cover-hairline-left", "cover-logo", "cover-hairline-right", "cover-swipe", "follow-top-fade", "follow-bottom-fade", "follow-line", "reaction-card", "reaction-x-mark", "reactions-card", "reactions-card-2", "reactions-x-mark", "reactions-x-mark-2"];
const LABELS = ["Cover", "Text + Media", "List", "Follow", "Reaction", "Reactions", "Wide photo · start", "Wide photo · end"];

test("the template is a built-in 3:4 carousel without changing Engine's formats", () => {
  assert.equal(CHATGPTRICKS_TEMPLATE_ID, "chatgptricks-3x4");
  assert.equal(model.BUILT_IN_TEMPLATES.find(candidate => candidate.id === "chatgptricks-3x4"), template);
  assert.deepEqual(template.customSize, { width: 1080, height: 1440 });
  assert.deepEqual(model.formatDimensions(template), { width: 1080, height: 1440 });
  assert.deepEqual(model.FORMATS.portrait, { label: "Portrait post", width: 1080, height: 1350 });
  near(model.templateSceneHeight(template), 480);
  // Reaction pages come after Follow, so the first four page indexes never move.
  assert.deepEqual(template.pages.map(page => page.label), LABELS);
  assert.deepEqual(CHATGPTRICKS_SLOTS.map(page => page.label), LABELS);
  assert.deepEqual(CHATGPTRICKS_SLOTS.map(page => page.page), [0, 1, 2, 3, 4, 5, 6, 7]);
  // The exact "@chatgptricks" name would switch on inference rules that rename these slots.
  assert.equal(model.isChatGPTricksTemplate(template), false);
  assert.ok(agent.agentCapabilities().templates.some(item => item.id === "chatgptricks-3x4" && item.size.height === 1440));
});

test("every layer is a native layer that survives validation and persistence", () => {
  const ids = template.pages.flatMap(page => page.canvas.elements.map(element => element.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const page of template.pages) {
    assert.ok(page.canvas.elements.every(element => ["text", "image", "shape"].includes(element.type)));
    assert.deepEqual(model.parseCanvasScene(page.canvas), page.canvas, page.label);
    assert.equal(page.canvas.background, "#0B1014");
    for (const element of page.canvas.elements) if (element.type === "text") assert.ok(["bebas", "sfpro"].includes(element.font));
  }
  const library = model.parseLibrary({ ...structuredClone(model.EMPTY_LIBRARY), templates: [structuredClone(template)] });
  assert.ok(library);
  assert.deepEqual(library.templates[0].pages, template.pages);
  const design = model.createDesign(template);
  assert.deepEqual(design.customSize, { width: 1080, height: 1440 });
  const saved = { ...structuredClone(model.EMPTY_LIBRARY), designs: [design] };
  assert.deepEqual(model.parseLibrary(JSON.stringify(saved)), saved);
  // Authored roles are used as they are: no inference rewrites this template.
  assert.equal(model.prepareSmartTemplate(template), template);
});

test("photo placeholders and the logo are safe, servable images", () => {
  const logo = layer(0, "cover-logo");
  assert.equal(logo.src, "/template-editor/chatgptricks-logo.png");
  assert.ok(fs.readFileSync(path.join(root, "public/template-editor/chatgptricks-logo.png")).subarray(0, 8).equals(Buffer.from("\x89PNG\r\n\x1a\n", "binary")));
  for (const [pageIndex, id] of [[0, "cover-photo"], [1, "media-media"], [3, "follow-photo"]]) {
    const photo = layer(pageIndex, id);
    assert.equal(photo.type, "image"); assert.equal(photo.templateRole, "media");
    assert.ok(model.isSafeBrandSvgUrl(photo.src), id);
    assert.ok(decodeURIComponent(photo.src).includes('fill="#1A242B"'));
  }
  for (const [pageIndex, id, size] of [[4, "reaction-avatar", 104], [5, "reactions-avatar", 80], [5, "reactions-avatar-2", 80]]) {
    const avatar = layer(pageIndex, id);
    assert.equal(avatar.type, "image"); assert.equal(avatar.templateRole, "media"); assert.equal(avatar.layoutRole, "media");
    assert.ok(model.isSafeBrandSvgUrl(avatar.src), id);
    near(avatar.width, scene(size)); near(avatar.height, scene(size)); near(avatar.radius, scene(size / 2), `${id} is round`);
  }
});

test("agents see the copy and photo slots; brand furniture stays fixed", () => {
  const slots = agent.agentTemplateSlots(template);
  const summary = page => slots.filter(slot => slot.pageIndex === page).map(slot => [slot.slot, slot.type, slot.role ?? null]);
  assert.deepEqual(summary(0), [["photo", "photo", null], ["cover-headline", "text", "cover"]]);
  assert.deepEqual(summary(1), [["title", "text", "heading"], ["body", "text", "body"], ["media", "photo", null], ["source", "text", "body"]]);
  assert.deepEqual(summary(2), [["title", "text", "heading"], ["body", "text", "body"], ["list-left-heading", "text", "heading"], ["list-right-heading", "text", "heading"], ["list-left-items", "text", null], ["list-right-items", "text", null], ["source", "text", "body"]]);
  assert.deepEqual(summary(3), [["photo", "photo", null], ["cta", "text", "cover"]]);
  const card = suffix => [[`reaction-avatar${suffix}`, "photo", null], [`reaction-name${suffix}`, "text", "heading"], [`reaction-handle${suffix}`, "text", "body"], [`reaction-text${suffix}`, "text", "body"], [`reaction-meta${suffix}`, "text", "body"]];
  assert.deepEqual(summary(4), [["title", "text", "heading"], ...card(""), ["source", "text", "body"]]);
  assert.deepEqual(summary(5), [["title", "text", "heading"], ...card(""), ...card("-2"), ["source", "text", "body"]]);
  // The Wide photo pair takes its one photo on page 6; page 7 shows the rest of it.
  assert.deepEqual(summary(6), [["title", "text", "heading"], ["body", "text", "body"], ["wide-photo", "photo", null]]);
  assert.deepEqual(summary(7), [["title", "text", "heading"], ["body", "text", "body"], ["source", "text", "body"]]);
  for (const page of CHATGPTRICKS_SLOTS) {
    assert.deepEqual(new Set(summary(page.page).filter(slot => slot[1] === "text").map(slot => slot[0])), new Set(page.text));
    assert.deepEqual(summary(page.page).filter(slot => slot[1] === "photo").map(slot => slot[0]), [...page.photo]);
  }
  const listed = new Set(slots.map(slot => slot.elementId));
  for (const id of FIXED) {
    const element = template.pages.flatMap(page => page.canvas.elements).find(item => item.id === `cgt-${id}`);
    assert.ok(element, id); assert.equal(listed.has(element.id), false, id);
    assert.equal(element.templateRole, "brand", id); assert.equal(element.layoutRole, "fixed", id);
    assert.deepEqual(element.protected, ["content", "position", "style", "delete"], id);
  }
  const body = slots.find(slot => slot.pageIndex === 1 && slot.slot === "body");
  assert.ok(body.maxCharacters >= 70 && body.maxCharacters <= 80, `two body lines hold about 75 characters, got ${body.maxCharacters}`);
  const guide = (pageIndex, slot) => slots.find(item => item.pageIndex === pageIndex && item.slot === slot).maxCharacters;
  assert.ok(guide(4, "reaction-text") >= 280 && guide(4, "reaction-text") <= 380, `one card holds about 280 characters of prose, got ${guide(4, "reaction-text")}`);
  for (const slot of ["reaction-text", "reaction-text-2"]) assert.ok(guide(5, slot) >= 150 && guide(5, slot) <= 175, `each of two cards holds about 160 characters, got ${guide(5, slot)}`);
  assert.ok(slots.filter(slot => slot.type === "text" && slot.role).every(slot => slot.fixedStyle));
});

test("createAgentDeck fills every slot and keeps the template's look", () => {
  const photo = "https://example.com/photo.jpg", avatar = "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg";
  const deck = agent.createAgentDeck({ name: "OpenAI ships memory", templateId: "chatgptricks-3x4", caption: "Memory is here", slides: [
    { slots: { "cover-headline": "OPENAI JUST GAVE CHATGPT A MEMORY FOR EVERY USER", photo } },
    { title: "Memory for all", body: "ChatGPT now remembers what you tell it, if you let it", slots: { media: photo, source: "Source: OpenAI, Nov 2026" } },
    { slots: { title: "Who gets it", body: "Free and paid users, in every country", "list-left-heading": "Free Plan", "list-left-items": "Saved memories\nChat history", "list-right-heading": "Paid Plan", "list-right-items": "Projects\nLonger memory", source: "Source: OpenAI help center" } },
    { slots: { cta: "TO REMEMBER MORE" } },
    { slots: { title: "How X reacted", "reaction-name": "Ada Lovelace", "reaction-handle": "@ada", "reaction-text": "Memory is the feature\n\nI have wanted since day one 🎉", "reaction-meta": "48K likes · 3.1K reposts · Nov 3, 2026", "reaction-avatar": avatar, source: "Source: X, @ada" } },
    { slots: { title: "What people are saying", "reaction-name": "Ada", "reaction-text": "First", "reaction-name-2": "Grace", "reaction-handle-2": "@grace", "reaction-text-2": "Second", "reaction-avatar-2": avatar, "reaction-meta-2": "12 likes" } },
    { slots: { title: "Where it remembers", body: "Your notes live in one place", "wide-photo": photo } },
    { slots: { title: "And where it forgets", body: "Delete a memory any time", source: "Source: OpenAI" } },
  ] });
  assert.equal(deck.templateId, "chatgptricks-3x4");
  assert.deepEqual(model.formatDimensions(deck), { width: 1080, height: 1440 });
  assert.ok(model.parseLibrary(agent.editableDeckPackage(deck)));
  const [cover, media, list, follow, reaction, reactions, wideStart, wideEnd] = deck.pages.map(page => page.canvas);
  // One photo slot fills both halves of the Wide photo pair.
  assert.equal(bySlot(wideStart, "wide-photo").src, photo); assert.equal(wideEnd.elements.find(element => element.span).src, photo);
  assert.equal(bySlot(wideEnd, "source").text, "Source: OpenAI");
  const headline = bySlot(cover, "cover-headline");
  assert.equal(headline.text, "OPENAI JUST GAVE CHATGPT A MEMORY FOR EVERY USER"); assert.equal(headline.richText, undefined);
  assert.equal(headline.font, "bebas"); assert.equal(headline.color, "#F9FFFE");
  assert.equal(bySlot(cover, "photo").src, photo);
  assert.equal(bySlot(media, "title").text, "Memory for all"); assert.equal(bySlot(media, "body").text, "ChatGPT now remembers what you tell it, if you let it");
  assert.equal(bySlot(media, "media").src, photo); assert.equal(bySlot(media, "source").text, "Source: OpenAI, Nov 2026");
  assert.equal(bySlot(list, "list-right-items").text, "Projects\nLonger memory"); assert.equal(bySlot(list, "list-left-heading").text, "Free Plan");
  assert.equal(bySlot(follow, "cta").text, "TO REMEMBER MORE");
  assert.equal(follow.elements.find(element => element.name === "Follow this page").text, "FOLLOW THIS PAGE");
  assert.equal(cover.elements.find(element => element.name === "Swipe for more").text, "SWIPE FOR MORE");
  // Post text is kept exactly, line breaks and emoji included; the card keeps the template's style.
  const post = bySlot(reaction, "reaction-text");
  assert.equal(post.text, "Memory is the feature\n\nI have wanted since day one 🎉"); assert.equal(post.richText, undefined);
  assert.equal(post.font, "sfpro"); assert.equal(post.color, "#F9FFFE"); near(post.fontSize, scene(48));
  assert.equal(bySlot(reaction, "reaction-avatar").src, avatar); assert.equal(bySlot(reaction, "reaction-handle").text, "@ada");
  assert.equal(bySlot(reaction, "reaction-handle").color, "#7D858A"); assert.equal(bySlot(reaction, "reaction-meta").color, "#7D858A"); assert.equal(bySlot(reaction, "reaction-name").fontWeight, 700);
  assert.equal(bySlot(reactions, "reaction-text-2").text, "Second"); assert.equal(bySlot(reactions, "reaction-avatar-2").src, avatar);
  near(bySlot(reactions, "reaction-text").fontSize, scene(43), "the two-card page uses body size");
  // Unfilled slots keep the template's sample copy.
  assert.equal(bySlot(reactions, "reaction-handle").text, "@handle");
  // The template itself is untouched by the copy.
  assert.equal(bySlot(template.pages[3].canvas, "cta").text, "TO STAY ON THE SAFE SIDE");
  // Fixed layers refuse copy; the cover photo also takes the slide-level image.
  assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ slots: { "Swipe for more": "TAP" } }, {}, {}, {}, {}, {}, {}, {}] }), error => error instanceof agent.AgentDeckValidationError);
  // The post cards and X marks are brand layers, not slots.
  for (const name of ["Post card", "X logo"]) assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ templatePage: 4, slots: { [name]: "x" } }] }), error => error instanceof agent.AgentDeckValidationError, name);
  const imaged = agent.createAgentDeck({ name: "Image", templateId: "chatgptricks-3x4", slides: [{ title: "A NEW COVER", image: { src: photo, alt: "A phone" } }, {}, {}, {}, {}, {}, {}, {}] });
  assert.equal(bySlot(imaged.pages[0].canvas, "photo").src, photo); assert.equal(bySlot(imaged.pages[0].canvas, "cover-headline").text, "A NEW COVER");
});

test("geometry matches the HTML slides", () => {
  const headline = layer(0, "cover-headline"), logo = layer(0, "cover-logo"), left = layer(0, "cover-hairline-left"), right = layer(0, "cover-hairline-right");
  near(headline.fontSize, scene(97)); near(headline.lineHeight, .836); near(headline.letterSpacing, scene(-1.94));
  near(headline.x, scene(68)); near(headline.width, scene(944));
  near(headline.smartText.anchorBottom, scene(1440 - 130)); near(headline.y + headline.height, scene(1310));
  near(headline.height, scene(3 * 97 * .836)); assert.equal(headline.smartText.lines, 3); assert.equal(headline.align, "center");
  near(headline.y - (logo.y + logo.height), scene(38.5)); near(logo.width, scene(52)); near(logo.x + logo.width / 2, scene(540));
  assert.equal(logo.smartFlow.after, "cover-headline"); assert.equal(logo.smartFlow.direction, "up"); near(logo.smartFlow.gap, scene(38.5));
  for (const line of [left, right]) {
    near(line.width, scene(461)); near(line.y + line.height / 2, logo.y + logo.height / 2);
    assert.equal(line.smartFlow.after, "cover-headline"); near(headline.y - line.smartFlow.gap - line.height, line.y);
  }
  near(left.x + left.width + scene(12), logo.x); near(logo.x + logo.width + scene(12), right.x);
  near(layer(0, "cover-swipe").y, scene(1334)); near(layer(0, "cover-swipe").fontSize, scene(32));
  near(layer(0, "cover-photo").height, scene(926)); near(layer(0, "cover-top-fade").height, scene(220)); near(layer(0, "cover-bottom-fade").y, scene(506));
  const title = layer(1, "media-title"), body = layer(1, "media-body"), media = layer(1, "media-media"), source = layer(1, "media-source");
  near(title.x, scene(72)); near(title.y, scene(90)); near(title.width, scene(920)); near(title.fontSize, scene(56)); assert.equal(title.color, "#00D98A");
  near(body.y - (title.y + title.height), scene(23)); near(body.fontSize, scene(43)); near(body.fontSize * body.lineHeight, scene(47.7)); assert.equal(Math.floor(body.smartText.maxHeight / (body.fontSize * body.lineHeight)), 2, "two body lines");
  near(media.y - (body.y + body.height), scene(64)); near(media.width, scene(920)); assert.equal(media.smartFlow.after, "body"); assert.equal(media.smartFlow.resize, true);
  near(source.smartText.anchorBottom, scene(1440 - 88)); near(source.fontSize, scene(24)); assert.equal(source.color, "#7D858A");
  near(source.y - (media.y + media.height), scene(40));
  const items = layer(2, "list-left-items"), heading = layer(2, "list-left-heading");
  near(layer(2, "list-right-heading").x, scene(552)); near(heading.width, scene(440)); near(items.y - (heading.y + heading.height), scene(36));
  assert.equal(items.listStyle, "bullet"); near(items.paragraphSpacing, scene(28)); near(items.fontSize * items.lineHeight, scene(42));
  assert.match(heading.richText, /color:#00D98A; font-weight:700">Risk<\/span> From AI/);
  const cta = layer(3, "follow-cta"), follow = layer(3, "follow-line");
  near(cta.smartText.anchorBottom, scene(1440 - 136)); near(cta.fontSize, scene(122)); assert.equal(cta.color, "#00D98A");
  near(follow.y + follow.height, cta.y); assert.equal(follow.smartFlow.after, "cta"); assert.equal(follow.smartFlow.direction, "up");
});

test("smart layout keeps the logo row on the headline and the media under the copy", () => {
  // Deterministic stand-in for browser text metrics.
  const measure = (element, words = smart.smartWords(element)) => ({ size: element.fontSize, widths: words.map(word => word.text.length * element.fontSize * .45), space: element.fontSize * .25 });
  const cover = structuredClone(template.pages[0].canvas);
  const headline = bySlot(cover, "cover-headline");
  headline.smartText.lines = 4; headline.text = "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT"; delete headline.richText;
  const laid = smart.layoutSmartScene(cover, measure).scene;
  const fitted = bySlot(laid, "cover-headline"), logo = laid.elements.find(element => element.id === "cgt-cover-logo");
  close(fitted.y + fitted.height, scene(1310), "bottom stays anchored");
  close(fitted.height, scene(4 * 97 * .836), "four lines at full size");
  close(fitted.y - (logo.y + logo.height), scene(38.5), "logo row follows upwards");
  const page = structuredClone(template.pages[1].canvas);
  bySlot(page, "body").text = "One line";
  const content = smart.layoutSmartScene(page, measure).scene;
  const body = bySlot(content, "body"), media = bySlot(content, "media");
  close(body.height, scene(47.7)); close(media.y - (body.y + body.height), scene(64)); close(media.y + media.height, scene(1252));
  const follow = smart.layoutSmartScene(structuredClone(template.pages[3].canvas), measure).scene;
  const cta = bySlot(follow, "cta"), line = follow.elements.find(element => element.id === "cgt-follow-line");
  close(cta.y + cta.height, scene(1304)); close(line.y + line.height, cta.y);
});

test("reaction pages share the Text + Media margins, header gap and source line", () => {
  const media = layer(1, "media-media"), mediaTitle = layer(1, "media-title");
  for (const [pageIndex, key] of [[4, "reaction"], [5, "reactions"]]) {
    const title = layer(pageIndex, `${key}-title`), card = layer(pageIndex, `${key}-card`), source = layer(pageIndex, `${key}-source`);
    for (const property of ["x", "y", "width", "fontSize", "fontWeight", "color", "lineHeight", "letterSpacing", "font"]) assert.equal(title[property], mediaTitle[property], `${key} title ${property}`);
    assert.equal(title.smartText.maxHeight, title.smartText.baseHeight, "a one-line title, so the cards start at a fixed height");
    near(card.y - (title.y + title.height), scene(64), `${key}: 64 px under the header`);
    near(card.x, media.x); near(card.width, media.width); assert.equal(card.fill, "#1A242B"); near(card.radius, scene(28));
    near(source.smartText.anchorBottom, scene(1352)); near(source.fontSize, scene(24)); assert.equal(source.color, "#7D858A"); near(source.x, scene(72));
    assert.equal(model.isSafeVectorPath(layer(pageIndex, `${key}-x-mark`).path), true);
  }
  // One card fills the same box as Text + Media's media: 72 to 992 across, down to 1252.
  const one = layer(4, "reaction-card");
  near(one.y + one.height, scene(1252)); near(one.y + one.height, media.y + media.height);
  assert.deepEqual(one.smartFlow, { after: "title", gap: scene(64), bottom: scene(1252), resize: true });
  // Inside a card: 48 px padding, text on the card's inner edge, stats pinned 48 px above its foot.
  const avatar = layer(4, "reaction-avatar"), text = layer(4, "reaction-text"), meta = layer(4, "reaction-meta"), mark = layer(4, "reaction-x-mark"), name = layer(4, "reaction-name");
  near(avatar.x - one.x, scene(48)); near(avatar.y - one.y, scene(48)); near(text.x, avatar.x); near(meta.x, avatar.x);
  near(text.x + text.width, one.x + one.width - scene(48)); near(mark.x + mark.width, one.x + one.width - scene(48));
  near(mark.y + mark.height / 2, avatar.y + avatar.height / 2, "the X mark is centred on the avatar");
  near(name.x - (avatar.x + avatar.width), scene(28));
  near(meta.smartText.anchorBottom, scene(1252 - 48)); near(text.y - (avatar.y + avatar.height), scene(32));
  near(text.fontSize * text.lineHeight, scene(60)); assert.equal(Math.floor(text.smartText.maxHeight / (text.fontSize * text.lineHeight)), 12, "twelve lines of post text");
  assert.ok(text.y + text.smartText.maxHeight <= meta.y - scene(32) + 1e-6, "the longest post still clears the stats line");
  // Two cards: the first is sized for five body lines, the second fills to 1252 40 px below it.
  const first = layer(5, "reactions-card"), second = layer(5, "reactions-card-2"), body = layer(5, "reactions-text");
  near(second.y - (first.y + first.height), scene(40)); near(second.y + second.height, scene(1252));
  near(body.fontSize, layer(1, "media-body").fontSize, "body size"); near(body.lineHeight, layer(1, "media-body").lineHeight);
  assert.equal(Math.floor(body.smartText.maxHeight / (body.fontSize * body.lineHeight)), 5);
  assert.deepEqual(first.smartFlow, { after: "reaction-avatar-2", gap: scene(88), bottom: scene(216.72), direction: "up", resize: true });
  assert.deepEqual(second.smartFlow, { after: "reaction-meta", gap: scene(88), bottom: scene(1252), resize: true });
});

test("smart layout fits the first post card to its post and lets the second fill the page", () => {
  const measure = (element, words = smart.smartWords(element)) => ({ size: element.fontSize, widths: words.map(word => word.text.length * element.fontSize * .45), space: element.fontSize * .25 });
  const fill = (pageIndex, slots) => {
    const canvas = structuredClone(template.pages[pageIndex].canvas);
    for (const [slot, text] of Object.entries(slots)) { const element = bySlot(canvas, slot); element.text = text; delete element.richText; }
    return smart.layoutSmartScene(canvas, measure);
  };
  const id = suffix => element => element.id === `cgt-reactions-${suffix}`;
  // A one-line first post: its card ends 48 px under the stats line; the second card starts 40 px lower and reaches 1252.
  const short = fill(5, { "reaction-text": "Short post" });
  const [card1, card2] = [short.scene.elements.find(id("card")), short.scene.elements.find(id("card-2"))];
  const meta1 = bySlot(short.scene, "reaction-meta"), text1 = bySlot(short.scene, "reaction-text");
  close(text1.height, scene(47.7)); close(meta1.y - (text1.y + text1.height), scene(24));
  close(card1.y + card1.height, meta1.y + meta1.height + scene(48)); close(card1.y, scene(216.72), "the first card stays under the header");
  close(card2.y - (card1.y + card1.height), scene(40)); close(card2.y + card2.height, scene(1252));
  const avatar2 = bySlot(short.scene, "reaction-avatar-2"), name2 = bySlot(short.scene, "reaction-name-2"), handle2 = bySlot(short.scene, "reaction-handle-2"), mark2 = short.scene.elements.find(id("x-mark-2"));
  close(avatar2.y - card2.y, scene(48)); close(name2.y - avatar2.y, scene(2.8)); close(handle2.y, name2.y + scene(40.8)); close(mark2.y + mark2.height / 2, avatar2.y + avatar2.height / 2);
  close(bySlot(short.scene, "reaction-text-2").y - (avatar2.y + avatar2.height), scene(24));
  const meta2 = bySlot(short.scene, "reaction-meta-2");
  close(meta2.y + meta2.height, scene(1252 - 48), "the second card's stats sit at its foot");
  // Long posts on both cards shrink rather than leave their cards.
  const long = "word ".repeat(120).trim();
  const full = fill(5, { "reaction-text": long, "reaction-text-2": long });
  for (const suffix of ["", "-2"]) {
    const text = bySlot(full.scene, `reaction-text${suffix}`), meta = bySlot(full.scene, `reaction-meta${suffix}`), layout = full.texts.get(text.id);
    assert.ok(text.y + text.height <= meta.y - scene(24) + .02, `post ${suffix || "1"} stays above its stats`);
    assert.ok(layout.fontSize < text.fontSize, "a long post shrinks");
  }
  const fullCard1 = full.scene.elements.find(id("card")), fullCard2 = full.scene.elements.find(id("card-2"));
  close(fullCard1.height, scene(497.5)); close(fullCard2.y + fullCard2.height, scene(1252)); assert.ok(fullCard2.height >= fullCard1.height - .02);
  // One card: the post wraps under the avatar, the stats stay pinned, and the card always reaches 1252.
  const single = fill(4, { "reaction-text": "Line one\n\nLine three" });
  const card = single.scene.elements.find(element => element.id === "cgt-reaction-card"), text = bySlot(single.scene, "reaction-text");
  close(card.y + card.height, scene(1252)); close(text.height, scene(3 * 60)); assert.equal(single.texts.get(text.id).lines.length, 3, "a blank line between paragraphs is kept");
  close(bySlot(single.scene, "reaction-meta").y + bySlot(single.scene, "reaction-meta").height, scene(1204));
});
