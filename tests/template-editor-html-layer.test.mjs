/* Run: node --test tests/template-editor-html-layer.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireModule = createRequire(import.meta.url), cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const unit = { exports: {} };
  cache.set(filename, unit);
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(name => {
    if (name.endsWith(".css")) return {};
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (resolved) return load(path.relative(root, resolved));
    }
    return requireModule(name);
  }, unit, unit.exports);
  return unit.exports;
}

const model = load("lib/template-editor/model.ts");
const layer = load("lib/template-editor/html-layer.ts");
const agent = load("lib/template-editor/agent-decks.ts");
const { needsPdfRaster } = load("lib/template-editor/pdf-options.ts");
const { builtInBrandGuide } = load("lib/template-editor/brand-guide-seed.ts");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const ASSET = `/api/template-editor/assets/${"a".repeat(64)}`;
const htmlElement = (extra = {}) => ({ ...model.createCanvasElement("html"), id: "chart", html: '<div class="card">Hi</div>', ...extra });
const scene = elements => ({ background: "#0b1014", elements });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const invalid = (fn, pathPart) => assert.throws(fn, error => error instanceof agent.AgentDeckValidationError && (!pathPart || error.issues.some(issue => issue.path.includes(pathPart))));
const brandTokens = () => layer.htmlTokensForGuide(builtInBrandGuide("chatgptricks"));
/** Every rule's selectors start at the layer's root. */
const scopedRules = (css, scope) => {
  for (const selectors of css.match(/[^{}]+(?=\{)/g) ?? []) {
    for (const selector of selectors.split(",")) assert.match(selector.trim(), new RegExp(`^\\.${scope}(?![\\w-])`), `unscoped selector: ${selector}`);
  }
};

test("HTML layers are validated like every other layer", () => {
  const element = htmlElement({ css: ".card { color: red }", tokens: { "--color-accent": "#00D98A" } });
  assert.equal(element.name, "HTML");
  const parsed = model.parseCanvasScene(scene([element]));
  assert.equal(parsed.elements[0].type, "html");
  assert.equal(parsed.elements[0].html, element.html);
  assert.equal(parsed.elements[0].css, ".card { color: red }");
  assert.equal(parsed.elements[0].designWidth, element.designWidth);
  assert.deepEqual(parsed.elements[0].tokens, { "--color-accent": "#00D98A" });
  for (const bad of [
    { html: 42 },
    { html: "x".repeat(model.MAX_HTML_CHARS + 1) },
    { css: "x".repeat(model.MAX_HTML_CSS_CHARS + 1) },
    { designWidth: 0 },
    { designWidth: model.MAX_HTML_DESIGN_WIDTH + 1 },
    { tokens: { "--bg": "url(https://evil.example/x.png)" } },
    { tokens: { "--bg": "image-set('x.png' 1x)" } },
    { tokens: { color: "red" } },
    { tokens: { "--x": "red; background: blue" } },
    { tokens: Object.fromEntries(Array.from({ length: model.MAX_HTML_TOKENS + 1 }, (_, index) => [`--t${index}`, "1px"])) },
  ]) assert.equal(model.parseCanvasScene(scene([htmlElement(bad)])), null, JSON.stringify(bad).slice(0, 80));
  assert.equal(model.htmlLayerText("<style>.a { color: red }</style><h1>Jobs &amp; AI</h1><script>x()</script><p>since&nbsp;2022</p>"), "Jobs & AI since 2022");
});

test("an HTML layer reads as its words, a role=img element as its label and an image as its alt text", () => {
  const chart = '<div class="chart" role="img" aria-label="Job openings fell 29% &amp; stocks rose 96%"><p class="legend">US job openings</p><svg viewBox="0 0 10 10"><g><text>12M</text></g><text>8,000</text></svg></div><p>Source: FRED</p>';
  assert.equal(model.htmlLayerText(chart), "Job openings fell 29% & stocks rose 96% Source: FRED");
  assert.equal(model.htmlLayerText('<div role="img" aria-label="Outer"><div><div>inner</div></div></div><p>after</p>'), "Outer after", "nested tags of the same name end where the labelled one does");
  assert.equal(model.htmlLayerText('<svg role="img" aria-label="OpenAI logo"><path d="M0 0"/></svg><p>OpenAI</p>'), "OpenAI logo OpenAI");
  assert.equal(model.htmlLayerText('<div role="img"><p>no label, so its words</p></div>'), "no label, so its words");
  assert.equal(model.htmlLayerText(`<img src="${PNG}" alt="A cat"><p>caption</p>`), "A cat caption");
  const element = htmlElement({ html: layer.cleanHtmlLayer({ html: chart }).html });
  const deck = { ...model.createBlankDesign("Chart", "portrait") };
  deck.pages[0].canvas = scene([element]);
  const items = load("lib/template-editor/public-accessibility.ts").pageReadingItems(deck, deck.pages[0]);
  assert.deepEqual(items.map(item => item.text), ["Job openings fell 29% & stocks rose 96% Source: FRED"], "the label survives cleaning and is what the slide reads");
});

test("cleaning removes scripts, handlers, frames, forms, links and anything from outside Engine", () => {
  const dirty = `
    <script>alert(1)</script><noscript><img src="https://evil.example/n.png"></noscript>
    <div class="card" onclick="alert(2)" onmouseover="alert(3)" style="color: red; background: url(https://evil.example/a.png)">Card</div>
    <iframe src="https://evil.example"></iframe><object data="https://evil.example/x"></object><embed src="https://evil.example/y">
    <form action="https://evil.example"><input name="q" value="secret"><button formaction="https://evil.example">Follow</button></form>
    <a href="https://evil.example" target="_blank">Read more</a><a href="javascript:alert(4)">Tap</a>
    <img src="https://evil.example/track.png" alt="tracker"><img src="//evil.example/p.png" alt="relative"><img src="${PNG}" alt="dot"><img src="${ASSET}" alt="asset">
    <svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#00D98A"/></linearGradient></defs>
      <rect width="10" height="10" fill="url(#g)"/><rect width="1" height="1" fill="url(https://evil.example/f.svg#p)"/>
      <a href="https://evil.example"><text x="1" y="5">link</text></a>
      <foreignObject><div>escaped</div></foreignObject><animate attributeName="href" to="https://evil.example"/>
      <use href="#g"/><use href="https://evil.example/s.svg#x"/><image href="https://evil.example/p.png"/><image href="${PNG}" width="1" height="1"/>
    </svg>`;
  const { html, css } = layer.cleanHtmlLayer({ html: dirty });
  assert.doesNotMatch(html, /<script|<noscript|alert|onclick|onmouseover|<iframe|<object|<embed|<form|<input|secret|formaction|evil\.example|javascript:|target=|foreignObject|escaped|<animate/i);
  assert.match(html, /Follow/, "a button's text stays");
  assert.match(html, /<span>Read more<\/span>/, "links become plain text");
  assert.match(html, /<span>Tap<\/span>/);
  assert.match(html, /style="color:\s*red;?"/, "the outside background is removed from the style attribute");
  assert.match(html, /alt="dot"/);
  assert.match(html, /alt="asset"/);
  assert.doesNotMatch(html, /alt="tracker"|alt="relative"/, "images from outside Engine are removed");
  assert.match(html, /<linearGradient id="g">/, "SVG keeps its camelCase tags");
  assert.match(html, /fill="url\(#g\)"/);
  assert.match(html, /<g><text x="1" y="5">link<\/text><\/g>/, "an SVG link becomes a group");
  assert.match(html, /<use href="#g"/);
  assert.equal((html.match(/<use/g) ?? []).length, 2);
  assert.equal((html.match(/<image/g) ?? []).length, 1, "only the data: image stays");
  assert.equal(css, "");
});

test("cleaning CSS keeps rules inside the layer and loads nothing", () => {
  const { css } = layer.cleanHtmlLayer({ html: '<div class="a">x</div>', css: `
    @import url(https://evil.example/x.css);
    @font-face { font-family: Evil; src: url(https://evil.example/f.woff2); }
    @media (min-width: 1px) { .a { color: red } }
    @keyframes spin { to { transform: rotate(1turn) } }
    .a { color: #00D98A; background-image: url(https://evil.example/bg.png); position: fixed; transition: all 1s; animation: spin 1s; cursor: pointer; overflow: auto; }
    .b { background: url(${PNG}) no-repeat; mask: url(#m); }
    .c { width: expression(alert(1)); content: "</style><script>alert(1)</script>"; }
    .d { background: image-set("https://evil.example/x.png" 1x); }
    .e { background: url("data:text/html,<script>alert(1)</script>"); }
    .f { color: blue; } /* </style><script>alert(5)</script> */
    body { margin: 0 }
  ` });
  assert.doesNotMatch(css, /@import|@font-face|@media|@keyframes|evil\.example|expression|image-set|transition|animation|cursor|data:text|<\/style|<script|alert\(5\)/i);
  assert.match(css, /color:\s*#00D98A/i);
  assert.match(css, /position:\s*absolute/, "position: fixed stays inside the layer");
  assert.match(css, /overflow:\s*hidden/);
  assert.ok(css.includes(`url(${PNG})`), "data: images stay");
  assert.match(css, /mask:\s*url\(#m\)/, "local references stay");
  assert.match(css, /\\3c \/style>/, "a closing style tag can't appear in the CSS");
  assert.match(css, /body\s*\{\s*margin:\s*0/);
});

test("<style> blocks move into the CSS and cleaning clean markup changes nothing", () => {
  const once = layer.cleanHtmlLayer({ html: "<style>.t { color: var(--color-accent) }</style><p class='t'>Hi</p>", css: ".u { color: red }" });
  assert.doesNotMatch(once.html, /<style/);
  assert.match(once.html, /<p class="t">Hi<\/p>/);
  assert.match(once.css, /\.u\s*\{\s*color:\s*red/);
  assert.match(once.css, /\.t\s*\{\s*color:\s*var\(--color-accent\)/);
  assert.deepEqual(layer.cleanHtmlLayer(once), once);
  const element = htmlElement({ html: once.html, css: once.css });
  assert.equal(layer.cleanHtmlElement(element), element, "a clean layer stays the same object");
  const library = { designs: [{ pages: [{ canvas: { elements: [htmlElement({ html: "<p onclick='x()'>Hi</p><script>1</script>" })] } }] }] };
  const cleaned = layer.cleanHtmlLayersIn(library);
  assert.notEqual(cleaned, library);
  assert.equal(cleaned.designs[0].pages[0].canvas.elements[0].html, "<p>Hi</p>");
  assert.equal(library.designs[0].pages[0].canvas.elements[0].html, "<p onclick='x()'>Hi</p><script>1</script>", "the input isn't changed");
  assert.equal(layer.cleanHtmlLayersIn(cleaned), cleaned, "nothing to clean: the same object");
});

test("a brand guide becomes CSS variables, and fonts come only from the brand", () => {
  const tokens = brandTokens();
  assert.equal(tokens["--color-background"], "#0B1014");
  assert.equal(tokens["--color-text"], "#FFFFFF");
  assert.equal(tokens["--color-accent"], "#00D98A");
  assert.equal(tokens["--color-secondary"], "#D9D9D9");
  assert.equal(tokens["--color-source"], "#7D858A");
  assert.equal(tokens["--gradient-accent"], "linear-gradient(180deg, #00D98A, #32FFBB)");
  assert.equal(tokens["--title-size"], "56px");
  assert.equal(tokens["--title-weight"], "700");
  assert.equal(tokens["--title-fill"], tokens["--gradient-accent"]);
  assert.equal(tokens["--cover-case"], "uppercase");
  assert.match(tokens["--title-font"], /^var\(--gf-f-sfpro\)/);
  assert.match(tokens["--cover-font"], /^var\(--gf-f-bebas\)/);
  assert.equal(tokens["--body-font"], layer.HTML_FONT_STACKS.sfpro);
  assert.equal(tokens["--page-width"], "1080px");
  assert.equal(tokens["--margin-left"], "72px");
  assert.ok(Object.entries(tokens).every(([name, value]) => model.isSafeHtmlToken(name, value)));
  assert.deepEqual(layer.cleanHtmlTokens({ "--a": "url(https://evil.example)", "--title-font": "Evil Sans", "--font-x": layer.HTML_FONT_STACKS.inter, "--b": "#fff" }), { "--font-x": layer.HTML_FONT_STACKS.inter, "--b": "#fff" });

  const { css } = layer.cleanHtmlLayer({
    html: "<p>x</p>", tokens,
    css: 'p { font-family: "SF Pro Display", sans-serif } h1 { font-family: Inter, "Comic Sans MS" } h2 { font: 700 40px/1 var(--cover-font) } h3 { font-family: var(--gf-f-inter) } :root { --title-font: "Comic Sans MS"; --gf-f-sfpro: Papyrus; --tile: 4px }',
  });
  assert.match(css, /p\s*\{\s*font-family:\s*var\(--gf-f-sfpro\), sans-serif/, "a brand font by name");
  assert.match(css, /h1\s*\{\s*font-family:\s*var\(--body-font\)\s*;?\s*\}/, "fonts outside the brand fall back to its body font");
  assert.match(css, /h2\s*\{\s*font:\s*700 40px\/1 var\(--cover-font\)/);
  assert.match(layer.cleanHtmlLayer({ html: "<p>x</p>", tokens, css: "p { font: 700 40px/1 Papyrus }" }).css, /font:\s*700 40px\/1 var\(--body-font\)/, "the shorthand keeps its size and weight");
  assert.match(css, /h3\s*\{\s*font-family:\s*var\(--body-font\)/, "Inter isn't one of this brand's fonts");
  assert.doesNotMatch(css, /Comic Sans|Papyrus|--title-font:|--gf-f-sfpro:/, "a layer can't redefine the brand's fonts");
  assert.match(css, /--tile:\s*4px/, "its own variables are fine");
  // Without a brand, any of Engine's fonts works.
  assert.match(layer.cleanHtmlLayer({ html: "<p>x</p>", css: "p { font-family: Inter }" }).css, /font-family:\s*var\(--gf-f-inter\)/);
});

test("a prepared layer is scoped to its own root, with its brand variables there", () => {
  const input = {
    html: '<div class="card" id="c"><p>Hi</p><svg><defs><clipPath id="clip"><rect width="1" height="1"/></clipPath></defs><g clip-path="url(#clip)"><use href="#clip"/></g></svg></div>',
    css: "body { background: var(--color-background) } .card { color: red } #c > p { margin: 0 } :root .card, html { padding: 4px } p:hover { color: blue } * { box-sizing: border-box }",
    tokens: { "--color-background": "#0B1014", "--bad": "url(https://evil.example)" },
  };
  const prepared = layer.prepareHtmlLayer(input);
  assert.equal(layer.prepareHtmlLayer({ ...input }).key, prepared.key, "the same layer gets the same key");
  assert.notEqual(layer.prepareHtmlLayer({ ...input, html: "<p>Other</p>" }).key, prepared.key);
  const css = layer.scopeHtmlLayer(prepared.css, "teh-x"), html = layer.scopeHtmlLayer(prepared.html, "teh-x");
  scopedRules(css, "teh-x");
  assert.match(css, /^\.teh-x \{ --color-background: #0B1014;/, "the brand variables sit on the root");
  assert.doesNotMatch(css, /--bad|evil/);
  assert.match(css, /\.teh-x\s*\{\s*background: var\(--color-background\)/, "body means the layer's root");
  assert.match(css, /\.teh-x \.teh-x-card\s*\{\s*color: red/);
  assert.match(css, /\.teh-x #teh-x-c > p/);
  assert.match(html, /class="teh-x-card"/);
  assert.match(html, /id="teh-x-c"/);
  assert.match(html, /<clipPath id="teh-x-clip"[ >]/);
  assert.match(html, /<p data-te-node="1">Hi<\/p>/, "drawn parts carry their numbers (html-edit.ts)");
  assert.match(html, /clip-path="url\(#teh-x-clip\)"/);
  assert.match(html, /<use href="#teh-x-clip"/);
});

test("the canvas draws an HTML layer as clean, scoped markup at its design size", async () => {
  const canvas = load("components/template-editor/canvas.tsx");
  const element = {
    ...htmlElement({ html: '<div class="card" onclick="steal()">Hello<script>alert(1)</script></div>', css: ".card > b { color: var(--color-accent) } .card { content: '&' }", tokens: { "--color-accent": "#00D98A" } }),
    x: 0, y: 0, width: 180, height: 90, designWidth: 540,
  };
  const markup = renderToStaticMarkup(React.createElement(canvas.SceneRenderer, { scene: scene([element]) }));
  assert.match(markup, /class="te-canvas-html"/);
  assert.match(markup, /<style>[^<]*--color-accent: #00D98A;/);
  const scope = markup.match(/class="te-canvas-html-root (teh-[a-zA-Z0-9-]+)"/)?.[1];
  assert.ok(scope, "the layer's root has its own scope");
  const style = markup.match(/<style>([^<]*)<\/style>/)[1];
  assert.ok(style.includes(`.${scope} .${scope}-card > b`), "selectors keep > as CSS, not &gt;");
  scopedRules(style, scope);
  assert.match(markup, /width:540px/);
  assert.match(markup, /height:270px/);
  assert.match(markup, /transform:scale\(0\.333333/);
  assert.match(markup, /Hello/);
  assert.doesNotMatch(markup, /<script|onclick|steal|alert/);

  // Side handles lay the HTML out again at the new width; corners scale it.
  const box = { ...htmlElement(), x: 0, y: 0, width: 100, height: 50, designWidth: 300, rotation: 0 };
  const side = canvas.resizeSingle(box, "e", { x: 50, y: 0 }, false);
  assert.equal(side.width, 150);
  assert.equal(side.height, 50);
  assert.equal(side.designWidth, 450);
  const corner = canvas.resizeSingle(box, "se", { x: 50, y: 25 }, false);
  assert.equal(corner.width, 150);
  assert.equal(corner.height, 75);
  assert.equal(corner.designWidth, 300);
});

test("exports: a PDF page with an HTML layer is drawn as an image", () => {
  const text = { ...model.createCanvasElement("text"), letterSpacing: 0 };
  assert.equal(needsPdfRaster([text]), false);
  assert.equal(needsPdfRaster([text, htmlElement()]), true);
});

const deckSpec = () => ({
  id: "deck", name: "HTML deck", format: "portrait",
  slides: [{ id: "s1", layout: "blank", elements: [{ type: "html", id: "card", x: 108, y: 120, width: 864, height: 400, html: "<div class='c'>Card</div><script>x()</script>", css: ".c { color: red }" }] }],
});

test("decks take HTML layers, designed at their box's size in output pixels", () => {
  const deck = agent.createAgentDeck(deckSpec());
  const card = deck.pages[0].canvas.elements[0];
  assert.equal(card.type, "html");
  assert.equal(card.designWidth, 864, "designWidth defaults to the box's width in pixels");
  near(card.width, 864 / 3);
  near(card.x, 36);
  assert.equal(card.html, '<div class="c">Card</div>');
  assert.equal(card.css, ".c { color: red }");
  const view = agent.agentDeckView(deck).slides[0].elements[0];
  near(view.width, 864);
  assert.equal(view.designWidth, 864, "the view doesn't scale designWidth");
  invalid(() => agent.createAgentDeck({ ...deckSpec(), slides: [{ id: "s1", layout: "blank", elements: [{ type: "html", x: 0, y: 0, width: 10, height: 10, html: "<script>alert(1)</script>" }] }] }), "html");
  invalid(() => agent.createAgentDeck({ ...deckSpec(), slides: [{ id: "s1", layout: "blank", elements: [{ type: "html", x: 0, y: 0, width: 10, height: 10, html: "<p>x</p>", designWidth: 0 }] }] }), "designWidth");
  invalid(() => agent.createAgentDeck({ ...deckSpec(), slides: [{ id: "s1", layout: "blank", elements: [{ type: "text", text: "x", x: 0, y: 0, width: 10, height: 10, tokens: {} }] }] }), "tokens");
});

test("add_html, replace_html and update_element edit HTML layers like other layers", () => {
  const deck = agent.createAgentDeck(deckSpec());
  const card = deck.pages[0].canvas.elements[0];
  let next = agent.updateAgentDeck(deck, { operations: [{ op: "add_html", pageId: "s1", id: "chart", name: "Chart", html: "<svg viewBox='0 0 10 10'><rect width='10' height='10'/></svg>" }] });
  const chart = next.pages[0].canvas.elements.at(-1);
  assert.equal(chart.id, "chart");
  assert.equal(chart.name, "Chart");
  assert.deepEqual([chart.x, chart.y], [0, 0]);
  near(chart.width, 360);
  near(chart.height, 480);
  assert.equal(chart.designWidth, 1080, "the box defaults to the whole slide");

  next = agent.updateAgentDeck(next, { operations: [{ op: "add_html", pageId: "s1", id: "backdrop", html: "<div>Backdrop</div>", x: 0, y: 1000, width: 540, height: 440, designWidth: 1080, index: 0 }] });
  const backdrop = next.pages[0].canvas.elements[0];
  assert.equal(backdrop.id, "backdrop", "index 0 is the bottom of the stack");
  assert.equal(backdrop.designWidth, 1080);
  near(backdrop.width, 180);

  next = agent.updateAgentDeck(next, { operations: [{ op: "replace_html", pageId: "s1", elementId: "card", html: "<div class='c'>New <b onclick='x()'>words</b></div>" }] });
  let replaced = next.pages[0].canvas.elements.find(element => element.id === "card");
  assert.equal(replaced.html, '<div class="c">New <b>words</b></div>');
  assert.equal(replaced.css, card.css, "without css the layer keeps its CSS");
  assert.deepEqual([replaced.x, replaced.y, replaced.width, replaced.height, replaced.designWidth], [card.x, card.y, card.width, card.height, card.designWidth]);
  next = agent.updateAgentDeck(next, { operations: [{ op: "replace_html", pageId: "s1", elementId: "card", html: "<style>.c { color: blue }</style><div class='c'>Blue</div>" }] });
  replaced = next.pages[0].canvas.elements.find(element => element.id === "card");
  assert.match(replaced.css, /blue/);
  assert.doesNotMatch(replaced.css, /red/, "a page with its own <style> replaces the CSS");
  next = agent.updateAgentDeck(next, { operations: [{ op: "replace_html", pageId: "s1", elementId: "card", html: "<div class='c'>Green</div>", css: ".c { color: green }" }] });
  assert.equal(next.pages[0].canvas.elements.find(element => element.id === "card").css, ".c { color: green }");

  next = agent.updateAgentDeck(next, { operations: [{ op: "update_element", pageId: "s1", elementId: "card", properties: { width: 432, designWidth: 432, css: ".c { color: green; behavior: url(x.htc) }", rotation: 5 } }] });
  const updated = next.pages[0].canvas.elements.find(element => element.id === "card");
  near(updated.width, 144);
  assert.equal(updated.designWidth, 432);
  assert.equal(updated.rotation, 5);
  assert.equal(updated.css, ".c { color: green }", "update_element cleans CSS too");

  next = agent.updateAgentDeck(next, { operations: [{ op: "remove_element", pageId: "s1", elementId: "chart" }] });
  assert.ok(!next.pages[0].canvas.elements.some(element => element.id === "chart"));

  invalid(() => agent.updateAgentDeck(next, { operations: [{ op: "add_html", pageId: "s1", html: "<iframe src='https://evil.example'></iframe>" }] }), "html");
  invalid(() => agent.updateAgentDeck(next, { operations: [{ op: "add_html", pageId: "missing", html: "<p>x</p>" }] }), "pageId");
  invalid(() => agent.updateAgentDeck(next, { operations: [{ op: "replace_html", pageId: "s1", elementId: "nope", html: "<p>x</p>" }] }), "elementId");
  invalid(() => agent.updateAgentDeck(next, { operations: [{ op: "update_element", pageId: "s1", elementId: "card", properties: { text: "x" } }] }), "text");
  const withText = agent.updateAgentDeck(next, { operations: [{ op: "add_element", pageId: "s1", element: { type: "text", id: "words", text: "Words", x: 0, y: 0, width: 100, height: 40 } }] });
  invalid(() => agent.updateAgentDeck(withText, { operations: [{ op: "replace_html", pageId: "s1", elementId: "words", html: "<p>x</p>" }] }), "elementId");
  const protectedDeck = structuredClone(next);
  protectedDeck.pages[0].canvas.elements.find(element => element.id === "card").protected = ["content"];
  invalid(() => agent.updateAgentDeck(protectedDeck, { operations: [{ op: "replace_html", pageId: "s1", elementId: "card", html: "<p>x</p>" }] }));
  invalid(() => agent.updateAgentDeck(protectedDeck, { operations: [{ op: "update_element", pageId: "s1", elementId: "card", properties: { css: "p { color: red }" } }] }), "css");
  agent.updateAgentDeck(protectedDeck, { operations: [{ op: "update_element", pageId: "s1", elementId: "card", properties: { x: 10 } }] });
});

test("add_html replaces puts HTML in a template's photo frame, and the copy stays at the top", () => {
  const smart = load("lib/template-editor/smart-text.ts");
  const metrics = (element, words = smart.smartWords(element)) => ({ size: 20, widths: words.map(word => word.text.length * 10), space: 5 });
  const laidOut = scene => smart.layoutSmartScene(scene, metrics).scene.elements;
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-3, `${label}: ${actual} != ${expected}`);
  const template = model.BUILT_IN_TEMPLATES.find(item => item.id === "chatgptricks-3x4");
  const templatePage = template.pages.findIndex(page => page.canvas?.elements.some(element => element.slot === "media" && element.smartFlow?.media));
  assert.ok(templatePage >= 0, "the template has a Text + Media page");
  const deck = agent.createAgentDeck({ name: "AI vs Jobs", templateId: "chatgptricks-3x4", slides: [{ templatePage }] });
  const page = deck.pages[0], frame = page.canvas.elements.find(element => element.slot === "media");
  const slot = (elements, name) => elements.find(element => element.slot === name);
  const top = slot(page.canvas.elements, "title").smartText.anchorTop;

  // Hiding the frame by hand empties its space, and the page centres its copy there.
  const hidden = agent.updateAgentDeck(deck, { operations: [{ op: "update_element", pageId: page.id, elementId: frame.id, properties: { hidden: true } }] });
  assert.ok(slot(laidOut(hidden.pages[0].canvas), "title").y > top + 10, "an empty frame moves the copy down");

  const html = "<svg viewBox='0 0 936 919'><rect width='936' height='919'/></svg>";
  const next = agent.updateAgentDeck(deck, { operations: [{ op: "add_html", pageId: page.id, id: "jobs-chart", name: "Jobs chart", replaces: frame.id, html }] });
  const elements = next.pages[0].canvas.elements, chart = elements.find(element => element.id === "jobs-chart");
  const frameIndex = elements.findIndex(element => element.id === frame.id);
  assert.equal(elements[frameIndex].hidden, true, "the frame is hidden");
  assert.equal(elements.indexOf(chart), frameIndex + 1, "the layer goes just above the frame");
  for (const key of ["x", "y", "width", "height"]) close(chart[key], frame[key], key);
  close(chart.designWidth, 936, "designed at the frame's width in output pixels");
  const { media, ...flow } = frame.smartFlow;
  assert.ok(media, "the frame takes its picture's shape");
  assert.deepEqual(chart.smartFlow, { ...flow, resize: true }, "the layer follows the copy and fills the frame's space");
  assert.equal(chart.layoutRole, "media");
  if (page.readingOrder) assert.equal(next.pages[0].readingOrder.indexOf("jobs-chart"), next.pages[0].readingOrder.indexOf(frame.id) + 1);

  const drawn = laidOut(next.pages[0].canvas), body = slot(drawn, "body"), placed = drawn.find(element => element.id === "jobs-chart");
  close(slot(drawn, "title").y, top, "the title stays at the top");
  close(placed.y, body.y + body.height + flow.gap, "the layer sits under the body");
  close(placed.y + placed.height, flow.bottom, "and runs to the foot of the space");

  // Layers that followed the frame follow the HTML layer, and an explicit box wins.
  const followed = structuredClone(deck);
  followed.pages[0].canvas.elements.push({ ...model.createCanvasElement("text", { text: "Caption", x: 24, y: 400, width: 312, height: 20 }), id: "caption", smartFlow: { after: frame.slot, gap: 8, bottom: 470 } });
  const moved = agent.updateAgentDeck(followed, { operations: [{ op: "add_html", pageId: page.id, id: "wide", replaces: frame.id, x: 0, width: 1080, html }] });
  assert.equal(moved.pages[0].canvas.elements.find(element => element.id === "caption").smartFlow.after, "wide");
  const wide = moved.pages[0].canvas.elements.find(element => element.id === "wide");
  assert.deepEqual([wide.x, wide.width, wide.designWidth], [0, 360, 1080]);

  invalid(() => agent.updateAgentDeck(deck, { operations: [{ op: "add_html", pageId: page.id, replaces: "nope", html }] }), "replaces");
  const locked = structuredClone(deck);
  locked.pages[0].canvas.elements.find(element => element.id === frame.id).locked = true;
  invalid(() => agent.updateAgentDeck(locked, { operations: [{ op: "add_html", pageId: page.id, replaces: frame.id, html }] }), "replaces");
  assert.match(agent.agentCapabilities().htmlLayers.templates, /replaces/);
});

test("Engine gives HTML layers the brand's variables, whatever the agent sent", () => {
  const tokens = brandTokens();
  const operations = [
    { op: "add_html", pageId: "s1", html: "<p>x</p>", tokens: { "--color-accent": "#FF0000" } },
    { op: "add_slide", slide: { id: "s2", layout: "blank", elements: [{ type: "html", x: 0, y: 0, width: 100, height: 100, html: "<p>y</p>" }] } },
    { op: "rename", name: "Renamed" },
  ];
  assert.equal(agent.addsHtmlLayers(operations), true);
  assert.equal(agent.addsHtmlLayers([{ op: "rename", name: "x" }, { op: "update_element", pageId: "s1", elementId: "a", properties: { text: "html" } }]), false);
  assert.equal(agent.addsHtmlLayers(deckSpec()), true);
  assert.equal(agent.withHtmlLayerTokens(operations, undefined)[0].tokens, undefined, "without a brand guide there are none");
  const unrelated = [{ op: "rename", name: "x" }];
  assert.equal(agent.withHtmlLayerTokens(unrelated, tokens), unrelated);
  const branded = agent.withHtmlLayerTokens(operations, tokens);
  assert.equal(operations[0].tokens["--color-accent"], "#FF0000", "the input isn't changed");
  assert.equal(branded[0].tokens["--color-accent"], "#00D98A");
  assert.equal(branded[1].slide.elements[0].tokens["--title-size"], "56px");
  assert.equal(branded[2].tokens, undefined);
  const deck = agent.updateAgentDeck(agent.createAgentDeck(deckSpec()), { operations: branded });
  assert.equal(deck.pages[0].canvas.elements.at(-1).tokens["--color-accent"], "#00D98A");
  assert.equal(deck.pages[1].canvas.elements[0].tokens["--cover-case"], "uppercase");
  const created = agent.createAgentDeck(agent.withHtmlLayerTokens(deckSpec(), tokens));
  assert.equal(created.pages[0].canvas.elements[0].tokens["--color-background"], "#0B1014");
});

test("the agent API and the chat describe HTML layers", () => {
  const capabilities = agent.agentCapabilities();
  assert.ok(capabilities.editable.includes("html"));
  assert.match(capabilities.htmlLayers.use, /charts/);
  assert.match(capabilities.htmlLayers.brand, /--color-accent/);
  const operations = capabilities.updateSchema.properties.operations.items.oneOf.map(item => item.properties.op.const);
  assert.ok(operations.includes("add_html") && operations.includes("replace_html"));
  const chat = load("lib/engine/assistant/chat-edits.ts");
  const chatOperations = chat.chatEditsSchema().items.oneOf.map(item => item.properties.op.const);
  assert.ok(chatOperations.includes("add_html") && chatOperations.includes("replace_html") && chatOperations.includes("style_words"));
  const edited = chat.applyChatEdits(agent.createAgentDeck(deckSpec()), [{ op: "add_html", pageId: "s1", html: "<p>Chart</p>" }]);
  assert.equal(edited.pages[0].canvas.elements.at(-1).html, "<p>Chart</p>");
  const { SYSTEM_PROMPT } = load("lib/engine/assistant/agent.ts");
  assert.match(SYSTEM_PROMPT, /add_html/);
  assert.match(SYSTEM_PROMPT, /charts, tables, comparisons, logo grids, memes, X post cards, or a whole slide/);
});
