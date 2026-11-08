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
const LABELS = ["Cover", "Text + Media", "List", "Follow", "Reaction", "Reactions"];

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
  assert.deepEqual(CHATGPTRICKS_SLOTS.map(page => page.page), [0, 1, 2, 3, 4, 5]);
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
  assert.deepEqual(summary(2), [["title", "text", "heading"], ["body", "text", "body"], ["list-left-heading", "text", "heading"], ["list-right-heading", "text", "heading"], ["list-left-items", "text", "list"], ["list-right-items", "text", "list"], ["source", "text", "body"]]);
  assert.deepEqual(summary(3), [["photo", "photo", null], ["cta", "text", "cover"]]);
  const card = suffix => [[`reaction-avatar${suffix}`, "photo", null], [`reaction-name${suffix}`, "text", "heading"], [`reaction-handle${suffix}`, "text", "body"], [`reaction-text${suffix}`, "text", "body"], [`reaction-meta${suffix}`, "text", "body"]];
  assert.deepEqual(summary(4), [["title", "text", "heading"], ...card(""), ["source", "text", "body"]]);
  assert.deepEqual(summary(5), [["title", "text", "heading"], ...card(""), ...card("-2"), ["source", "text", "body"]]);
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
  ] });
  assert.equal(deck.templateId, "chatgptricks-3x4");
  assert.deepEqual(model.formatDimensions(deck), { width: 1080, height: 1440 });
  assert.ok(model.parseLibrary(agent.editableDeckPackage(deck)));
  const [cover, media, list, follow, reaction, reactions] = deck.pages.map(page => page.canvas);
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
  assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ slots: { "Swipe for more": "TAP" } }, {}, {}, {}, {}, {}] }), error => error instanceof agent.AgentDeckValidationError);
  // The post cards and X marks are brand layers, not slots.
  for (const name of ["Post card", "X logo"]) assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ templatePage: 4, slots: { [name]: "x" } }] }), error => error instanceof agent.AgentDeckValidationError, name);
  const imaged = agent.createAgentDeck({ name: "Image", templateId: "chatgptricks-3x4", slides: [{ title: "A NEW COVER", image: { src: photo, alt: "A phone" } }, {}, {}, {}, {}, {}] });
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
  // The style guide: 72 px text margins and 936 px of text; a 56 px bold title (line height 1.04, about -1.2 px
  // tracking), the body 26 px under it in 42.67 px (1.115, about -0.35 px), and about 64 px to the media.
  for (const text of [title, body, source]) { near(text.x, scene(72)); near(text.width, scene(936)); }
  near(title.y, scene(90)); near(title.fontSize, scene(56)); near(title.lineHeight, 1.04); near(title.letterSpacing, scene(-1.2)); assert.equal(title.color, "#00D98A");
  near(title.smartText.minFontSize, title.smartText.maxFontSize, "titles keep one size across the series");
  near(body.y - (title.y + title.height), scene(26)); near(body.fontSize, scene(42.67)); near(body.lineHeight, 1.115); near(body.letterSpacing, scene(-.35));
  assert.equal(Math.floor(body.smartText.baseHeight / (body.fontSize * body.lineHeight)), 2, "two body lines");
  assert.equal(Math.floor(body.smartText.guideHeight / (body.fontSize * body.lineHeight)), 2, "agents still write two body lines");
  near(body.smartFlow.bottom, scene(1252 - 64 - 600), "longer copy grows until the media is down to 600 px");
  assert.equal(Math.floor(title.smartText.maxHeight / (title.fontSize * title.lineHeight)), 3, "a title takes up to three lines");
  near(media.y - (body.y + body.height), scene(64)); near(media.x, scene(72)); near(media.width, scene(936)); assert.equal(media.smartFlow.after, "body"); assert.equal(media.smartFlow.resize, true);
  assert.deepEqual(media.smartFlow.media, { x: 0, width: scene(1080) }, "a photo may run edge to edge");
  assert.ok(Math.abs(media.intrinsicWidth / media.intrinsicHeight - media.width / media.height) < .01, "the placeholder has the text column's shape");
  near(source.smartText.anchorBottom, scene(1440 - 88)); near(source.fontSize, scene(24)); assert.equal(source.color, "#7D858A");
  near(source.y - (media.y + media.height), scene(40));
  const items = layer(2, "list-left-items"), heading = layer(2, "list-left-heading"), rightItems = layer(2, "list-right-items");
  near(heading.y, media.y, "the lists start where the media does"); near(layer(2, "list-right-heading").x, scene(560)); near(heading.width, scene(448)); near(items.y - (heading.y + heading.height), scene(36));
  near(rightItems.x + rightItems.width, scene(1008), "two 448 px columns 40 px apart fill the 936 px of text"); near(items.y + items.height, scene(1252));
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
  close(body.height, scene(42.67 * 1.115)); close(media.y - (body.y + body.height), scene(64)); close(media.y + media.height, scene(1252));
  const follow = smart.layoutSmartScene(structuredClone(template.pages[3].canvas), measure).scene;
  const cta = bySlot(follow, "cta"), line = follow.elements.find(element => element.id === "cgt-follow-line");
  close(cta.y + cta.height, scene(1304)); close(line.y + line.height, cta.y);
});

