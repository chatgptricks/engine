# Editable slides for AI agents

Engine exposes tools for agents to create and revise slide decks in the same library people use. Text stays text; images and shapes stay independent native layers. The returned `editorUrl` opens the saved deck for manual editing. Agents can work from a template, use built-in layouts, or place individual layers with exact coordinates.

The API does not require an OpenAI key or a particular model. Any agent that supports MCP stdio or authenticated JSON HTTP requests can use it. Existing editor PNG, JPG, WebP, SVG, and PDF downloads remain available in the editor. The agent export tool returns an editable `.engine.json` package.

## Connect an agent

1. Start Engine with Node 22 (`npm run dev`) or use your deployed HTTPS instance.
2. Choose **Connect agent** in the library header or **Library tools → Connect an AI agent…**. Enter a name, choose **Create access token**, and copy its token when it appears.
3. Choose **Download the MCP bridge** in the connection dialog. Configure your MCP client to run that file using the configuration below (also provided in the dialog). Replace the absolute script path and keep the token in the client's local secret/environment configuration. From a source checkout, you can use `scripts/engine-agent-mcp.mjs` directly.
4. Ask the agent to call `engine_capabilities`, create a deck, and return its `editorUrl`.

For MCP clients that use an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "engine": {
      "command": "node",
      "args": ["/absolute/path/to/engine-agent-mcp.mjs"],
      "env": {
        "ENGINE_URL": "http://localhost:3000",
        "ENGINE_AGENT_TOKEN": "PASTE_YOUR_AGENT_TOKEN_HERE"
      }
    }
  }
}
```

`ENGINE_URL` defaults to `http://localhost:3000`. Remote instances require HTTPS. HTTP is accepted for `localhost`, IPv4 loopback, or `::1`. URLs with embedded credentials, queries, or fragments are rejected. Requests always target `/api/agent/slides` on that origin, and redirects are refused.

Tokens belong to the workspace that created them. They grant the agent the API's deck and template reads, deck creation, deck editing (including layer/slide removal), and editable deck export in that workspace. There are no separate per-deck or read-only scopes. Tokens expire after 30 days and can be revoked from **Connect an AI agent**. The server stores a token hash; the full token is shown only when created. Development credentials and data stay in the configured development storage; deployed production requires cloud storage.

## Available tools

| Tool | Purpose |
| --- | --- |
| `engine_capabilities` | Read live creation/update JSON Schemas, presets, fonts, limits, coordinates, and examples |
| `engine_list_templates` | Browse native starting templates and their editable slots |
| `engine_list_decks` | Browse saved decks and editor links |
| `engine_get_deck` | Read a native document, output-pixel `view`, stable page/layer IDs, current `hash`, and editor link |
| `engine_create_deck` | Save an editable deck from `spec`; optional UUID `operationId` |
| `engine_update_deck` | Apply `changes` using `deckId`, `expectedHash`, and an optional UUID `operationId` |
| `engine_export_deck` | Return `{filename, package, editorUrl}` for an editable `.engine.json` file |
| `engine_list_page_profiles` | List the pages Engine recreates posts for: language, template, voice, house rules, Follow line |
| `engine_playbook` | Read the Recreate team's playbook: the carousel shape, the house rules, and one role card per stage with its output schema |
| `engine_recreate_post` | Start recreating an Instagram post (link or slide screenshots) for one page, as an `exact` copy or a full recreation in `checkpoint` or `autopilot` mode; returns a `postId` and `jobId` |
| `engine_recreate_status` | Read a recreation's progress: each stage's status and summary, the checkpoint while paused, and the deck, fact checks and critics' review when done |
| `engine_recreate_approve` | Approve a paused recreation: an optional edited outline, plus a hook option or a hook of your own |
| `engine_recreate_rerun_stage` | Rerun one stage, with optional instructions, and every stage after it |
| `engine_recreate_submit_stage` | Hand in one stage's result yourself; Engine checks it against the stage's schema |
| `engine_recreate_resume` | Continue a recreation that stopped, keeping every finished stage |

List tools accept `offset` (default 0, maximum 10000) and `limit` (default 20, maximum 100). MCP tool discovery fetches the live schemas from Engine. When the server is unavailable, discovery exposes generic schemas so the capabilities tool can still diagnose the connection. Call capabilities again after changing server versions or reconnecting.

## Create a deck

Start with `engine_capabilities` to discover the current contract. Its `deckSchema` and `updateSchema` are authoritative; unknown fields produce validation errors. The simple layouts create several editable layers for you:

