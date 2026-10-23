# Engine

A visual canvas editor for creating social posts, carousels, and reusable templates. Start blank or choose a defined design, then arrange independent text, image, and shape layers directly on the canvas.

The editor opens at `/admin/engine`, the research workspace at `/admin/engine/research`, and research API routes use `/api/engine`.

This repository is an independent copy with its own Git history. Configure service accounts and environment variables for this copy; do not reuse credentials, databases, or deployments from the source project.

Built with Next.js 16, React 19, and Tailwind v4. The editor retains the established Engine fonts, artwork, image handling, authentication, and persistence. One shared canvas renderer powers editing, library previews, and PNG exports.

## Build slides with an AI agent

Choose **Connect agent** in the library header to create a revocable, workspace-scoped access token and download the MCP bridge. Any MCP or HTTP-capable agent can create decks, reuse templates, inspect layers, revise slides, and return a link to continue editing in Engine. Text, images, and shapes remain native editable layers. No AI provider key is required for this workflow.

The agent API is `/api/agent/slides`; the local MCP entry point is `npm run agent:mcp` with `ENGINE_URL` and `ENGINE_AGENT_TOKEN` configured. Start with the capabilities tool for JSON Schemas, layout presets, fonts, and examples. Updates require the current document hash and retain retry receipts to protect concurrent edits. Editable handoff uses `.engine.json`; the editor also provides rendered exports and portable media ZIP backups. See [the agent guide](docs/agent-slides.md) for setup, examples, and the complete tool contract.

## Create a post

1. Choose **New design** for a blank canvas, pick one of eight built-in templates, or start from **My templates**.
2. Add independent text boxes, images, rectangles, circles, or lines. Double-click text to type directly; drag to move, use handles to resize, and rotate with the rotation handle. Center guides help align objects. Shift-click adds to a selection; drag across empty canvas to select several elements together.
3. Add, duplicate, reorder, or remove pages. Undo and redo changes while the design is open, including active text edits. Use **⌘/Ctrl Z** to undo and **⌘/Ctrl Shift Z** or **⌘/Ctrl Y** to redo. History returns to the affected page and selection; automatic text fitting and unchanged values do not add steps or erase redo. Save fonts, palettes, logos, and images in **Brand kits**, then reuse them from the editor’s **Brand** tab.
4. Use **Save as template** to keep the complete design as a starting point for future posts. Copies receive independent page and image identities.
5. Choose **Export** for PNG, JPG, WebP, multipage PDF, or an SVG for web viewers. Select the current page, all pages, or a range such as `1, 3-5`; choose resolution and image quality, and remove the background for PNG, WebP, or SVG. Multiple image pages download as a ZIP with numbered files and the caption when present. Captions can also be downloaded separately as TXT. Export checks fonts, image loading and resolution, and can be cancelled.

## Smart ChatGPTricks template

New designs made from **@chatgptricks** keep its existing canvas size, branding, fonts and artwork. Compatible imported headline fragments become one editable text block. Select text and use **Fit text → Auto / 2 lines / 3 lines / 4 lines** in the toolbar or Text panel. Covers use centered, balanced lines with no isolated words when the wording allows; content slides align left. Auto respects paragraph breaks. Fitting changes typography, never the wording.

Text and photo frames use the template’s margins and spacing. Text + Media, Full Bleed + text, Prompt and Title Quote layouts reflow their dependent content. Replace or crop frame photos, and add independent text, images and elements with object, margin and spacing snapping. Duplicating a fixed element makes an independently editable copy. Existing designs and the saved source template remain unchanged; the rules apply when starting a new copy.

If the requested line count needs more words, the editor explains the closest balanced layout. Copy that exceeds its readable minimum shows a shortening notice and must be fixed before exporting that page. Export resolves every selected page using its loaded fonts, including unvisited slides, and shares the exact breaks with PNG, SVG and PDF. Saved designs, collaboration and public review snapshots retain the layout rules.

## Build your own template

Choose **Create template**, enter a name, and select portrait, square, or Story format. The editor opens an empty canvas. Add text boxes, images, and shapes, position each element, and arrange pages manually. Uploaded images become independent layers and can also replace a selected image.

