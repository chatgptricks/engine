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
// The post cards' X marks and ".com" are fixed too; each Reaction page has one, two or three cards.
const CARDS = [[4, "reaction", 1], [5, "reactions", 2], [6, "reactions3", 3]];
const suffixOf = n => n === 1 ? "" : `-${n}`;
const FIXED = ["cover-top-fade", "cover-bottom-fade", "cover-hairline-left", "cover-logo", "cover-hairline-right", "cover-swipe", "follow-top-fade", "follow-bottom-fade", "follow-line",
  ...CARDS.flatMap(([, key, cards]) => Array.from({ length: cards }, (_, index) => ["card", "x-mark", "x-com"].map(part => `${key}-${part}${suffixOf(index + 1)}`)).flat())];
const LABELS = ["Cover", "Text + Media", "List", "Follow", "Reaction", "Two reactions", "Three reactions", "Wide photo · start", "Wide photo · end"];
// Ivan's phone screenshots of X are 1206 px wide; a card is 936 px wide with 24 px of black padding
// inside (Ivan's call), and the screenshot scales into the 888 px left. `inCard` is a screenshot
// position measured from the card's edge.
const shot = value => scene(value * (936 - 2 * 24) / 1206), inCard = value => scene(24) + shot(value);

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
  assert.deepEqual(CHATGPTRICKS_SLOTS.map(page => page.page), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
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
  for (const [pageIndex, key, cards] of CARDS) for (let n = 1; n <= cards; n++) {
    const avatar = layer(pageIndex, `${key}-avatar${suffixOf(n)}`), photo = layer(pageIndex, `${key}-media${suffixOf(n)}`);
    assert.equal(avatar.type, "image"); assert.equal(avatar.templateRole, "media"); assert.equal(avatar.layoutRole, "media");
    assert.ok(model.isSafeBrandSvgUrl(avatar.src), avatar.id);
    near(avatar.width, shot(142)); near(avatar.height, shot(142)); near(avatar.radius, shot(71), `${avatar.id} is round`);
    // The post's photo waits hidden behind a placeholder until a post brings one.
    assert.equal(photo.type, "image"); assert.equal(photo.hidden, true); assert.ok(model.isSafeBrandSvgUrl(photo.src), photo.id);
    assert.ok(decodeURIComponent(photo.src).includes('fill="#1A242B"'));
  }
});

test("agents see the copy and photo slots; brand furniture stays fixed", () => {
  const slots = agent.agentTemplateSlots(template);
  const summary = page => slots.filter(slot => slot.pageIndex === page).map(slot => [slot.slot, slot.type, slot.role ?? null]);
  assert.deepEqual(summary(0), [["photo", "photo", null], ["cover-headline", "text", "cover"]]);
  assert.deepEqual(summary(1), [["title", "text", "heading"], ["body", "text", "body"], ["media", "photo", null], ["source", "text", "body"]]);
  assert.deepEqual(summary(2), [["title", "text", "heading"], ["body", "text", "body"], ["list-left-heading", "text", "heading"], ["list-right-heading", "text", "heading"], ["list-left-items", "text", null], ["list-right-items", "text", null], ["source", "text", "body"]]);
  assert.deepEqual(summary(3), [["photo", "photo", null], ["cta", "text", "cover"]]);
  // The hidden photo layers aren't slots to write; Recreate fills and shows them.
  const card = suffix => [[`reaction-avatar${suffix}`, "photo", null], [`reaction-name${suffix}`, "text", "heading"], [`reaction-handle${suffix}`, "text", "body"], [`reaction-text${suffix}`, "text", "body"]];
  // Reaction pages have no source line: the cards show whose posts they are.
  assert.deepEqual(summary(4), [["title", "text", "heading"], ...card("")]);
  assert.deepEqual(summary(5), [["title", "text", "heading"], ...card(""), ...card("-2")]);
  assert.deepEqual(summary(6), [["title", "text", "heading"], ...card(""), ...card("-2"), ...card("-3")]);
  // The Wide photo pair takes its one photo on page 7; page 8 shows the rest of it.
  assert.deepEqual(summary(7), [["title", "text", "heading"], ["body", "text", "body"], ["wide-photo", "photo", null]]);
  assert.deepEqual(summary(8), [["title", "text", "heading"], ["body", "text", "body"], ["source", "text", "body"]]);
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
  assert.ok(guide(4, "reaction-text") >= 520 && guide(4, "reaction-text") <= 600, `one card holds a long post, got ${guide(4, "reaction-text")}`);
  for (const slot of ["reaction-text", "reaction-text-2"]) assert.ok(guide(5, slot) >= 280 && guide(5, slot) <= 340, `each of two cards holds a medium post, got ${guide(5, slot)}`);
  for (const slot of ["reaction-text", "reaction-text-2", "reaction-text-3"]) assert.ok(guide(6, slot) >= 90 && guide(6, slot) <= 115, `each of three cards holds a short post, got ${guide(6, slot)}`);
  assert.ok(slots.filter(slot => slot.type === "text" && slot.role).every(slot => slot.fixedStyle));
});