```json
{
  "spec": {
    "name": "A product worth explaining",
    "format": "presentation",
    "theme": {
      "background": "#0b1014",
      "text": "#ffffff",
      "accent": "#00d98a",
      "font": "inter"
    },
    "slides": [
      {
        "id": "intro",
        "layout": "title",
        "title": "Build once, keep editing",
        "body": "AI builds the first draft. Your team controls every layer."
      },
      {
        "id": "details",
        "layout": "content",
        "title": "A useful starting point",
        "bullets": [
          "Text remains selectable and editable",
          "Images and shapes remain separate layers",
          "The deck opens directly in Engine"
        ]
      }
    ]
  }
}
```

Pass that object to `engine_create_deck`. `format: "presentation"` currently means 1920 × 1080 output pixels. Capabilities also lists portrait, square, story, and custom size options, available font identifiers, and native templates. To start from a template, use its `templateId` and follow the slot guidance returned by capabilities and `engine_list_templates`. Copy the template page for page, or compose any number of slides from its page types with `templatePage` (see below).

### Consistent posts from a template

For posts that should always look like your brand, start from a template instead of placing layers. `engine_list_templates` returns each template's slots exactly as a copy will have them, in reading order:

```json
{"pageIndex": 1, "pageLabel": "Text + Media", "slot": "smart-text-0", "type": "text", "role": "heading", "sample": "Your Title text", "maxCharacters": 184, "fixedStyle": true}
{"pageIndex": 1, "pageLabel": "Text + Media", "slot": "smart-media", "type": "photo", "fixedStyle": false}
```

- **Text slots** keep the template's font, colour, alignment and position. Their size adapts to the copy: type first shrinks slightly inside the original box, then the slot takes room from what sits below it (a photo frame below gives up at most about a third of its height; text below moves down), and only then shrinks to the readable minimum. Copy at the foot of a page grows upwards. `maxCharacters` is a rough upper guide; shorter copy reads better.
- **Photo slots** take a new image (`slots: {"smart-media": "https://…"}` or the slide's `image`) inside a fixed frame.
- **Fixed** layers (logos, handles, profile cards, decorative shapes) are not listed and cannot change.

Fill a slide with `title`/`body` (the first and second text slots in reading order) or by slot name. A slot key can be the slot name or, for a slot listed without a name, the `slot`/`elementId` value `engine_list_templates` reports. To copy the template page for page, omit `slides` or pass exactly one entry per template page, in order:

```json
{"spec": {"name": "Memory launch", "templateId": "…", "slides": [{}, {"title": "OpenAI just shipped memory for every ChatGPT user", "image": {"src": "https://…/photo.jpg", "alt": "ChatGPT memory settings"}}, {}]}}
```

#### Compose any length from the template's page types

A template's pages are page types (Cover, Text + Media, List, Follow, …). To build a carousel of any length from them, set `templatePage`, the 0-based index of the template page to copy, on each slide:

- `templatePage` is valid only with `templateId`, on `engine_create_deck`. `add_slide` does not accept it.
- If any slide sets `templatePage`, every slide must set it. Otherwise the deck is rejected with the path of the first slide that is missing it.
- A composed deck has 1–20 slides. Template pages can repeat, appear in any order or be left out. An index outside the template (for example `4` for a 4-page template) is rejected with the valid range.
- Each slide is a fresh copy of its template page. Engine uses the editor's **Duplicate page** to give the page, its image and every layer, group, component instance and word texture new IDs, then remaps group nesting, reading order and rich-text texture runs. Slot names stay the same on every copy, so `slots` keys and smart flows work on each copy. Supply `id` on a slide to choose its page ID, and `label` to rename it (the template's page label is kept otherwise).
- Every copy keeps the smart-template rules a full copy has. Engine prepares the whole template first, so a Cover keeps its cover type wherever it sits, interior pages never become covers, and brand layers stay fixed.
- Without `templatePage`, the rules above still apply: omit `slides`, or pass exactly one slide per template page.
- Continuous canvas templates can only be copied whole.

`engine_list_templates` (for every template in the workspace, including your own) and `engine_capabilities` (built-in templates) list each template's `pageTypes`: `[{"index": 0, "label": "Cover", "slots": [...]}, …]`, including pages with no slots, such as a closing Follow page. Each slot's `pageIndex` and `pageLabel` give the same mapping. `slideCount` is the number of page types.

This recreates a 6-slide post from a 4-page template (0 Cover, 1 Text + Media, 2 List, 3 Follow), using Text + Media three times:

