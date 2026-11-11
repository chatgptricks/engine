# Editable slides for AI agents

Engine exposes tools for agents to create and revise slide decks in the same library people use. Text stays text; images and shapes stay independent native layers. The returned `editorUrl` opens the saved deck for manual editing. Agents can work from a template, use built-in layouts, or place individual layers with exact coordinates.

People can do the same work by talking to Claude in Engine's Chat panel instead (paste a link, then ask for changes); see [assistant.md](assistant.md).

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
| `engine_recreate_add_posts` | Add posts from X by link to a paused recreation before approving it |
| `engine_list_brands` | List the brand guides |
| `engine_get_brand` | Read one brand guide, with its plain-words brief |
| `engine_save_brand` | Save edits to a brand guide; every save is a version |
| `engine_restore_brand` | Bring back an earlier version of a brand guide |
| `engine_check_deck` | Check a deck or a template against a brand guide with code |
| `engine_design_template` | Draft a template from a brand guide |
| `engine_frame_upload` | Frames: make a slide from a flat image (a local `path` or a `dataUrl`); the image is its locked bottom layer and the original is kept |
| `engine_frame_view` | Frames: look at a Frames slide's original image, or a box of it, as an image for your own model |
| `engine_frame_cut` | Frames: cut a box of the original into an image layer of its own, in the same place (`removeBackground`: `none` or `flat`) |

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

A chart for a photo slot should therefore be rendered to PNG, for example as `data:image/png;base64,…`. Elsewhere on a slide, draw charts as an HTML layer instead (see [HTML layers](#html-layers)): it stays sharp and uses the brand's colors and fonts.

Engine stores each `data:` PNG, JPEG, WebP and SVG image you send as a media file in the workspace, as it does with uploaded originals, and the saved deck points to it: `src` reads `/api/template-editor/assets/<sha-256>`, and `get_deck` and the update's response show that path. The same image is stored once. Stored images don't count towards the workspace's 12 MB save budget; a `gif` or `avif` image, or one Engine can't decode, stays embedded and counts once. Images a template brings (its placeholders and brand marks) stay as they are.

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

Image layers accept a supported image `src` and optional public alt text.

### Videos

A video is its own layer, in the stack like an image, so text, shapes and fades can go above or below it:

```json
{ "type": "video", "src": "/api/template-editor/videos/…", "poster": "/api/template-editor/assets/…",
  "x": 0, "y": 0, "width": 1080, "height": 1000, "start": 0, "end": 12, "loop": true, "muted": true }
```

- `src` is the clip: an Engine video path from `engine_video_upload` or `engine_get_deck`, or a public https link Engine copies. Through the Engine MCP, `path` (an absolute path to an `.mp4`, `.m4v`, `.mov` or `.webm` file) works instead; the bridge uploads it, and without `poster` takes one from the clip with ffmpeg.
- `poster` is the still that thumbnails, PNG and PDF show. Without one the slide shows a dark frame and `engine_check_deck` flags it.
- To swap a still for its clip, use `add_video` with `replaces`: the layer's id. The video takes that layer's box, crop and place in the stack, and the still is hidden:

```json
{ "operations": [
  { "op": "add_video", "pageId": "s1", "replaces": "l1", "path": "/Users/me/Clips/01-cover-video.mp4" },
  { "op": "add_video", "pageId": "s9", "replaces": "s9-l10", "path": "/Users/me/Clips/09-media.mp4" } ] }
```

- `update_element` on a video layer changes `poster`, `start`, `end`, `loop` or `muted`. `engine_get_deck` shows it as `type: "video"` with `src` (the clip), `poster`, and the clip's facts in `video`.
- Over plain HTTP, upload with `POST /api/agent/videos`: `{action: "start", id: <sha-256>, bytes, mimeType, name}` (a WebM also sends `duration`, `width`, `height`), send the bytes where it says (a signed Storage URL, or 4 MB `PUT` parts in development), then `{action: "finish", …}` returns `src`.

Engine stores a video layer as an image whose `src` is the poster and whose `video` is the clip, so a photo slot can also play one. Add `video` to an image layer or a slide's `image`:

```json
{ "type": "image", "src": "data:image/jpeg;base64,…cover frame…", "x": 0, "y": 0, "width": 1080, "height": 1440,
  "video": { "url": "https://example.com/clip.mp4", "start": 2, "end": 14 } }
```

**A video file on your computer.** Through the Engine MCP, give `video: {"path": "/Users/me/Clips/01-cover-video.mp4"}` (an absolute path to an `.mp4`, `.m4v` or `.mov` file). The bridge uploads the file and sends Engine its `src` instead; when the image has no `src`, it also takes the cover from the clip's frame at `coverTime` (0.5 s by default) with ffmpeg (set `ENGINE_FFMPEG` if it isn't on the PATH). The cover works the same way on a template's photo slot:

```json
{ "templateId": "chatgptricks-3x4", "slides": [
  { "templatePage": 0, "title": "…", "image": { "video": { "path": "/Users/me/Clips/01-cover-video.mp4" } } },
  { "templatePage": 1, "title": "…", "image": { "video": { "path": "/Users/me/Clips/02-demo.mp4", "start": 0, "end": 20 } } } ] }
```

To put a clip on an image that's already there (a deck's cover photo, say), use `engine_update_deck` with `update_element` and `properties: {"video": {"path": …}}`; the cover is replaced too unless you give `src`. `engine_video_upload` does only the upload and returns `src` and `coverSrc` to use later. A file is stored once. Over plain HTTP, store a file with `POST /api/agent/videos` (`{action: "start", id: <sha-256>, bytes, mimeType, name}`, then send the bytes where it says, then `{action: "finish", …}`) and give `video: {src}`.