Template drafts autosave and can be resumed from **My templates** or **Your designs**. **Save template** places the finished template in **My templates**. Use a custom template's **Edit template** action to reopen it, then **Update template** to replace that template. Existing posts remain independent of future template edits.

## Canvas tools

Select an element to open contextual properties: font, size, bold, italic, underline, uppercase/lowercase, text alignment, letter and line spacing, colors, opacity, rotation, and exact position and dimensions. Image controls include fill/fit, crop position, and corner radius; shapes include fill, border, and radius. Alignment actions place objects against page edges or center. Layers can be reordered, locked, duplicated, or deleted. Properties display output pixels; the renderer uses a canonical 360 px canvas. Default post formats export at 3×, while custom dimensions use their selected native resolution.

Right-click canvas elements, blank canvas, layers, pages, template/design cards, or the workspace for custom actions. Visible **⋯** buttons provide the same actions on touch screens. Menus support arrow keys, Escape, and **Shift+F10**; editable fields have custom copy/cut/paste/select-all menus. The contextual toolbar shows the essentials for the selection: font/size/bold/italic/color for text, fill and border for shapes, and fit/crop for photos. **Edit** opens additional styling; **Position** opens alignment and size. Duplicate, delete and stacking actions stay in **⋯** and keyboard shortcuts.

Use **T** to add text, **R** for a rectangle, **O** for a circle, **⌘/Ctrl+D** to duplicate, **⌘/Ctrl+C/X/V** to copy/cut/paste elements, arrow keys to nudge, and **⌘/Ctrl+Z** to undo. The shortcut dialog lists the complete set. Text entry keeps normal typing and clipboard behavior. Images can be uploaded, dropped, or pasted into the workspace.

Older pages keep their original appearance. Choose **Edit individual elements** to convert a page to layers; Undo restores it. New posts from templates start with editable layers. Original legacy fields stay with each page. Legacy photo gradients and blur treatments become editable backdrop/shading layers; research rendering is unchanged.

| Format | Export size |
|---|---|
| Portrait post | 1080 × 1350 px |
| Square post | 1080 × 1080 px |
| Story | 1080 × 1920 px |

Upload JPG, PNG, or WebP images up to 15 MB. The editor resizes uploads to a maximum dimension of 1800 px, compresses them, and saves the resulting image with the design. The built-in template artwork lives in this repository and needs no external image service.

Shapes can contain a photo clipped to their exact outline, including stars, polygons and imported paths. The photo keeps independent cover/contain, crop position, zoom and flip controls while the shape retains its geometry, effects and border. Borders can sit inside, centered on, or outside the outline. Photo fills participate in image loading and resolution checks before export, share deduplicated assets with ordinary images, and survive templates, backups, autosave and version history. Private source notes and provenance stay in editable documents; review snapshots include the displayed photo and crop without those notes.

Select a text layer and choose **Texture** in the toolbar (or **Image texture · choose words** in Edit). Pick words with the selection buttons, choose an existing image or upload one, and review the preview before applying. Repeated words can be selected separately; selecting all fills the entire title. Removing texture from selected words preserves the texture on the remaining words. Word textures reference document assets through rich-text IDs, with up to 30 texture resources per text layer. Export waits for active textures to decode and checks detail against the actual rendered text range. Autosave and backups retain texture sources and word bindings, while public review snapshots omit private metadata and unused word textures.

On touch screens, **Layers → Select multiple** lets you tap individual layers or groups to build a selection. **Done selecting** keeps the selection ready for Group or Position. Text formatting and selection actions occupy separate toolbar rows on small screens so Edit, Texture, Position, and More remain visible.

The current editor supports up to 100 elements per scene, 20 pages per design, 150 designs, 80 custom templates, and 80 folders. Shared master scenes have their own scene limit. Trash continues to occupy workspace capacity until items are permanently removed. Images are deduplicated in storage and save requests: the complete request is limited to 12 MiB, with 64 KiB reserved for operation metadata, and document validation counts repeated image sources once within its 30 MiB character budget. This editor exports still images; the preserved research workspace retains its existing video tools.