```json
{"spec": {"name": "Memory, recreated", "templateId": "…", "slides": [
  {"templatePage": 0, "title": "OpenAI just shipped memory for every ChatGPT user"},
  {"templatePage": 1, "title": "It remembers your projects", "slots": {"smart-media": "data:image/png;base64,iVBORw0KGgo…"}},
  {"templatePage": 1, "title": "You can switch it off", "image": {"src": "https://…/settings.jpg", "alt": "Memory settings"}},
  {"templatePage": 1, "title": "Or delete one memory at a time", "image": {"src": "https://…/manage.jpg", "alt": "Manage memories"}},
  {"templatePage": 2, "title": "Try these prompts", "body": "1. Summarise my week\n2. Plan my trip"},
  {"templatePage": 3}
]}}
```

#### Images in photo slots

Photo slots (`slots` values) and `image.src` accept up to 2,000,000 characters (text slots accept up to 20,000):

- `https://` and `http://` URLs, and root-relative paths on the Engine origin such as `/media/photo.png`.
- `data:image/png`, `jpeg`, `webp`, `gif` and `avif` URLs with `;base64,`. The decoded bytes must start with the declared format's signature, so a mislabelled file is rejected.
- SVG only as `data:image/svg+xml;charset=utf-8,<URI-encoded SVG>`, using the passive vector grammar from the Brand importer: `svg`, `g`, `path`, `defs`, `linearGradient`, `radialGradient` and `stop`. Text, `rect`, `circle`, styles, links and embedded images are not allowed, and `data:image/svg+xml;base64,…` is always rejected.

Generated charts should therefore be rendered to PNG, for example as `data:image/png;base64,…`, and dropped into the photo slot. Images count once each towards the workspace's 12 MB save budget, so keep chart PNGs reasonably small.

Text that cannot fit at the readable minimum is flagged in the editor and must be shortened before that page can be exported.

For a fully positioned slide, use `layout: "blank"` and independent `elements`. Agent authoring coordinates, dimensions, and font sizes are **output pixels**:

```json
{
  "spec": {
    "name": "Precisely placed, fully editable",
    "format": "presentation",
    "slides": [{
      "id": "opening",
      "layout": "blank",
      "background": "#0b1014",
      "elements": [
        {
          "type": "shape",
          "id": "accent",
          "name": "Green accent",
          "shape": "rectangle",
          "x": 100,
          "y": 100,
          "width": 16,
          "height": 180,
          "fill": "#00d98a"
        },
        {
          "type": "text",
          "id": "heading",
          "name": "Opening headline",
          "text": "Keep every idea editable",
          "x": 160,
          "y": 100,
          "width": 1500,
          "height": 180,
          "font": "inter",
          "fontSize": 80,
          "fontWeight": 700,
          "color": "#ffffff"
        }
      ]
    }]
  }
}
```

`engine_get_deck` returns an output-pixel `view` alongside the saved native `document`. Use `view.slides` and their elements to inspect positions and prepare updates in the same coordinate system as the authoring API. The raw native document stores positions on Engine's **360-wide scene**, with the conversion described in the response's `coordinates`. If working directly from the raw document at 1920 output pixels, multiply a scene value by `1920 / 360` before sending it as an agent authoring value.

Image layers accept a supported image `src` and optional public alt text. An agent should keep headlines, labels, tables, and diagram shapes as individual native elements if people need to edit them. A screenshot or rendered slide added as one image remains one image layer.

## Recreate a post for one of our pages

Recreate turns someone else's Instagram post into a native, editable carousel in one page's template, voice and language (English or Spanish). It has two kinds of run:

- **Exact copy** (`mode: "exact"`) rebuilds the post as it is: the same slides in the same order (one slide stays one slide) with the same words. If the page's language differs from the original's, the words are translated faithfully, with no rewording. Nothing is added: no research, hook options, checkpoint, reader questions, reactions from X or extra Follow slide. Only the look changes: the template's fonts and colors, the cover headline in capitals, and no final periods. The original page's own name, handle, logo, swipe prompts and slide numbers are left out, and its "follow us" slide becomes the page's Follow slide, with the page's own first line and a second line kept within the page's limit. Photos, charts and screenshots are cut from the original slides. The caption is the original's, minus the lines that promote its creator.
- **Full recreation** (`checkpoint` or `autopilot`) recreates the original faithfully, then answers the first questions a reader asks, shows real reactions from X, and ends with the page's Follow slide.