- `url` is a public https link to an MP4 or MOV file (H.264), up to 200 MB and 3 minutes. Engine copies it into the workspace's storage once (the same file is reused), and the saved deck points to it as `/api/template-editor/videos/<sha-256>`. A clip never sits inside the deck, so it doesn't count against the 12 MB library limit. Private and local hosts are refused.
- `src` stays the layer's image and is the video's **cover**: thumbnails, PNG and PDF exports and review links show it, so use a frame from the clip.
- `start` and `end` trim the clip, in seconds. A slide plays at most **60 seconds** (Instagram's limit for a carousel video).
- A clip longer than 60 seconds **without** `start` or `end` continues on new slides placed right after its own: each is a copy of that slide playing the next 60 seconds (0–60, 60–120, 120–180), and the last plays what's left. The copies show the first cover until someone sets theirs in the editor. With `start` or `end` set, the clip stays on one slide and plays at most 60 seconds from `start`. The deck still holds at most 20 slides; a video that would need more is refused. `loop` (default true) plays it again from `start`; `muted` (default true) is how it plays while editing.
- `engine_get_deck` returns the stored clip with its `src`, `duration`, `width`, `height` and `bytes`. Pass `video: {"src": "/api/template-editor/videos/…"}` to reuse it on another layer.
- `update_element` with `video: {"start": 3, "end": 9}` changes the trim (the clip itself stays); `video: {"url": …}` replaces it; `video: {"remove": true}` keeps only the cover as a still photo.
- A video stays on one slide: `span` isn't available on it.
- A download as PNG, JPG or WebP turns every slide with a video into an MP4 (H.264, 1080 wide, 30 fps, with the clip's sound), with every layer drawn over or under the clip as on the canvas. PDF and SVG show the cover.
- In the editor, a clip longer than 60 seconds is split the same way when it's uploaded, each new slide with a cover from its own part, as one undo step. The clip plays muted on the canvas, and the Video tab trims it, sets its cover from any frame, and switches loop and sound. An agent should keep headlines, labels, tables, and diagram shapes as individual native elements if people need to edit them. A screenshot or rendered slide added as one image remains one image layer.

### HTML layers

An HTML layer draws part of a slide, or a whole slide, from HTML and CSS: charts, tables, comparisons, logo grids, memes, X post cards, anything boxes of text, images and shapes draw badly. It is a normal layer: people move, resize, rotate, hide, delete and undo it in the editor, it syncs live, and it exports to PNG and SVG as drawn (a PDF page with an HTML layer is exported as an image). Keep the headline and photos people will want to change on their own as text and image layers.

Add one with `add_html`, or as an element of `type: "html"` in a new deck's slides. Its box (`x`, `y`, `width`, `height`, output pixels) defaults to the whole slide:

```json
{
  "op": "add_html",
  "pageId": "opening",
  "name": "Revenue chart",
  "x": 80, "y": 520, "width": 920, "height": 640,
  "html": "<div class=\"chart\"><svg viewBox=\"0 0 920 560\">…</svg><p class=\"note\">Source: company filings</p></div>",
  "css": ".chart { height: 100%; display: flex; flex-direction: column; gap: 16px; } .note { font: var(--source-weight) var(--source-size) var(--source-font); color: var(--color-source); }"
}
```

- The HTML is laid out `designWidth` CSS pixels wide, by default the box's width, so 1 CSS pixel is 1 output pixel, and as tall as the box, then scaled to fit it. Anything outside the box is cut off. Resizing the box scales the HTML; pass `designWidth` too to lay it out again at the new width.
- CSS goes in `css` or in `<style>` blocks and applies only inside the layer: `:root`, `html` and `body` mean the layer's box. Engine's base styles apply (margins 0, unstyled headings and lists, `img` as `display: block`, `box-sizing: border-box`).
- When the deck's template follows a brand guide, Engine sets its values as CSS variables: `--color-background`, `--color-text`, `--color-accent`, `--color-accent-end`, `--color-surface`, `--color-secondary`, `--color-source`, `--gradient-accent`; for each text style (`title`, `body`, `cover`, `source`, `list`, `follow`…) `--title-font`, `--title-size`, `--title-weight`, `--title-leading`, `--title-tracking`, `--title-case`, `--title-color`; and `--page-width`, `--page-height`, `--margin-left`, `--margin-right`, `--margin-top`, `--margin-bottom`. The layer's default font and color are the brand's body font and text color. Agents don't send these variables (`tokens`); Engine sets them.
- Fonts come only from the brand: `var(--title-font)` and the like, the brand fonts' names (`"SF Pro Display"`), and generic families. Any other font is replaced by the body font. A deck with no brand guide can name any of Engine's fonts.
- Images (`img src`, SVG `image href`, CSS `url()`) take base64 `data:image/png`, `jpeg`, `webp`, `gif` and `avif` URLs and Engine asset paths (`/api/template-editor/assets/…`). Nothing loads from outside Engine. Engine stores `data:` PNG, JPEG and WebP images as media files, and the saved layer points to them by asset path. Inline SVG works, with gradients, clip paths, masks, text and `use` with `#id`s.
- Alt text and screen readers get the layer's words. Give a chart, or anything else that is a picture, `role="img"` and an `aria-label` saying what it shows; it is read instead of the words inside it (tick labels and the like). `img` alt text is read too.
- Engine removes scripts, event handlers, iframes, objects, canvas, video and audio; forms, buttons and links keep their text but do nothing; `@import`, `@font-face`, `@media` and every other at-rule, animations and transitions go. HTML that is left with nothing to draw is rejected.

On a template slide with a photo or chart frame, pass `replaces` with the frame's id to draw the HTML in its place:

```json
{ "op": "add_html", "pageId": "chart-slide", "replaces": "media-photo-id", "name": "Jobs chart", "html": "<svg viewBox=\"0 0 936 919\">…</svg>" }
```

The layer takes the frame's box (unless you pass `x`, `y`, `width` or `height`) and its place in the template's layout: the template keeps it under the copy and fits it to the space as it would the frame, so its height can change with the copy above it, and layers that followed the frame follow the HTML layer. The frame is hidden and the layer goes just above it in the stack. Don't hide a template's frame yourself to make room: a page with an empty frame centres its copy in the space, on top of your layer.

`replace_html` (`pageId`, `elementId`, `html`, optional `css`) replaces a layer's HTML and keeps its box. Without `css`, the layer keeps its CSS unless the new HTML has its own `<style>` blocks. `update_element` can also set `html`, `css` and `designWidth`, or move and resize the layer.

## Frames: slides that only exist as an image

Some slides arrive as one flat picture: made in another chat, with another design system, or by a tool Engine can't match. Frames takes such a picture apart into layers people can edit. Use it only when you don't have the slide's source; with the source, build native layers or HTML layers instead.

1. `engine_frame_upload` with `path` (an absolute path to a `.png`, `.jpg`, `.jpeg` or `.webp` file of at most 15 MB, which the bridge reads only after checking its first bytes) or `dataUrl`. Without `deckId`, a new deck the image's size is made. The picture becomes the slide's bottom layer, locked, named "Original image", and Engine keeps the original on the page (`page.frame`). Nothing else runs.
2. `engine_frame_view` returns the original (or a `box` of it) as an image. You read it with your own model; Engine runs none. `imageOnSlide` says where the image sits on the slide.
3. `engine_frame_cut` cuts a `box` (slide output pixels) of the original into an image layer of its own, in the same place, above the image. `removeBackground: "flat"` makes the colour around the box's edge transparent and trims the cut to what is left: right for logos, icons and cards on one colour. `none` keeps the box as it is: right for photos. Cuts always come from the original.

On the HTTP API these are the `frame_slide` and `frame_cut` operations of `update_deck` (they need the server, so they run one at a time inside the same atomic update) and the `frame_view` action. `POST /api/agent/assets` takes an image's raw bytes (up to 15 MB) and returns its `src`.

In the editor: **New slide from image…** in a page's menu or the canvas menu makes a Frames slide; **Take apart** on the Frames bar lets you drag an area and **Cut out** it, with **Remove flat background** offered when the area sits on one colour. Each cut is one undo step.

Coming next: turning an area's words into text layers in the brand's styles, and filling in what a cut leaves behind.

## Recreate a post for one of our pages

Recreate turns someone else's Instagram post into a native, editable carousel in one page's template, voice and language (English or Spanish). It has two kinds of run:

- **Exact copy** (`mode: "exact"`) rebuilds the post as it is, every part in the page's style: the same slides in the same order (one slide stays one slide) with the same words. If the page's language differs from the original's, the words are translated faithfully, with no rewording. Nothing is added: no research, hook options, checkpoint, reader questions, reactions from X or extra Follow slide. Only the look changes: the template's fonts and colors, the cover headline in capitals, and no final periods. A first slide that is a picture with its headline on it stays the cover, its picture cut whole under our headline. The original page's own name, handle, logo, category tags, swipe prompts and slide numbers are left out, and its "follow us" slide becomes the page's Follow slide, with the page's own first line and a second line kept within the page's limit. Each image is judged first (see **Images: rebuild, keep or find the source** below): photos and official screenshots are kept whole; everything else is rebuilt. A graphic made of parts (a meme of words and photos, a row or grid of logos, a comparison, a diagram with words, a screenshot of an article, a headline or a chat) is rebuilt in the template instead of pasted: its panels become cards in the guide's surface color, its headings and words are set in the page's text styles (labels never under the guide's smallest text size), its photos are cut one by one, and each logo is found online by name, in order: the brand guide's own logos, [svgl](https://svgl.app), [Simple Icons](https://simpleicons.org) (CC0) and [Lobe Icons](https://lobehub.com/icons) (MIT). A logo none of them has, or a plain icon that is no brand's logo, is cut from its place on the original. Logo files are cleaned (SVG only, no scripts or outside links, at most 200 KB), drawn in their version for dark backgrounds when there is one, recolored when a one-color mark would vanish on the page, and saved into the deck, so a post never depends on those sites later. A one-color mark keeps its brand color only at the contrast text needs (4.5:1 on the card); below that it is drawn in the page's ink. The graphic keeps the original's arrangement at one scale, window dots, borders and cursors are left out, and every part is its own layer, grouped by panel. A slide holds at most 100 layers, so a logo grid too big for that stays one picture, with a note; a graphic that can't be rebuilt at all is cut whole, with a note.
  - **Charts** are redrawn in the page's chart style, the same chart from its real numbers: a line chart from the real series (FRED or the S&P 500, with the original's span, scaling, marked events and shaded period, and its two scales when it prints two: each labelled in its line's color and kept to its printed range when the data fits; a scale prints in the original's units, so FRED's job openings, counted in thousands, read 5M, 10M, 15M), a bar chart from the values the original prints (one series of 2–12 bars, the bars the original sets apart in our green). Values are never read off the picture: a chart whose real numbers aren't found, or a kind our drawer doesn't draw (a pie, a map, a dashboard), stays cut from the original, and the deck's notes say why.
  - **Posts from X** become the page's post cards on its Reaction page (one to three a page). Engine looks for the real post: by a link to it on the slide or in the caption, through X's embed (free), else with one X search for its author and first words (Apify, at most six a deck). The search takes every match, replies included, under each way the screenshot's handle could be spelled, since X's font draws a capital I and a small l alike. A result counts only from the same @handle (I and l as one letter) with nearly all the screenshot's words. A reply's card leaves out the @handles it opens with, as X does. A card draws one photo, so a found post with several keeps them all, cut together from the screenshot as X lays them out. A post that isn't found is built from the screenshot: its words as copied, in their own language, its profile photo and photo cut from the original, and a note says so. A template without a Reaction page cuts the posts whole.
- **Images: rebuild, keep or find the source.** The source reader decides, for each picture in the original, what the post does with it, and writes one line on why. The decisions show in `engine_recreate_status` (`images`, and the source stage's line, such as "images: 2 kept, 1 from its source, 3 rebuilt"), in the run view and in the deck's notes.
  - **rebuild:** posts and comments from any platform, charts, memes, chats, graphics made of parts, a news outlet's headline card, and logos. Engine always rebuilds a post from X, a chart and a logo, and never keeps a screenshot the reader describes as a Reddit comment or a tweet. A reading without decisions (an older run, or a hand-in that leaves them out) rebuilds everything but photos, as before.
  - **keep:** a company's or product's own official screen shown as the evidence (its website, announcement or blog page, product or pricing page, docs, an app or store screen, a demo frame), and real photos. Engine cuts the screenshot from the original slide (snapped to its edges) and the designer puts it in the template's photo frame. Engine then fits the frame to the picture: as wide as the space between the margins (the brand guide's, else the template's), its own proportions, centred in the frame's room, never cropped or stretched. A brand whose photos fill their frames gets the same.
  - **source:** the same kinds as keep, when the cut is small, soft or carries the post's own overlays and the original is likely online. The research gives the official page for each one (`originals` in its hand-in). Engine reads that page's images, the page the screenshot names, and the post's origin. It uses one only when it is the same picture, at the screenshot's shape within 12%, alike in colour at 32 × 32 (Pearson's r of at least 0.85, which a cut with a sticker on it still passes), and with at least 1.3 times its pixels. Otherwise the cut from the post is kept, and the notes say why.
  - The critics treat a kept picture with its reason as right, not pasted. Engine's checks make one cropped by its frame or stretched a must-fix, and one past the margins a should-fix. To change a decision, rerun the `source` stage with instructions ("keep slide 3's screenshot") or hand in source notes with `treatment`, `why` and `origin` on each part.
  - The caption is the original's, minus the lines that promote its creator.
- **Full recreation** (`checkpoint` or `autopilot`) recreates the original faithfully, then answers the first questions a reader asks, shows real reactions from X, and ends with the page's Follow slide.

An exact copy has four stages: `transcript` (one agent reads the original slides and copies their words into the template's pages, describes each graphic part by part, transcribes each post from X, and marks the box of each photo and chart on the slide; Engine then fits each box to the picture's edges, leaving a chart a little room so its labels stay whole), `data` (the chart rebuilder, only when a chart was boxed: it sees each chart cut from its slide and hands in the same chart from its real numbers, or says why it can't; Engine checks that each one draws), `deck` (Engine redraws the charts, finds the posts from X or builds their cards, rebuilds graphics from their parts, cuts the photos out of the original and builds the deck) and `review` (Engine's checks, including rebuilt layers off the page or on top of each other, then a critic compares the rendered slides with the original, word by word, logo by logo, chart by chart and post by post; a must-fix problem goes back once, to `transcript` for words and pictures or to `data` for a chart). It takes about 1–4 minutes.

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
- **`exact` mode** never pauses and takes no `xPosts`: it shows only the original's own posts from X. Approving, adding posts and the full recreation's stages don't apply to it; rerun or hand in `transcript`, `data` (its charts' real numbers), `deck` or `review` instead.
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

Updates apply atomically. The API supports adding, editing, removing, and moving slides; adding, updating, and removing elements; adding HTML layers and replacing their HTML; renaming a deck; and changing its caption. Read the live update schema for exact fields. Locked and protected layers remain protected. A stale `expectedHash` returns HTTP 409: fetch the deck again, reconcile with its current content, and make a new operation. This prevents an agent from overwriting a person's intervening edit.

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