## Finding tools

The library opens on **Projects**. Use **Create** for a blank post, carousel or template; **Templates** for a starting layout; and **Brand** for saved assets. Search and sorting stay visible, and active filters can be removed individually. Project type and review filters are remembered when browsing Templates without hiding available layouts. Every card has a **⋯** menu, including delete for all templates. **Library tools** contains Trash, backups and browser recoveries.

Use **Select items → Folder and tags** to organize several projects or templates. **Keep current folders** lets you add tags without moving anything; choose a folder to move the selection, or **No folder** to remove it from folders. On phones, all four workspace tabs remain visible and the link icon opens **Connect agent**.

The editor starts with the canvas and a compact tool rail. One optional drawer opens at a time; click an active tool again or use its close button to return to the canvas. **File** contains saving as a template, captions, review/version history and advanced design tools. **Resize** contains page format, custom sizing and carousel layout. **View** contains rulers, guides, margins and clipping/onion-skin options. The page counter toggles thumbnails; page menus contain duplication, ordering and deletion. On small screens the rail sits below the canvas and tools open in a closable bottom sheet.

**Download** opens format and page selection directly. Resolution, quality and transparency are under **Advanced settings**. Drawing, geometry, effects, reusable resources and template constraints remain available through their relevant expandable sections.

## Continuous carousels, workspace, and layers

Choose **Resize → Layout → Continuous carousel** inside any design, or select it when creating a template. It starts with at least two slides and supports up to 20. All slides share one wide canvas, with visible slice boundaries; images and text can span any number of slides. Add slides at the end. Select an image, open **Resize**, choose **From / Through**, and use **Fill slides** to cover that range with one image. Uploads in this mode retain up to 8192 pixels along their longest edge, subject to the existing embedded-image and library limits.

**Download → All pages** downloads separate numbered images in a ZIP in the selected PNG/JPG/WebP/SVG format, or one multipage PDF. Each image uses the selected resolution. The continuous scene uses exact page-width offsets, so adjoining slices match. Slide dividers, selection outlines, clipping controls, and onion skin are editor guides and never appear in exports. Continuous templates, copies, backups, and autosave retain the shared canvas. Switch back to **Separate slides** to create independent editable copies of crossing layers. Combining existing pages preserves their artwork and backgrounds; it requires at most 100 total layers. Undo restores either conversion. Continuous mode can remove the last boundary down to two slides; its artwork stays on the workspace.

**Clip to canvas** clips layers that overlap the page (including rotated layers), while fully outside layers stay visible and movable in the surrounding scrollable workspace. Turn it off to see all overflow. Exported images always use the page boundaries. **Fit page** returns to the canvas; Layers shows **Outside page → Locate** for parked artwork.

The **Layers** panel includes previews, name/type search, inline rename, show/hide, lock/unlock, multiple selection, drag reordering, move up/down, duplicate, and delete. Double-click a layer name or press **F2** to rename; **Alt+↑/↓** changes stacking order. Hidden layers are omitted from canvas, previews, and exports, but remain saved and can be shown again.

For separate slides, **Onion skin** shows the previous slide behind the current artwork at 5–50% opacity. It is available from slide two on editable-layer pages (convert older layouts with **Edit individual elements**) and helps align text, logos, and other recurring elements. The overlay cannot be selected and is never saved into the artwork or exported.

## Brand kits and reusable elements

Create and switch between up to 20 brand kits. Each kit keeps its name, font, default background/text colors, up to 20 palette colors, and 40 reusable logos/images. Upload PNG, JPG, or WebP files; transparency is preserved. Asset menus support renaming, categorizing as a logo/image, and removal. Removing a kit asset leaves images already used in designs intact.

In any design, open **Brand** to insert a saved logo or image, apply a palette color to selected text/shapes, or apply kit styling to the current page or every page. With nothing selected, a palette swatch changes the page background. Right-click an existing image and choose **Save image to brand kit** to reuse it in other posts. Locked text keeps its styling when applying a kit.