test("createAgentDeck fills every slot and keeps the template's look", () => {
  const photo = "https://example.com/photo.jpg", avatar = "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg";
  const deck = agent.createAgentDeck({ name: "OpenAI ships memory", templateId: "chatgptricks-3x4", caption: "Memory is here", slides: [
    { slots: { "cover-headline": "OPENAI JUST GAVE CHATGPT A MEMORY FOR EVERY USER", photo } },
    { title: "Memory for all", body: "ChatGPT now remembers what you tell it, if you let it", slots: { media: photo, source: "Source: OpenAI, Nov 2026" } },
    { slots: { title: "Who gets it", body: "Free and paid users, in every country", "list-left-heading": "Free Plan", "list-left-items": "Saved memories\nChat history", "list-right-heading": "Paid Plan", "list-right-items": "Projects\nLonger memory", source: "Source: OpenAI help center" } },
    { slots: { cta: "TO REMEMBER MORE" } },
    { slots: { title: "How X reacted", "reaction-name": "Ada Lovelace", "reaction-handle": "@ada", "reaction-text": "Memory is the feature\n\nI have wanted since day one 🎉", "reaction-avatar": avatar } },
    { slots: { title: "What people are saying", "reaction-name": "Ada", "reaction-text": "First", "reaction-name-2": "Grace", "reaction-handle-2": "@grace", "reaction-text-2": "Second", "reaction-avatar-2": avatar } },
    { slots: { title: "Short takes", "reaction-name-3": "Alan", "reaction-text-3": "Third" } },
    { slots: { title: "Where it remembers", body: "Your notes live in one place", "wide-photo": photo } },
    { slots: { title: "And where it forgets", body: "Delete a memory any time", source: "Source: OpenAI" } },
  ] });
  assert.equal(deck.templateId, "chatgptricks-3x4");
  assert.deepEqual(model.formatDimensions(deck), { width: 1080, height: 1440 });
  assert.ok(model.parseLibrary(agent.editableDeckPackage(deck)));
  const [cover, media, list, follow, reaction, reactions, three, wideStart, wideEnd] = deck.pages.map(page => page.canvas);
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
  // X's dark-mode colours at the screenshot's size, on every Reaction page.
  assert.equal(post.font, "sfpro"); assert.equal(post.color, "#E7E9EA"); near(post.fontSize, shot(57.9));
  assert.equal(bySlot(reaction, "reaction-avatar").src, avatar); assert.equal(bySlot(reaction, "reaction-handle").text, "@ada");
  assert.equal(bySlot(reaction, "reaction-handle").color, "#71767B"); assert.equal(bySlot(reaction, "reaction-name").fontWeight, 700); assert.equal(bySlot(reaction, "reaction-name").color, "#E7E9EA");
  assert.equal(bySlot(reactions, "reaction-text-2").text, "Second"); assert.equal(bySlot(reactions, "reaction-avatar-2").src, avatar);
  assert.equal(bySlot(three, "reaction-text-3").text, "Third"); assert.equal(bySlot(three, "reaction-name-3").text, "Alan");
  for (const canvas of [reaction, reactions, three]) assert.equal(bySlot(canvas, "source"), undefined, "no source line under posts from X");
  for (const canvas of [reactions, three]) near(bySlot(canvas, "reaction-text").fontSize, post.fontSize, "every card uses X's own size");
  // Unfilled slots keep the template's sample copy.
  assert.equal(bySlot(reactions, "reaction-handle").text, "@handle");
  // The template itself is untouched by the copy.
  assert.equal(bySlot(template.pages[3].canvas, "cta").text, "TO STAY ON THE SAFE SIDE");
  // Fixed layers refuse copy; the cover photo also takes the slide-level image.
  assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ slots: { "Swipe for more": "TAP" } }, {}, {}, {}, {}, {}, {}, {}, {}] }), error => error instanceof agent.AgentDeckValidationError);
  // The post cards, check marks and X marks are brand layers, not slots.
  for (const name of ["Post card", "X logo", "X.com", "Verified badge"]) assert.throws(() => agent.createAgentDeck({ name: "Bad", templateId: "chatgptricks-3x4", slides: [{ templatePage: 4, slots: { [name]: "x" } }] }), error => error instanceof agent.AgentDeckValidationError, name);
  const imaged = agent.createAgentDeck({ name: "Image", templateId: "chatgptricks-3x4", slides: [{ title: "A NEW COVER", image: { src: photo, alt: "A phone" } }, {}, {}, {}, {}, {}, {}, {}, {}] });
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