// Reaction pages keep their own header and cards: their X-app look is being redesigned on its own.
test("reaction pages keep their header, card box and source line", () => {
  const media = layer(1, "media-media");
  for (const [pageIndex, key] of [[4, "reaction"], [5, "reactions"]]) {
    const title = layer(pageIndex, `${key}-title`), card = layer(pageIndex, `${key}-card`), source = layer(pageIndex, `${key}-source`);
    near(title.x, scene(72)); near(title.y, scene(90)); near(title.width, scene(920)); near(title.fontSize, scene(56)); near(title.lineHeight, 1.12); near(title.letterSpacing, scene(56 * -.022));
    assert.equal(title.fontWeight, 700); assert.equal(title.color, "#00D98A"); assert.equal(title.font, "sfpro");
    assert.equal(title.smartText.maxHeight, title.smartText.baseHeight, "a one-line title, so the cards start at a fixed height");
    near(card.y - (title.y + title.height), scene(64), `${key}: 64 px under the header`);
    near(card.x, scene(72)); near(card.width, scene(920)); assert.equal(card.fill, "#1A242B"); near(card.radius, scene(28));
    near(source.smartText.anchorBottom, scene(1352)); near(source.fontSize, scene(24)); assert.equal(source.color, "#7D858A"); near(source.x, scene(72));
    assert.equal(model.isSafeVectorPath(layer(pageIndex, `${key}-x-mark`).path), true);
  }
  // One card runs from 72 to 992 across and down to 1252, where Text + Media's media ends.
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
  near(body.fontSize, scene(43), "body size"); near(body.fontSize * body.lineHeight, scene(47.7));
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

// Deterministic stand-in for browser text metrics, shared by the flexible-layout tests below.
const metrics = (element, words = smart.smartWords(element)) => ({ size: element.fontSize, widths: words.map(word => word.text.length * element.fontSize * .45), space: element.fontSize * .25 });
const laidOut = (pageIndex, slots, edit = () => {}) => {
  const canvas = structuredClone(template.pages[pageIndex].canvas);
  for (const [slot, text] of Object.entries(slots)) { const element = bySlot(canvas, slot); element.text = text; delete element.richText; }
  edit(canvas);
  return smart.layoutSmartScene(canvas, metrics);
};
// Where a list's items end: its box runs on to the foot of its column.
const itemsEnd = (layout, slot) => { const element = bySlot(layout.scene, slot); return element.y + layout.texts.get(element.id).height; };

test("copy grows past its box before it shrinks, and the media under it gives way", () => {
  const dense = laidOut(1, { title: "Job openings peaked at 12.3M in March 2022, eight months before ChatGPT came out", body: "That was the month the Fed started raising rates\nSome experts blame rates, tariffs and immigration rules more than AI" });
  const title = bySlot(dense.scene, "title"), body = bySlot(dense.scene, "body"), media = bySlot(dense.scene, "media");
  assert.equal(dense.texts.get(title.id).lines.length, 3); close(dense.texts.get(title.id).fontSize, scene(56), "three title lines at full size");
  assert.ok(dense.texts.get(body.id).lines.length > 2); close(dense.texts.get(body.id).fontSize, scene(42.67), "the body keeps its size");
  assert.equal(dense.texts.get(title.id).overflow || dense.texts.get(body.id).overflow, false);
  close(title.y, scene(90)); close(body.y - (title.y + title.height), scene(26)); close(media.y - (body.y + body.height), scene(64));
  close(media.y + media.height, scene(1252)); assert.ok(media.height >= scene(600) - .02, "the media keeps at least 600 px");
  // The empty frame keeps its shape, so with less room it narrows, centred.
  assert.ok(media.width < scene(936)); close(media.x + media.width / 2, scene(540));
});

test("a photo keeps its shape: a landscape one runs edge to edge, a portrait one is centred", () => {
  const sized = (width, height) => canvas => Object.assign(bySlot(canvas, "media"), { intrinsicWidth: width, intrinsicHeight: height });
  const copy = { title: "Claude can now use your computer", body: "It moves the cursor, clicks and types to finish a task for you" };
  // 16:9 across the whole 1080 px; the title, body and photo are centred together between 90 and 1252.
  const wide = laidOut(1, copy, sized(1600, 900)).scene;
  const [title, body, photo] = ["title", "body", "media"].map(slot => bySlot(wide, slot));
  close(photo.x, 0); close(photo.width, scene(1080)); close(photo.height, scene(1080 * 9 / 16));
  close(body.y - (title.y + title.height), scene(26)); close(photo.y - (body.y + body.height), scene(64), "the gaps hold");
  assert.ok(title.y > scene(90) + 1, "the group moves down"); close(title.y - scene(90), scene(1252) - (photo.y + photo.height), "as much room above as below");
  // 9:16 as tall as the room under the copy, centred with the background on both sides.
  const tall = laidOut(1, copy, sized(900, 1600)).scene, upright = bySlot(tall, "media");
  close(bySlot(tall, "title").y, scene(90)); close(upright.y + upright.height, scene(1252));
  close(upright.width / upright.height, 9 / 16); close(upright.x + upright.width / 2, scene(540));
  // Laid out again, the page stays put (the editor saves each layout).
  const again = smart.layoutSmartScene(wide, metrics).scene;
  for (const slot of ["title", "body", "media"]) { const [before, after] = [bySlot(wide, slot), bySlot(again, slot)]; for (const key of ["x", "y", "width", "height"]) close(after[key], before[key], `${slot} ${key}`); }
  // A frame without the shape rule (decks saved before it) still fills the column to 1252, cropping its photo.
  const legacy = laidOut(1, copy, canvas => { sized(1600, 900)(canvas); delete bySlot(canvas, "media").smartFlow.media; }).scene, cropped = bySlot(legacy, "media");
  close(cropped.x, scene(72)); close(cropped.width, scene(936)); close(cropped.y + cropped.height, scene(1252)); close(bySlot(legacy, "title").y, scene(90));
  // A picture of unknown size fills the room it has.
  const unknown = bySlot(laidOut(1, copy, canvas => { const frame = bySlot(canvas, "media"); delete frame.intrinsicWidth; delete frame.intrinsicHeight; }).scene, "media");
  close(unknown.x, 0); close(unknown.width, scene(1080)); close(unknown.y + unknown.height, scene(1252));
  // Saved and loaded again, the rule survives; a broken one is refused.
  const library = document => model.parseLibrary({ ...model.EMPTY_LIBRARY, designs: [document] });
  const deck = agent.createAgentDeck({ name: "Shape", templateId: "chatgptricks-3x4", slides: [{ templatePage: 1, slots: copy }] });
  assert.deepEqual(bySlot(library(deck).designs[0].pages[0].canvas, "media").smartFlow.media, { x: 0, width: scene(1080) });
  bySlot(deck.pages[0].canvas, "media").smartFlow.media = { x: 0, width: 0 };
  assert.equal(library(deck), null);
});

test("titles keep one size, and body copy never ends on a single word", () => {
  // A title that needs a fourth line asks for shorter copy instead of shrinking.
  const long = laidOut(1, { title: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty" });
  const title = long.texts.get(bySlot(long.scene, "title").id);
  close(title.fontSize, scene(56)); assert.equal(title.overflow, true); assert.match(title.warning, /shortening/);
  // The first eleven words fill a line, so greedy wrapping would leave "dropped" alone; "job" moves down with it.
  const words = "Since then the share of new graduates who found a job dropped";
  const body = laidOut(1, { body: words }), fitted = body.texts.get(bySlot(body.scene, "body").id);
  assert.deepEqual(fitted.lines.map(line => line.text), ["Since then the share of new graduates who found a", "job dropped"]);
  // A second paragraph is its own: each ends on two words or more.
  const two = laidOut(1, { body: `${words}\n${words}` }), both = two.texts.get(bySlot(two.scene, "body").id);
  assert.deepEqual(both.lines.map(line => line.text), ["Since then the share of new graduates who found a", "job dropped", "Since then the share of new graduates who found a", "job dropped"]);
});

test("lists fill their column with one shared size and gap", () => {
  // The sample's 11 items already fill their columns: the header stays at the top and the items reach the foot.
  const full = laidOut(2, {});
  close(bySlot(full.scene, "title").y, scene(90));
  for (const slot of ["list-left-items", "list-right-items"]) assert.ok(itemsEnd(full, slot) > scene(1252) - 1, `${slot} reaches the foot of its column`);
  // Short lists grow to the body's size and open their gaps; both columns share them, so rows line up.
  const short = laidOut(2, { "list-left-items": "Cooks\nMechanics\nBartenders", "list-right-items": "Lifeguards\nRoofers" });
  const [left, right] = ["list-left-items", "list-right-items"].map(slot => short.texts.get(bySlot(short.scene, slot).id));
  close(left.fontSize, scene(43)); close(right.fontSize, left.fontSize); close(right.paragraphSpacing, left.paragraphSpacing);
  assert.ok(left.paragraphSpacing > scene(28) * 43 / 34, "gaps open past the authored ratio");
  close(bySlot(short.scene, "list-left-items").y, bySlot(short.scene, "list-right-items").y);
  // On single lines these items would stop growing short of 43 px with most of the column empty, so they wrap and reach 43 px.
  const wrapped = laidOut(2, { "list-left-items": "Computer & Math 94%\nBusiness & Finance 94%\nManagement 91%", "list-right-items": "Installation & Repair 4%\nTransportation 12%" });
  const grown = wrapped.texts.get(bySlot(wrapped.scene, "list-left-items").id), lineHeight = grown.fontSize * bySlot(wrapped.scene, "list-left-items").lineHeight;
  close(grown.fontSize, scene(43)); assert.ok((grown.height - 2 * grown.paragraphSpacing) / lineHeight > 3.5, "an item wraps onto a second line");
  // Wrapping "Grounds Maintenance 4%" would leave a word alone on a line, so the columns stay on single lines.
  const kept = laidOut(2, { "list-left-items": "Computer & Math 94%\nBusiness & Finance 94%\nManagement 91%", "list-right-items": "Grounds Maintenance 4%\nTransportation 12%" });
  const single = kept.texts.get(bySlot(kept.scene, "list-right-items").id), singleLine = single.fontSize * bySlot(kept.scene, "list-right-items").lineHeight;
  assert.ok(single.fontSize < scene(43)); close((single.height - single.paragraphSpacing) / singleLine, 2, "two items, two lines");
  // Long lists (the 22 job groups under their full names) shrink type and gaps together instead of running out of the column.
  const long = laidOut(2, {
    "list-left-items": "Management\nBusiness & Financial Operations\nComputer & Mathematical\nArchitecture & Engineering\nLife, Physical & Social Science\nLegal\nEducational Instruction & Library\nArts, Design, Entertainment, Sports & Media\nOffice & Administrative Support\nSales & Related\nCommunity & Social Service",
    "list-right-items": "Installation, Maintenance & Repair\nConstruction & Extraction\nFarming, Fishing & Forestry\nTransportation & Material Moving\nProduction\nProtective Service\nFood Preparation & Serving Related\nBuilding & Grounds Cleaning & Maintenance\nPersonal Care & Service\nHealthcare Support\nHealthcare Practitioners & Technical",
  });
  const fitted = long.texts.get(bySlot(long.scene, "list-left-items").id);
  assert.equal(fitted.overflow, false); assert.ok(fitted.fontSize < scene(34) && fitted.fontSize >= scene(26) - 1e-6, `shrinks to fit, got ${fitted.fontSize * 3} px`);
  close(bySlot(long.scene, "title").y, scene(90)); assert.ok(itemsEnd(long, "list-left-items") <= scene(1252) + .02);
});

test("copy that can't reach the foot of the page is centred on it", () => {
  // A short list: the space it can't fill is shared above the title and below the items.
  const short = laidOut(2, { "list-left-items": "Cooks\nMechanics\nBartenders", "list-right-items": "Lifeguards\nRoofers" });
  const title = bySlot(short.scene, "title"), bottom = Math.max(itemsEnd(short, "list-left-items"), itemsEnd(short, "list-right-items"));
  assert.ok(title.y > scene(90) + 1, "the copy moves down"); close(title.y - scene(90), scene(1252) - bottom, "as much space above as below");
  for (const slot of ["list-left-items", "list-right-items"]) { const items = bySlot(short.scene, slot); close(items.y + items.height, scene(1252), `${slot} still ends at the foot`); }
  close(bySlot(short.scene, "list-left-heading").y - (bySlot(short.scene, "body").y + bySlot(short.scene, "body").height), scene(64), "the 64 px header gap holds");
  // A hidden photo frame (nothing to show) gives its space back the same way; a visible one keeps the header at the top.
  const hide = canvas => { bySlot(canvas, "media").hidden = true; };
  const empty = laidOut(1, { title: "The real warning sign is for young workers", body: "Hiring of 22 to 25 year olds is down about 14%" }, hide);
  const emptyTitle = bySlot(empty.scene, "title"), emptyBody = bySlot(empty.scene, "body");
  assert.ok(emptyTitle.y > scene(90) + 1); close(emptyTitle.y - scene(90), scene(1252) - (emptyBody.y + emptyBody.height));
  close(bySlot(laidOut(1, { title: "The real warning sign is for young workers" }).scene, "title").y, scene(90));
});