Brand kits and their assets use the same authenticated autosave, local recovery, and JSON backup as designs. Older single-brand libraries migrate automatically. The shared save budget includes each unique embedded image once plus document data; oversized or invalid changes are rejected before replacing the current library or adding undo history.

## Run locally

Use Node 22 and npm. Template editing does not require an OpenAI key.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000), which redirects to `/admin/engine`. With Supabase settings left empty, development opens without sign-in and saves the template library outside the source tree on this computer. On macOS, records live in `~/Library/Application Support/Engine/development/<checkout-hash>/`; Linux uses `~/.local/share/engine/development/` and Windows uses `%LOCALAPPDATA%/Engine/development/`. Each checkout has a separate namespace. Set `ENGINE_DEV_STORAGE_DIR` only to choose a different base directory. Existing `.engine-dev/` records are copied there on first read; the original files remain available as recovery copies. Keeping runtime data outside the checkout prevents saves from triggering development reloads. Add `OPENAI_API_KEY` only if you also want to use research or its AI tools.

## Saving and backups

The current library uses **schema version 2**. Schema-1 backups, browser drafts and saved records migrate on read; save mutations require client protocol 3, so older clients must refresh before writing. Changes autosave through `/api/template-editor`. Saves send changes to individual designs, templates, brand kits and folders, with SHA-256 entity revisions and deduplicated image payloads. Retrying the same operation is idempotent, including when the first successful response was lost. With Supabase configured, the authenticated workspace is stored in `gf_client_state` under a separate `template-editor:` owner namespace. The template library does not replace the existing research workspace's saved data. In development without Supabase, writes use local files; production requires cloud storage and never reports a temporary filesystem write as a successful cloud save.

The browser keeps pending edits and the last confirmed workspace in IndexedDB. Save status distinguishes cloud, local development storage, offline edits and errors. Changes to different documents merge automatically across tabs/devices. Disjoint page and object fields inside one document also merge. Concurrent insertions retain stacking anchors; competing edits and ordering cycles become independent conflict copies; public review links are never inherited by those copies. If a merge would exceed workspace limits, editing pauses and the original browser draft remains available for download. Save requests must match the authenticated owner scope, so changing accounts in another tab cannot move private work into the new account. Offline recovery uses only the owner scope supplied by the authenticated page; it never selects an unrelated last-used account.

Browser drafts use the `engine-template-editor` recovery database. Existing recovery drafts migrate automatically before the editor opens, keeping their owner scope and saved revision. **Library tools → Browser recoveries** lists independent pending snapshots with download and restore-as-copy actions. Recovery drafts retain their confirmed baseline and deduplicate images across the draft and baseline, avoiding false conflicts or resurrected deletions. Older drafts without a baseline require explicit recovery. Transient network, 429 and 5xx failures retry at most five times with exponential jitter and bounded Retry-After; new typing preserves the backoff. Further edits remain recoverable when automatic retry pauses. Reconnecting resumes pending saves; an initial offline opening requires an already loaded/cached application and a confirmed copy for the current authenticated workspace.

**Library tools → Export workspace backup** downloads a JSON workspace containing designs, custom templates, folders, Trash, uploaded images, and every brand kit with its reusable assets. Design/template menus also export an individual editable `.engine.json` package. Imports accept files up to 64 MiB, then validate the normalized document and save budgets; this permits pretty-printed and Unicode backups without raising the actual library limit. **Import backup** adds copies of the imported designs and templates and adds independent copies of imported brand kits, selecting the imported active kit. Imports validate document structure, image URLs, rich text, and library limits before rendering.


## Organize, versions, and review

Posts and template drafts support live collaboration with two or more people.
Open **Live collaboration** in the editor header, copy the editing link, and
open it with other people who have access to the workspace. Their names,
cursors, selections, and object movements appear on the canvas; saved text,
layer, and page changes arrive automatically without reloading. Each person
undoes their own edits. Concurrent plain-text insertions merge, and reconnecting
retains local operations alongside changes made by other participants.