test("reaction pages share the Text + Media title, have no source line, and draw cards like X", () => {
  const mediaTitle = layer(1, "media-title");
  for (const [pageIndex, key, cards] of CARDS) {
    const title = layer(pageIndex, `${key}-title`);
    for (const property of ["x", "y", "width", "fontSize", "fontWeight", "color", "lineHeight", "letterSpacing", "font"]) assert.equal(title[property], mediaTitle[property], `${key} title ${property}`);
    assert.equal(title.smartText.maxHeight, title.smartText.baseHeight, "a one-line title");
    // The cards show whose posts they are, so there's no source line (Ivan's call) and the cards may reach the bottom margin.
    assert.equal(layer(pageIndex, `${key}-source`), undefined, `${key} has no source line`);
    assert.deepEqual(title.smartCenter, { top: scene(90), bottom: scene(1352) }, "title and cards are centred together between the margins");
    for (let n = 1; n <= cards; n++) {
      const suffix = suffixOf(n), card = layer(pageIndex, `${key}-card${suffix}`);
      near(card.x, scene(72)); near(card.width, scene(936)); assert.equal(card.fill, "#000000");
      // Slightly rounded, with a thin grey line inside the edge, so the card stands out from the page and keeps the 72 px margins.
      near(card.radius, scene(24)); assert.equal(card.stroke, "#2F3336"); near(card.strokeWidth, scene(3)); assert.equal(card.strokeAlign, "inside");
      // The first card sits 64 px under the title, the others 40 px apart; each ends its padding plus X's own foot under its photo, or its text.
      assert.deepEqual(card.smartFlow, { after: n === 1 ? "title" : `reaction-card${suffixOf(n - 1)}`, gap: scene(n === 1 ? 64 : 40), bottom: scene(1352), hug: { after: `reaction-media${suffix}`, gap: scene(model.X_CARD.foot) } });
      assert.equal(model.isSafeVectorPath(layer(pageIndex, `${key}-x-mark${suffix}`).path), true);
    }
  }
  // Inside a card, everything sits where Ivan's screenshots put it, inside 24 px of padding, following the card's top edge.
  const card = layer(4, "reaction-card"), avatar = layer(4, "reaction-avatar"), name = layer(4, "reaction-name"), badge = layer(4, "reaction-badge"), handle = layer(4, "reaction-handle");
  const mark = layer(4, "reaction-x-mark"), com = layer(4, "reaction-x-com"), text = layer(4, "reaction-text"), photo = layer(4, "reaction-media");
  near(model.X_CARD.pad, 24); near(model.X_CARD.foot, 24 + 33.5 * 888 / 1206, "the foot is padding too");
  near(avatar.x - card.x, inCard(27)); near(avatar.y - card.y, inCard(37)); near(name.x - card.x, inCard(194)); near(handle.x, name.x); near(mark.x - card.x, inCard(969));
  near(text.x, avatar.x); near(text.x + text.width, card.x + card.width - inCard(27)); near(text.y - card.y, scene(model.X_CARD.textTop));
  near(text.fontSize, shot(57.9)); near(text.fontSize * text.lineHeight, shot(73.3)); assert.equal(text.color, "#E7E9EA"); assert.equal(handle.color, "#71767B"); assert.equal(name.fontWeight, 700);
  for (const part of [avatar, name, handle, mark, com, text]) { assert.equal(part.smartFlow.after, "reaction-card", part.id); assert.equal(part.smartFlow.edge, "top", part.id); near(part.smartFlow.gap, part.y - card.y, part.id); }
  // The check mark follows the name's last letter; Recreate colours it per account or hides it.
  assert.deepEqual({ ...badge.smartFlow, gap: 0 }, { after: "reaction-name", gap: 0, bottom: scene(1440), direction: "right" }); near(badge.smartFlow.gap, shot(11));
  assert.equal(badge.templateRole, "brand"); assert.equal(badge.fillRule, "evenodd"); assert.equal(model.isSafeVectorPath(badge.path), true);
  for (const look of Object.values(model.X_BADGES)) assert.equal(model.isSafeVectorPath(look.path), true);
  // The post's photo sits under the text, as wide as the text, with X's rounded corners.
  near(photo.x, text.x); near(photo.width, text.width); near(photo.radius, shot(48));
  assert.deepEqual({ ...photo.smartFlow, gap: 0 }, { after: "reaction-text", gap: 0, bottom: scene(1440) }); near(photo.smartFlow.gap, shot(31));
  // Text room per card: 16 lines alone, 9 beside one more card, 3 beside two more.
  const lines = (pageIndex, slot) => { const element = bySlot(template.pages[pageIndex].canvas, slot); return Math.floor(element.smartText.maxHeight / (element.fontSize * element.lineHeight)); };
  assert.equal(lines(4, "reaction-text"), 16);
  assert.deepEqual(["", "-2"].map(suffix => lines(5, `reaction-text${suffix}`)), [9, 9]);
  assert.deepEqual(["", "-2", "-3"].map(suffix => lines(6, `reaction-text${suffix}`)), [3, 3, 3]);
});

