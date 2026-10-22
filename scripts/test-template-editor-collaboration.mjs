/** Strict acceptance against the actual Next application in an isolated dev server.
 * Start the server with ENGINE_DEV_STORAGE_DIR pointing at a disposable directory,
 * Supabase disabled, then run this script. No mocked editor or browser is used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { chromium, request } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const origin = new URL(process.env.ENGINE_COLLABORATION_BASE_URL || "http://127.0.0.1:3121");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "This acceptance test only runs against a disposable loopback server.");
assert.equal(origin.protocol, "http:", "Use the isolated local development server.");
const installed = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
  : process.platform === "win32"
    ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean).map(directory => path.join(directory, "Google/Chrome/Application/chrome.exe"))
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const executablePath = process.env.ENGINE_BROWSER_PATH || [chromium.executablePath(), ...installed].find(filename => filename && fs.existsSync(filename));
assert.ok(executablePath && fs.existsSync(executablePath), "Live collaboration acceptance requires a real Chrome/Chromium browser; install Playwright Chromium or set ENGINE_BROWSER_PATH. This test cannot be skipped.");
const artifacts = process.env.ENGINE_COLLABORATION_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "engine-live-collaboration-"));
fs.mkdirSync(artifacts, { recursive: true });

// Use the production model only to construct valid fixture documents. All edits
// below are made through real app controls in separate browser contexts.
const unit = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(root, "lib/template-editor/model.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInThisContext(`(function(module, exports) { ${source}\n})`)(unit, unit.exports);
const model = unit.exports;
function fixture(kind) {
  const design = kind === "template" ? model.createBlankTemplateDesign(`Live acceptance template ${randomUUID()}`, "portrait") : model.createBlankDesign(`Live acceptance post ${randomUUID()}`, "portrait");
  const text = model.createCanvasElement("text", { name: "Shared heading", text: "Shared text", x: 35, y: 40, width: 280, height: 100, fontSize: 22 });
  const shape = model.createCanvasElement("shape", { name: "Shared shape", x: 80, y: 220, width: 150, height: 110, fill: "#224466" });
  design.pages[0].canvas.elements = [text, shape];
  return { kind, design, textId: text.id, shapeId: shape.id };
}
const documents = [fixture("post"), fixture("template")];
const api = await request.newContext({ baseURL: origin.origin });
let browser;
const contexts = [];
const browserErrors = [];
const blockedNetwork = [];

async function json(response) {
  const value = await response.json();
  assert.ok(response.ok(), `HTTP ${response.status()}: ${JSON.stringify(value)}`);
  return value;
}
async function waitFor(check, message, timeout = 20_000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { if (await check()) return; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${message}${last ? ` (${last.message})` : ""}`);
}
async function within(promise, delay, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), delay); })]); }
  finally { clearTimeout(timer); }
}
function canvas(page) { return page.getByRole("region", { name: "Design canvas", exact: true }); }
function renderedText(page, id) { return canvas(page).locator(`[data-element-id="${id}"] .te-canvas-text`); }
async function select(page, id) {
  await canvas(page).locator(`[data-layer-id="${id}"]`).click();
  await page.getByRole("complementary", { name: "Element properties", exact: true }).waitFor({ state: "visible" });
}
function textInput(page) { return page.locator(".te-element-inspector textarea").first(); }
async function changeText(page, id, value) {
  await select(page, id);
  await textInput(page).fill(value);
  await textInput(page).press("Tab");
}
async function changeFill(page, id, value) {
  await select(page, id);
  await page.getByRole("textbox", { name: "Fill hex", exact: true }).fill(value);
  await page.getByRole("textbox", { name: "Fill hex", exact: true }).press("Tab");
}
async function allText(pages, id, expected) {
  await Promise.all(pages.map(async page => waitFor(async () => (await renderedText(page, id).innerText()) === expected, `Remote canvas did not display ${JSON.stringify(expected)}`)));
}
async function allFill(pages, id, expected) {
  await Promise.all(pages.map(async page => waitFor(async () => (await canvas(page).locator(`[data-element-id="${id}"] svg.te-canvas-vector > rect`).first().getAttribute("fill"))?.toLowerCase() === expected, `Remote shape did not display ${expected}`)));
}
function holdUpdates(page) {
  let release;
  let seen;
  const gate = new Promise(resolve => { release = resolve; });
  const firstUpdate = new Promise(resolve => { seen = resolve; });
  const matcher = "**/api/template-editor/collaboration";
  const inFlight = new Set();
  const handler = async route => {
    const work = (async () => {
      const req = route.request();
      if (req.method() === "POST" && req.postDataJSON()?.update) { seen(); await gate; }
      await route.continue();
    })();
    inFlight.add(work);
    try { await work; } finally { inFlight.delete(work); }
  };
  // Removing a route while an awaited handler is still pending can make
  // Playwright continue it twice. Drain the genuine requests before removal.
  const cleanup = async () => { release(); await Promise.all([...inFlight]); await page.unroute(matcher, handler); };
  blockedNetwork.push(cleanup);
  return page.route(matcher, handler).then(() => ({ firstUpdate, release, cleanup }));
}