Cloud participants use their authenticated identity. This owner deployment
shares its editing workspace with the addresses configured in `OWNER_EMAIL`;
an editing link does not grant access to someone outside that workspace. The
separate public review link continues to provide snapshot comments. Local
development permits a display name in the collaboration dialog so independent
browser sessions can be distinguished.

Live changes and their shared document state save atomically in the existing
`gf_client_state` record, with no additional database migration. Ordinary
workspace saves retain independent brand/template changes. Publishing a template
keeps its shared draft available so other editors can continue working. Formatted
HTML edits remain atomic to preserve valid styling; unformatted text supports
character-level merging. Named versions, backups, image permissions and review
links keep using the authenticated workspace.

Use folder, favorite and tag filters in the library. Design/template menus open **Folder and tags**; folder management supports adding, renaming and removal without deleting its contents. Deleting an item moves it to **Trash**, where it can be restored or permanently removed. Built-in templates can also be deleted, restored or permanently removed. These choices are saved per workspace and included in backups; deleting a template leaves posts already created from it intact. Built-in template states do not consume the 80-custom-template limit.

**Version history** opens durable server checkpoints. Autosave records a baseline and then checkpoints at most every 30 seconds, up to 30 per design within a shared 20 MiB raw history budget spent on the newest checkpoints globally. Checkpoints for permanently removed documents expire after seven days. Named versions remain part of the document, up to 20 per design. Undo/redo remains the working history while a design is open.

Create a **review link** explicitly from the document workflow. Links are read-only snapshots, expire after 7 days by default (the API permits 1–30 days), and can be revoked by their authenticated owner. The server atomically reserves at most 20 active links per design; idempotent creation and an owner inventory prevent duplicate links and restored versions from losing revocation decisions. The compact inventory retains expired/revoked entries, with a lifetime limit of 10,000 per workspace. The snapshot excludes editor provenance, internal comments/versions, hidden and parked artwork, layer names, slots and private image metadata. An anonymized group tree preserves opacity compositing; intentionally public image/page descriptions and reading order remain available to assistive readers. Visible remote images are frozen as embedded WebP assets using bounded requests that reject private network addresses and revalidate redirects. Review links therefore do not expose the authenticated image proxy. Reviewers can add up to 100 comments, each up to 2,000 characters, with a two-second minimum between submissions. Reviewers can reply in threads and pin an object or a page point. Public feedback and expanded owner review panels refresh incrementally every five seconds while visible; closing a panel aborts its pending requests. Feedback queries select comment/revision fields rather than fetching snapshot assets; owners can resolve/reopen complete threads, import feedback, and revoke the link.

Review storage shares the existing `gf_client_state` infrastructure in a separate namespace; development uses private local files. Production requires configured cloud storage. Review tokens contain 256 random bits; lookup keys use their SHA-256 hashes. No credentials or internal workspace fields are included in the public response.

## Export limits and compatibility

Raster exports have a 40-megapixel limit per page and a 16,384-pixel maximum dimension. Export scale ranges from 0.25 to 24 canonical pixels. Large custom canvases can be exported at a lower resolution when their native size exceeds these limits. PNG/WebP/SVG support a transparent page background; JPG and PDF are opaque. JPEG and WebP quality ranges from 10% to 100%.

PDF offers a document mode with selectable tagged text, embedded fonts and vector basics, plus a picture mode with selectable semantic text. Complex text styling, compositing, textures and effects use the rendered page to preserve appearance. Choose a physical width (10–2000 mm), picture DPI (72–600), bleed (0–10 mm) and crop marks. Explicit public reading order and page descriptions become PDF structure tags. Colors remain RGB; no CMYK press profile is supplied. PDF pages fit within 200 inches. SVG preserves the styled canvas through SVG/HTML `foreignObject`, with embedded images/fonts, and is intended for compatible web viewers. Use editable `.engine.json` packages to transfer complete designs/templates between Engine workspaces. One page mounts and captures at a time. Downloads can use batches of 1–10 pages rather than retaining every rendered page. Private originals use lossless owner-scoped renditions sized for output DPI, crop and zoom, without changing saved sources/previews. Image resources have a shared 64-megapixel decode budget per page, checked before mounting; a PDF batch also enforces this budget on normalized images. Each output/archive has a 64 MiB aggregate byte limit; PDF rendering requests have a 23 MiB client budget and a 24 MiB server bound, with at most 16 MiB per raster snapshot. Hashing, patch preparation and large request serialization run in a bounded worker; immutable entities retain their validation/cost caches. ZIP compression has its own progress stage, and cancellation prevents a download from being issued after the job is cancelled.