test("every post card has a hidden play button and length badge that ride on its photo", () => {
  for (const [index, cards] of [[4, [""]], [5, ["", "-2"]], [6, ["", "-2", "-3"]]]) {
    const canvas = template.pages[index].canvas, order = canvas.elements.map(element => element.slot);
    for (const suffix of cards) {
      const media = bySlot(canvas, `reaction-media${suffix}`), play = bySlot(canvas, `reaction-play${suffix}`), length = bySlot(canvas, `reaction-length${suffix}`), label = bySlot(canvas, `reaction-length-text${suffix}`);
      for (const layer of [play, length, label]) {
        assert.equal(layer.hidden, true, `${layer.slot} waits for a video`); assert.equal(layer.templateRole, "brand");
        assert.deepEqual([layer.smartFlow.after, layer.smartFlow.edge], [`reaction-media${suffix}`, "top"], `${layer.slot} follows the photo's top`);
        assert.ok(order.indexOf(layer.slot) > order.indexOf(`reaction-media${suffix}`), `${layer.slot} is drawn over the photo`);
      }
      close(play.x + play.width / 2, media.x + media.width / 2); close(play.y + play.height / 2, media.y + media.height / 2);
      close(play.y - media.y, play.smartFlow.gap); close(length.y - media.y, length.smartFlow.gap);
      close(length.x, media.x + scene(model.X_CARD.length.inset)); close(length.y + length.height, media.y + media.height - scene(model.X_CARD.length.inset));
      assert.deepEqual([label.x, label.y, label.width, label.height], [length.x, length.y, length.width, length.height]);
      assert.equal(play.src, model.X_PLAY_BUTTON); assert.deepEqual([label.align, label.verticalAlign, label.text], ["center", "middle", "0:45"]);
    }
  }
  assert.ok(model.isSafeBrandSvgUrl(model.X_PLAY_BUTTON));
});