An exact copy has three stages: `transcript` (one agent reads the original slides and copies their words into the template's pages, and marks each picture's box on the slide; Engine then fits each box to the picture's edges, leaving a chart a little room so its labels stay whole), `deck` (Engine cuts the pictures out of the original and builds the deck) and `review` (Engine's checks, then a critic compares the rendered slides with the original; a must-fix problem goes back to `transcript` once). It takes about 1–3 minutes.

For a full recreation, a team of agents does the work on the server, each with one job. Every stage saves its result into the run's **post file**, so a run can pause for a person, survive a server restart, or redo a single stage:

| Stage | Who | What it produces |
| --- | --- | --- |
| `brief` | Editor-in-chief | What the original says slide by slide, what to keep, the reader's first questions |
| `facts`, `data`, `reactions`, `visuals` | Research, in parallel (`visuals` starts once `facts` is done) | Checked claims with sources, the original chart's real data series, real viral posts from X with their links, candidate photos from X and from the pages the facts cite |
| `outline` | Story editor | The slide plan: the original's slides first, then reader questions, reactions, a takeaway and Follow |
| `hooks` | Headline model | Hook options for the cover (written by the copywriter when the headline model isn't set up) |
| `approval` | A person, or autopilot | The approved plan and the chosen hook |
| `copy`, `charts`, `images` | Makers, in parallel | Slot text in the page's voice, the charts, the photos |
| `deck` | Designer | The editable deck in the page's template; fact checks, sources and notes are saved as deck comments |
| `review` | Critics | Every number checked against the research, and the rendered slides checked against the original and the house rules. Must-fix problems go back to the copywriter, chart maker or art director, for at most two rounds |

```json
{ "profileId": "chatgptricks", "url": "https://www.instagram.com/p/SHORTCODE/", "mode": "checkpoint", "notes": "Optional direction for this post" }
```

Call `engine_list_page_profiles` for the ids, then `engine_recreate_post`. Instead of `url`, you can send `uploads`: 1–20 `{name, dataUrl}` slide screenshots in order, plus the `caption`. A run takes several minutes, so poll `engine_recreate_status` with the `postId` about every 15 seconds:

- **`checkpoint` mode** pauses with `status: "paused"` once the plan and the hook options are ready. The status then includes `checkpoint`: the outline, the hook options, the real reactions and the charts. Approve it with `engine_recreate_approve`: pass `option` (an index into `checkpoint.hooks.options`) or your own `hookText`, and optionally an edited `outline` in the same shape (reorder, cut or add slides; a reaction slide lists its posts in `reactionIds`).
- **`autopilot` mode** (the default) approves the plan as written with the first hook option that fits the cover's headline (the shortest when none fits) and runs to the end.
- **`exact` mode** never pauses and takes no `xPosts`. Approving, adding posts and the full recreation's stages don't apply to it; rerun or hand in `transcript`, `deck` or `review` instead.
- When `status` is `done`, `result` has the `deckId`, `editorUrl`, fact checks, notes and the critics' `review` with any problems still open. Review the deck with `engine_get_deck` and send a person the `editorUrl`.
- When `status` is `error`, `resumable` is true and `engine_recreate_resume` continues from the last finished stage.

To change one part, call `engine_recreate_rerun_stage` with the stage and plain instructions, such as `{"stage": "copy", "instructions": "Make the cover shorter"}`; every stage after it runs again. An agent can also do a stage itself: read the role card and output schema in `engine_playbook`, then hand the result in with `engine_recreate_submit_stage`. Engine checks it against the schema and continues from there. Charts and the deck are always built by Engine, and reactions must be real posts from X.

A rebuilt deck replaces the earlier version in place. If the deck changed since Engine saved it (a person edited it, or the editor re-fitted its text when it was opened), that version stays and the rebuild is saved next to it as a new post named “… (rebuilt)”. A deck in Trash is left alone; the new version is held and the run's notes say why.

Hook choices teach the team's headline model only when a signed-in person approves, as in Engine's Recreate dialog. Approvals made with an agent token and autopilot runs are never sent to it.

Over HTTP, the same calls use the agent token: `GET /api/engine/page-profiles`; `POST /api/engine/recreate` to start (202 with the run's status); `POST /api/engine/recreate` with `{"action": "approve" | "rerun_stage" | "submit_stage" | "resume" | "stop", "postId": "…", …}`; `GET /api/engine/recreate?postId=…` for progress; and `GET /api/engine/recreate?playbook=1` for the playbook. Older clients may keep using `jobId` in place of `postId`.

The server needs `ANTHROPIC_API_KEY`, and `APIFY_TOKEN` for links and for reactions and photos from X. Searching X needs a paid Apify plan: on the free plan the tweet scraper runs only in demo mode, so the reactions and photo stages are skipped with a note saying so. `HEADLINE_API_KEY` enables the headline model. Each role's model can be changed with `ENGINE_MODEL_<ROLE>` (for example `ENGINE_MODEL_COPY`); Opus 5.5 writes and judges, and Sonnet 5.5 does the narrower research jobs. The design critic looks at the slides rendered with headless Chromium (`ENGINE_CHROMIUM_PATH`, else Playwright's own Chromium, else an installed Google Chrome); where no browser is available, it is skipped and only Engine's own checks run (empty slots, final periods, body length, the Follow line). Post files are kept for 30 days.

## Revise safely

Call `engine_get_deck` with `{ "deckId": "THE_SAVED_ID" }` immediately before revising an existing deck. Use its actual page/layer IDs and pass its exact `hash` as `expectedHash`. This example edits the positioned heading above:

```json
{
  "deckId": "THE_SAVED_ID",
  "expectedHash": "THE_HASH_FROM_ENGINE_GET_DECK",
  "changes": {
    "operations": [
      {
        "op": "update_element",
        "pageId": "opening",
        "elementId": "heading",
        "properties": {
          "text": "Build together, keep control",
          "fontSize": 76
        }
      },
      { "op": "rename", "name": "Editable presentation, revised" }
    ]
  }
}
```

Updates apply atomically. The API supports adding, editing, removing, and moving slides; adding, updating, and removing elements; renaming a deck; and changing its caption. Read the live update schema for exact fields. Locked and protected layers remain protected. A stale `expectedHash` returns HTTP 409: fetch the deck again, reconcile with its current content, and make a new operation. This prevents an agent from overwriting a person's intervening edit.

The bridge generates a UUID `operationId` for each mutation when omitted and returns it on success or failure. It never automatically retries a mutation. For recovery after a timeout or lost connection, retry with **the same operationId and identical arguments**. Reusing an ID with different content is rejected. The server retains the most recent 20 operation receipts per deck; retry promptly. Supply your own UUID before calling if your agent must retain it even if the entire MCP process disconnects.

The bridge times out an HTTP request after 30 seconds and reports API failures as MCP tool results with `isError: true`. Input/protocol mistakes are JSON-RPC errors. Each incoming stdio message is limited to 16 MiB, each HTTP response to 32 MiB, and each outgoing JSON-RPC response to 72 MiB. Engine's live capabilities and workspace save budget can impose smaller content limits.

## Editable handoff and direct HTTP

Open the returned `editorUrl` on the Engine origin to continue arranging layers, formatting text, changing images, or exporting rendered slides. For a portable editable file, call `engine_export_deck`, save its `package` as JSON using its suggested `filename`, and import it through Engine's **Import backup** action. The bridge returns the package as tool data; it does not write a file automatically. Private uploaded media may require the editor's portable ZIP backup when transferring to another workspace. This export preserves Engine layers; it does not generate a PowerPoint file.

Agents without MCP can POST directly to `/api/agent/slides` with `Authorization: Bearer YOUR_TOKEN` and `Content-Type: application/json`. The request body uses an `action` plus the corresponding tool arguments:

```json
{ "action": "capabilities" }
```

```json
{
  "action": "create_deck",
  "operationId": "74b737e8-1045-4c83-9e39-6fc4f42ff5f8",
  "spec": {
    "name": "HTTP-created editable deck",
    "format": "presentation",
    "slides": [{ "id": "intro", "layout": "title", "title": "Hello, Engine" }]
  }
}
```

The actions are `capabilities`, `list_templates`, `list_decks`, `get_deck`, `create_deck`, `update_deck`, and `export_deck`. Direct HTTP mutations require an explicit UUID `operationId`; the stdio bridge supplies it when omitted. API errors return an HTTP error status and an `error` message. A signed-in browser session can use the same API within its authorized workspace.

## Protocol and verification

The dependency-free Node 22 bridge implements the [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [initialization lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), and [tool listing/calling](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), negotiating protocol versions `2025-11-25` and `2025-06-18`. It exchanges newline-delimited JSON-RPC on stdin/stdout, keeps diagnostics on stderr, and accepts `ping` and initialized notifications.

Run the process-level bridge checks without starting the app:

```sh
node --test tests/template-editor-agent-mcp.test.mjs
```

These checks spawn the real bridge and a mock HTTP server to exercise discovery, authentication, argument mapping, editable payload round trips, operation IDs, conflict/network errors, redirect refusal, protocol validation, and size limits.