## Research workspace

The original story research and curation experience remains at `/admin/engine/research`, linked from the template studio sidebar. Its story feed, research engine, sources, image search, channels, scheduling integrations, and existing exports are preserved. **Open in post editor** transfers selected still images, per-slide styling and the current caption into an independent editable post; the original research remains available. The main entry point now opens the template editor.

Research uses `gpt-5.4` by default; chat and image review use `gpt-5.4-mini`. Override these through `OPENAI_RESEARCH_MODEL`, `OPENAI_CHAT_MODEL`, and `OPENAI_VISION_MODEL` when appropriate for your API project.

## Tests and validation

```sh
npm run test:template-editor
npm run test:template-editor:recovery
npm run test:template-editor:collaboration
npm run lint
npm run build
```

The template-editor tests use Node's built-in test runner and the installed TypeScript compiler. They load the real model and persistence modules; authentication and database boundaries are replaced with controlled fixtures. No API keys or live database are required. The browser storage checks use the installed Playwright development dependency and a real Chrome/Chromium executable. Coverage includes independent design copies, template round trips, import validation, unsafe rich text, owner isolation, concurrent saves, API access, request limits, brand migrations and asset validation, and immutable selection commands with locked-layer protection. Additional checks cover entity merges, stable hashes across schema normalization, idempotent retries, owner-scope changes, legacy-client rejection, deduplicated assets and forged-hash rejection, durable checkpoints, PDF binary cross references, export option validation/cancellation, review privacy, revocation and protected image fetching.

**Recovery acceptance** runs `npm run test:template-editor:recovery`. It requires a real browser and fails when the runner/browser is unavailable; it cannot pass by skipping checks. The harness uses native IndexedDB on a blank loopback origin, separate contexts and a temporary browser profile. It does not automate the application UI or access the user's profile. A cached Playwright Chromium or installed Chrome/Chromium is detected automatically; set `ENGINE_BROWSER_PATH` to another installed executable when needed. On CI without a browser, install Playwright Chromium as part of CI setup.

To make the entire Node suite require these browser checks on this Mac:

```sh
ENGINE_REQUIRE_BROWSER=1 ENGINE_BROWSER_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:template-editor
```

The twelve recovery cases cover migration races, owner isolation, failed writes, unreadable records, a baseline and shared image surviving reload, and preserving valid pending artwork when its baseline is corrupt. A corrupt baseline is excluded from automatic merge input; the original stored record remains intact. The general unit command can still report browser checks as skipped on environments without browser tooling, so release acceptance also requires the strict command above.

For a browser check, create a carousel, edit text and imagery, reorder pages, reopen the design after a reload, save it as a template, and export each of the three formats. Check the exported dimensions and appearance as well as the save status.

**Live collaboration acceptance** uses three independent real browser contexts
against the actual application. Start an isolated server with a disposable
`ENGINE_DEV_STORAGE_DIR`, Supabase disabled, and `NEXT_PUBLIC_SITE_URL` matching
the loopback origin, then run `npm run test:template-editor:collaboration`.
The default origin is `http://127.0.0.1:3121`; override it with
`ENGINE_COLLABORATION_BASE_URL`. The strict test checks posts and template drafts,
live cursors/selections and canvas changes, concurrent text edits, individual
undo/redo, offline reconnection, durable reload and owner-scope rejection. A real
Chrome/Chromium is required; unavailable tooling fails instead of skipping.

## Architecture