try {
  const initial = await json(await api.get("/api/template-editor"));
  assert.equal(initial.storage, "local", "The acceptance server must use disposable local storage, with Supabase disabled.");
  const saved = await json(await api.put("/api/template-editor", { data: { clientSchema: 3, expectedScope: initial.scope, revision: initial.revision, operationId: randomUUID(), library: { ...initial.library, designs: [...initial.library.designs, ...documents.map(item => item.design)] } } }));
  assert.equal(saved.scope, initial.scope);
  browser = await chromium.launch({ headless: true, executablePath });
  console.info(`Live collaboration acceptance: Chromium ${browser.version()}, ${origin.origin}, three isolated users, artifacts ${artifacts}`);
  const people = [];
  for (const name of ["Ana", "Bruno", "Carla"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    contexts.push(context);
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", error => browserErrors.push(`${name}: ${error.message}`));
    const navigations = [];
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
    people.push({ name, page, context, navigations });
  }
  const pages = people.map(person => person.page);
  for (const item of documents) {
    console.info(`Checking ${item.kind}: ${item.design.id}`);
    await Promise.all(people.map(async ({ name, page }) => {
      await page.goto(`${origin.origin}/admin/engine?design=${item.design.id}`);
      await canvas(page).waitFor({ state: "visible" });
      const bar = page.getByRole("button", { name: "Live collaboration", exact: true });
      await bar.waitFor({ state: "visible" });
      await bar.click();
      const dialog = page.getByRole("dialog", { name: "Collaborate live", exact: true });
      const nickname = dialog.getByRole("textbox", { name: "Your collaboration name", exact: true });
      await nickname.fill(name);
      await dialog.getByRole("button", { name: "Update name", exact: true }).click();
    }));
    await Promise.all(pages.map(page => waitFor(async () => {
      const text = await page.getByRole("list", { name: "People in this document", exact: true }).innerText();
      return ["Ana", "Bruno", "Carla"].every(name => text.includes(name));
    }, "The collaboration bar must identify all three live participants")));
    await pages[0].screenshot({ path: path.join(artifacts, `${item.kind}-participants.png`), fullPage: true });
    await Promise.all(pages.map(page => page.getByRole("dialog", { name: "Collaborate live", exact: true }).getByRole("button", { name: "Close dialog", exact: true }).click()));
    await Promise.all(pages.map(page => waitFor(async () => (await page.getByRole("button", { name: "Live collaboration", exact: true }).getAttribute("class"))?.includes("is-live"), "The collaboration session must become Live")));
    const navigationBaseline = people.map(person => person.navigations.length);
    await allText(pages, item.textId, "Shared text");
    const [ana, bruno, carla] = pages;

    const textStarted = Date.now();
    await changeText(ana, item.textId, "Ana edits appear live");
    await allText(pages, item.textId, "Ana edits appear live");
    const textLatency = Date.now() - textStarted;
    assert.ok(textLatency < 5000, `Remote text took ${textLatency} ms; changes must appear live.`);
    await waitFor(async () => await canvas(bruno).locator('[data-collaboration-name="Ana"] .te-collaboration-selection').count() > 0, "Ana's current selection must be visible in Bruno's canvas");
    const hit = await canvas(ana).locator(`[data-layer-id="${item.textId}"]`).boundingBox();
    assert.ok(hit);
    await ana.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await waitFor(async () => await canvas(carla).locator('[data-collaboration-name="Ana"] .te-collaboration-cursor').count() > 0, "Ana's live cursor must be visible in Carla's canvas");
    const shapeStarted = Date.now();
    await changeFill(bruno, item.shapeId, "#ee3377");
    await allFill(pages, item.shapeId, "#ee3377");
    const shapeLatency = Date.now() - shapeStarted;
    assert.ok(shapeLatency < 5000, `Remote shape took ${shapeLatency} ms; changes must appear live.`);
    console.info(`  Live text, shapes, selections, and cursor visible in remote canvases (text ${textLatency} ms, shape ${shapeLatency} ms).`);

    // Close the prior editing group before checking independent Undo.
    await ana.getByRole("textbox", { name: item.kind === "template" ? "Template name" : "Design name", exact: true }).focus();
    await new Promise(resolve => setTimeout(resolve, 650));
    await Promise.all([changeText(ana, item.textId, "Different layers edited together"), changeFill(bruno, item.shapeId, "#11aa77")]);
    await allText(pages, item.textId, "Different layers edited together");
    await allFill(pages, item.shapeId, "#11aa77");
    await ana.getByRole("button", { name: "Undo", exact: true }).click();
    await allText(pages, item.textId, "Ana edits appear live");
    await allFill(pages, item.shapeId, "#11aa77");
    await ana.getByRole("button", { name: "Redo", exact: true }).click();
    await allText(pages, item.textId, "Different layers edited together");
    console.info("  Concurrent layer edits converge; Ana's Undo retains Bruno's work.");

    // Hold genuine outgoing HTTP updates until both users have edited the same
    // baseline. Releasing them exercises the server CRDT merge, without mocks.
    await Promise.all([select(ana, item.textId), select(bruno, item.textId)]);
    const base = "Different layers edited together";
    assert.equal(await textInput(ana).inputValue(), base);
    assert.equal(await textInput(bruno).inputValue(), base);
    const held = await Promise.all([holdUpdates(ana), holdUpdates(bruno)]);
    await Promise.all([textInput(ana).fill(`${base} ANA`), textInput(bruno).fill(`${base} BRUNO`)]);
    await Promise.all(held.map(part => within(part.firstUpdate, 15_000, "The real editor did not publish a collaboration update")));
    held.forEach(part => part.release());
    await Promise.all(held.map(part => part.cleanup()));
    await waitFor(async () => {
      const values = await Promise.all(pages.map(page => renderedText(page, item.textId).innerText()));
      return values.every(value => value === values[0] && value.startsWith(base) && value.includes(" ANA") && value.includes(" BRUNO") && value.split(" ANA").length === 2 && value.split(" BRUNO").length === 2);
    }, "Concurrent same-text edits lost a user's insertion or failed to converge");
    const concurrent = await renderedText(carla, item.textId).innerText();
    console.info("  Same-text concurrent insertions preserve both authors.");

    await people[2].context.setOffline(true);
    await changeFill(carla, item.shapeId, "#3355ee");
    await changeText(ana, item.textId, `${concurrent} ONLINE`);
    await allText([ana, bruno], item.textId, `${concurrent} ONLINE`);
    await people[2].context.setOffline(false);
    await allText(pages, item.textId, `${concurrent} ONLINE`);
    await allFill(pages, item.shapeId, "#3355ee");
    assert.deepEqual(people.map(person => person.navigations.length), navigationBaseline, "Live collaboration must update canvases without reloading or navigating the editor.");
    console.info("  Offline edits and live peer edits survive reconnection without a reload.");

    await carla.reload();
    await canvas(carla).waitFor({ state: "visible" });
    await Promise.all(pages.map(page => waitFor(async () => (await page.getByRole("button", { name: "Live collaboration", exact: true }).locator(".te-collaboration-count").innerText()) === "3", "Reloading Carla must replace her old presence instead of showing a fourth person", 5000)));
    await allText(pages, item.textId, `${concurrent} ONLINE`);
    await allFill(pages, item.shapeId, "#3355ee");
    await waitFor(async () => {
      const state = await json(await api.get("/api/template-editor"));
      const stored = state.library.designs.find(design => design.id === item.design.id);
      const elements = stored?.pages[0].canvas?.elements || [];
      return elements.find(element => element.id === item.textId)?.text === `${concurrent} ONLINE` && elements.find(element => element.id === item.shapeId)?.fill?.toLowerCase() === "#3355ee";
    }, "Live updates must be durable in the actual workspace store");
    const wrongScope = "f".repeat(64) === initial.scope ? "e".repeat(64) : "f".repeat(64);
    const deniedGet = await api.get(`/api/template-editor/collaboration?documentId=${item.design.id}&expectedScope=${wrongScope}&sessionId=${randomUUID()}`);
    assert.equal(deniedGet.status(), 403, "A foreign workspace scope must not subscribe to the document");
    const deniedPost = await api.post("/api/template-editor/collaboration", { data: { documentId: item.design.id, expectedScope: wrongScope, sessionId: randomUUID(), sequence: 1, awareness: { pageId: item.design.pages[0].id, selected: [] } } });
    assert.equal(deniedPost.status(), 403, "A foreign workspace scope must not write to the document");
    await allText(pages, item.textId, `${concurrent} ONLINE`);
    await allFill(pages, item.shapeId, "#3355ee");
    await ana.getByRole("button", { name: "File", exact: true }).click();
    await ana.getByRole("menuitem", { name: "Review & version history", exact: true }).click();
    const reviewDialog = ana.getByRole("dialog", { name: "Design tools", exact: true });
    const createReview = reviewDialog.getByRole("button", { name: "Create review link", exact: true });
    await waitFor(() => createReview.isEnabled(), "A fully saved live document must remain shareable for review");
    const reviewResponse = ana.waitForResponse(response => response.url().endsWith("/api/template-editor/reviews") && response.request().method() === "POST");
    await createReview.click();
    const reviewLink = await json(await reviewResponse);
    assert.match(reviewLink.token, /^[a-f0-9]{64}$/);
    const shared = await json(await api.get(`/api/template-editor/reviews?token=${reviewLink.token}`));
    const reviewElements = shared.review.document.pages[0].canvas.elements;
    assert.equal(reviewElements.find(element => element.id === item.textId)?.text, `${concurrent} ONLINE`, "The review snapshot must contain the durable live text");
    assert.equal(reviewElements.find(element => element.id === item.shapeId)?.fill?.toLowerCase(), "#3355ee", "The review snapshot must contain the durable live shape");
    await reviewDialog.getByRole("button", { name: "Done", exact: true }).click();
    await ana.screenshot({ path: path.join(artifacts, `${item.kind}-three-editors.png`), fullPage: true });
    console.info("  Reload retains durable edits; foreign scopes are rejected; the editor creates a correct review snapshot.");
    if (item.kind === "template") {
      const beforePublication = await json(await api.get("/api/template-editor"));
      const publishedName = `Published ${item.design.name}`.slice(0, 100);
      await ana.getByRole("button", { name: "Save template", exact: true }).click();
      const publishDialog = ana.getByRole("dialog", { name: "Save as a reusable template", exact: true });
      await publishDialog.getByRole("textbox", { name: "Template name", exact: true }).fill(publishedName);
      await publishDialog.getByRole("button", { name: "Save template", exact: true }).click();
      await allText([bruno, carla], item.textId, `${concurrent} ONLINE`);
      assert.equal(new URL(bruno.url()).searchParams.get("design"), item.design.id, "Publishing must retain Bruno's shared draft");
      assert.equal(new URL(carla.url()).searchParams.get("design"), item.design.id, "Publishing must retain Carla's shared draft");
      let publishedId;
      await waitFor(async () => {
        const state = await json(await api.get("/api/template-editor"));
        const draft = state.library.designs.find(design => design.id === item.design.id);
        const template = state.library.templates.find(template => template.id === draft?.editingTemplateId);
        publishedId = template?.id;
        return Boolean(template && template.name === publishedName && state.library.templates.length === beforePublication.library.templates.length + 1);
      }, "Publication must retain the shared draft and link it to one saved template");
      await ana.goto(`${origin.origin}/admin/engine?design=${item.design.id}`);
      await canvas(ana).waitFor({ state: "visible" });
      await ana.getByRole("button", { name: "Update template", exact: true }).waitFor({ state: "visible" });
      await changeText(ana, item.textId, `${concurrent} ONLINE UPDATED`);
      await allText(pages, item.textId, `${concurrent} ONLINE UPDATED`);
      await waitFor(async () => {
        const state = await json(await api.get("/api/template-editor"));
        return state.library.designs.find(design => design.id === item.design.id)?.pages[0].canvas.elements.find(element => element.id === item.textId)?.text === `${concurrent} ONLINE UPDATED`;
      }, "The reopened template draft must save live changes before updating the catalogue");
      await ana.getByRole("button", { name: "Update template", exact: true }).click();
      const updateDialog = ana.getByRole("dialog", { name: "Update your template", exact: true });
      await updateDialog.getByRole("textbox", { name: "Template name", exact: true }).fill(publishedName);
      await updateDialog.getByRole("button", { name: "Update template", exact: true }).click();
      await waitFor(async () => {
        const state = await json(await api.get("/api/template-editor"));
        const draft = state.library.designs.find(design => design.id === item.design.id);
        const template = state.library.templates.find(template => template.id === publishedId);
        return draft?.editingTemplateId === publishedId && state.library.templates.length === beforePublication.library.templates.length + 1 && state.library.templates.filter(template => template.name === publishedName).length === 1 && template?.pages[0].canvas.elements.find(element => element.name === "Shared heading")?.text === `${concurrent} ONLINE UPDATED`;
      }, "Update template must reuse the published template id and preserve the collaborative draft");
      await allText([bruno, carla], item.textId, `${concurrent} ONLINE UPDATED`);
      await bruno.screenshot({ path: path.join(artifacts, "template-after-publication.png"), fullPage: true });
      console.info("  Publishing and updating reuse one template; the other collaborators remain in their shared draft.");
    }
  }
  assert.deepEqual(browserErrors, [], "Real app pages must not throw browser errors");
  console.info("PASS: two or more users collaborate live; acceptance verified with three independent users on both post and template.");
} catch (error) {
  if (browser) await Promise.allSettled(contexts.map(async (context, index) => context.pages()[0]?.screenshot({ path: path.join(artifacts, `failure-user-${index + 1}.png`), fullPage: true })));
  console.error(`FAIL: ${error.stack || error}\nArtifacts: ${artifacts}\nBrowser errors: ${browserErrors.join("; ")}`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(blockedNetwork.map(cleanup => cleanup()));
  await Promise.allSettled(contexts.map(async (context, index) => { await context.tracing.stop({ path: path.join(artifacts, `user-${index + 1}.zip`) }); await context.close(); }));
  await browser?.close();
  await api.dispose();
}