test("smart layout: each card hugs its post, photo and check mark, and the page centres them", () => {
  const measure = (element, words = smart.smartWords(element)) => ({ size: element.fontSize, widths: words.map(word => word.text.length * element.fontSize * .45), space: element.fontSize * .25 });
  const fill = (pageIndex, slots, change) => {
    const canvas = structuredClone(template.pages[pageIndex].canvas);
    for (const [slot, text] of Object.entries(slots)) { const element = bySlot(canvas, slot); element.text = text; delete element.richText; }
    change?.(canvas);
    return smart.layoutSmartScene(canvas, measure);
  };
  const line = shot(73.3), textTop = scene(model.X_CARD.textTop), foot = scene(model.X_CARD.foot);
  // One short post: the card ends its foot under its text, and title and card sit in the middle of 90 to 1352.
  const one = fill(4, { "reaction-text": "Short post" });
  const title = bySlot(one.scene, "title"), card = bySlot(one.scene, "reaction-card"), text = bySlot(one.scene, "reaction-text");
  close(text.height, line); close(text.y - card.y, textTop); close(card.y + card.height, text.y + text.height + foot);
  close(card.y - (title.y + title.height), scene(64));
  close(title.y - scene(90), scene(1352) - (card.y + card.height), "centred between the margins");
  assert.ok(title.y > scene(90) + 1, "a short page moves down");
  // The check mark sits just after the name's last letter, centred on its line.
  const name = bySlot(one.scene, "reaction-name"), badge = bySlot(one.scene, "reaction-badge"), named = one.texts.get(name.id);
  close(badge.x, name.x + named.lines.at(-1).width + shot(11)); close(badge.y + badge.height / 2, name.y + name.height / 2);
  // With its photo shown, the photo sits under the text and the card ends its foot under the photo.
  const pictured = fill(4, { "reaction-text": "Look at this" }, canvas => { const photo = bySlot(canvas, "reaction-media"); photo.hidden = false; photo.height = scene(400); });
  const photo = bySlot(pictured.scene, "reaction-media"), captioned = bySlot(pictured.scene, "reaction-text"), framed = bySlot(pictured.scene, "reaction-card");
  close(photo.y, captioned.y + captioned.height + shot(31)); close(framed.y + framed.height, photo.y + photo.height + foot);
  // Three short posts: three cards 40 px apart, each as tall as its post.
  const three = fill(6, { "reaction-text": "One", "reaction-text-2": "Two", "reaction-text-3": "Three" });
  const cards = ["", "-2", "-3"].map(suffix => bySlot(three.scene, `reaction-card${suffix}`)), texts = ["", "-2", "-3"].map(suffix => bySlot(three.scene, `reaction-text${suffix}`));
  for (const index of [0, 1, 2]) { close(texts[index].y - cards[index].y, textTop); close(cards[index].y + cards[index].height, texts[index].y + texts[index].height + foot); }
  close(cards[1].y - (cards[0].y + cards[0].height), scene(40)); close(cards[2].y - (cards[1].y + cards[1].height), scene(40));
  close(bySlot(three.scene, "title").y - scene(90), scene(1352) - (cards[2].y + cards[2].height), "the three cards are centred too");
  // A post too long for its page shrinks rather than leave the page.
  const full = fill(4, { "reaction-text": "word ".repeat(200).trim() });
  const long = bySlot(full.scene, "reaction-text"), longCard = bySlot(full.scene, "reaction-card");
  assert.ok(full.texts.get(long.id).fontSize < long.fontSize, "a long post shrinks");
  assert.ok(longCard.y + longCard.height <= scene(1352) + .02, "and its card stays above the bottom margin");
  // A blank line between paragraphs is kept.
  const paragraphs = fill(4, { "reaction-text": "Line one\n\nLine three" });
  assert.equal(paragraphs.texts.get(bySlot(paragraphs.scene, "reaction-text").id).lines.length, 3);
});