| Responsibility | Location |
|---|---|
| Default studio route and shared fonts/styles | `app/admin/(tool)/engine/` |
| Template library, designs, brand kit, canvas editor | `components/template-editor/` |
| Design model, built-in templates, import validation | `lib/template-editor/model.ts` |
| Browser autosave and recovery | `lib/template-editor/use-library.ts` |
| Cloud/local persistence and revision conflicts | `lib/template-editor/persistence.ts` |
| Authenticated template-library API | `app/api/template-editor/route.ts` |
| PNG and carousel ZIP export | `lib/template-editor/export.ts` |
| Original template artwork | `public/template-editor/` |
| Shared slide rendering and inline rich text | `components/engine/slide-templates.tsx`, `rich-text.tsx` |
| Preserved research route | `app/admin/(tool)/engine/research/` |
| Research UI, engine, prompts, and media tools | `components/engine/`, `lib/engine/` |
| Research API routes | `app/api/engine/` |
| Instagram connection | `app/api/instagram/`, `app/admin/instagram-setup/` |
| Database migrations | `supabase/migrations/` |
| Template model and persistence test entry points | `tests/template-editor-*.test.mjs` |

## GitHub Pages frontend with Render and Supabase

`npm run build:pages` builds a separate static application in `frontend/out`, reusing the same editor, fonts, and renderer. Set `ENGINE_API_URL` to the verified Render backend origin and `ENGINE_PAGES_BASE_PATH=/engine`. No database credentials are included in the frontend. The backend serves configuration containing only the Supabase public URL and publishable key.

The static client keeps a renewable Supabase session. Its service worker forwards editor API requests, original images, and collaboration streams to the configured backend using bearer authentication; it never stores tokens, caches private API responses, or forwards authentication to other hosts. The backend validates every session with Supabase and retains the existing owner allowlist. Sign-in runs in a same-origin Render popup and transfers the validated session to the exact configured Pages origin. Pending browser recovery records on that sign-in origin are copied before mounting the editor and use the existing reconciliation rules.

The production split uses `https://chatgptricks.github.io/engine/` for the editor and the existing `greatful-independent` Render service for its backend. Set `ENGINE_FRONTEND_URL=https://chatgptricks.github.io/engine/` on that service. Reusing its Supabase configuration, owner allowlist, licensed-font key, and sign-in callback keeps the same cloud workspace and lets the sign-in popup carry pending browser recovery records from the existing origin to Pages.

For an optional new backend, deploy `render.yaml` in the intended Render workspace and copy the existing Supabase configuration and licensed-font key. Keep the database and `OWNER_EMAIL` unchanged. Set `NEXT_PUBLIC_SITE_URL` to the new backend URL and add its `/admin/auth/callback` URL in Supabase Auth. Copy optional integration secrets if those features are used. Keep the previous service available until cloud data, pending local edits, sign-in and exports have been verified. Browser-only edits on a different previous origin must be saved there or restored from its backup before switching; moving the server does not move a browser's IndexedDB.

Enable GitHub Pages with **GitHub Actions** and set the repository variable `ENGINE_API_URL` to the backend origin (`https://greatful-independent.onrender.com` for production). The Pages workflow waits for Render to report the exact source commit before publishing. It fetches only the existing public licensed fonts and checks their repository-pinned SHA-256 hashes; secret keys and raw font sources stay out of Git. An unset backend variable skips publishing, and a failed release leaves the previous site intact. Review and research pages remain on Render; editor and agent links use the appropriate frontend/backend origin.

Local split-host verification: start the backend with `ENGINE_FRONTEND_URL=http://localhost:4180`, build with `ENGINE_API_URL=http://localhost:3018`, then serve `frontend/out` at `/engine/` on port 4180. Local auth bypass is accepted only for a backend that reports development mode on localhost.

## Deploy this independent copy on Render

The existing production editor is [Engine on Render](https://greatful-independent.onrender.com/admin/engine). Its Render service follows `chatgptricks/engine`, branch `main`, with automatic deployments. Update that service to deploy this project; a second service is unnecessary.

For another independent copy, create a **new Supabase project** and run `supabase/migrations/0014` through `0018` in order in its SQL editor. Migration `0017` supplies `gf_client_state` for both the preserved research state and the separately namespaced template library; `0018` sets the server query deadline for large designs. Configure the site URL and allowed redirect URL in Supabase Auth for its one-time sign-in links. Set allowed owner emails with `OWNER_EMAIL`.

The Render **Web Service** uses Node 22, builds with `npm ci && npm run build`, and starts directly with `node --max-old-space-size=192 node_modules/next/dist/bin/next start` to avoid retaining an npm parent process. `npm run start` runs the same Node command locally. This caps V8 old-space at 192 MiB so garbage collection runs before the 512 MiB service limit is exhausted; this leaves room for native buffers and does not constrain the build. Image-heavy workspace operations share one process-wide queue, while database revision checks still protect saves across instances. Configure these environment variables when setting up a new service:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the new Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key of the new project |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key of the new project; keep secret |
| `OWNER_EMAIL` | Allowed owner email, such as `esteban@sentientagency.io`; commas separate multiple addresses |
| `NEXT_PUBLIC_SITE_URL` | This service's public URL, such as `https://your-service.onrender.com` |
| `OPENAI_API_KEY` | Separate secret API key for optional research, chat, and image review |

The build restores licensed fonts from the encrypted `assets/licensed-fonts.enc` before Next.js compiles. Provide its 32-byte key encoded as base64 in a Render secret file named `engine-fonts-key` (mounted at `/etc/secrets/engine-fonts-key`), or in the secret environment variable `ENGINE_FONT_BUNDLE_KEY`. The configured production service uses the secret file. Keep the key and raw fonts out of Git. Render builds fail if the key is missing, invalid, or cannot authenticate the bundle; local builds without a key retain installed fonts or use system fallbacks. See [font provisioning](public/fonts/licensed/README.md) for the bundle format.

Production requires Supabase Auth and durable cloud storage. A missing configuration does not open the studio publicly or enable local-file saving. Owners share the owner workspace; optional members have separate workspace partitions. Render's service filesystem is temporary, so it is not the production design store. Subscription access remains disabled unless explicitly enabled.

Apply `supabase/migrations/0018_editor_storage_timeout.sql` for image-heavy collaborative designs. It gives trusted server queries a 30-second database deadline; the application also bounds complete reads at 30 seconds and writes at 45 seconds. The migration was applied to the existing production project on October 22, 2026 after saves hit SQLSTATE `57014` under the inherited 8-second limit. See [Supabase role timeouts](https://supabase.com/docs/guides/database/postgres/timeouts#role-level).

`vercel.json` is only for Vercel; Render does not run its cron schedule. Configure a separate scheduler or Render cron job if scheduled research is needed.

## Optional integrations

See `.env.example` for configuration. These are not required for template editing:

- **Scheduled research:** Supabase, `CRON_SECRET`, and an external scheduler. On Vercel, `vercel.json` schedules the research cron hourly.
- **Image search:** `APIFY_TOKEN` enables “Find images on X”; Google Custom Search keys enable another image source in research.
- **Large research uploads:** `BLOB_READ_WRITE_TOKEN` enables Vercel Blob storage for uploads beyond the existing video limit.
- **Instagram channels:** configure a Meta app through `/admin/instagram-setup`.
- **Paid memberships:** disabled for this owner deployment. Enabling access later requires `GF_ENABLE_MEMBERS=true`, `STRIPE_SECRET_KEY`, `GF_STRIPE_PRICE_ID`, and `UNLOCK_SECRET`.

## Fonts

Licensed font files stay outside Git in `public/fonts/licensed/`, using the filenames documented there. The production build privately provisions SF Pro Display and the reference Canva faces from an authenticated encrypted bundle. GT Walsheim, GT Walsheim Condensed, PP Kyoto, and Century Gothic can also use separately supplied licensed copies; missing faces fall back to system fonts. Open-source fonts are included locally.

## Working together

Use a branch for each change and open a pull request into `main`.

```sh
git checkout -b codex/your-change
git push -u origin codex/your-change
```
