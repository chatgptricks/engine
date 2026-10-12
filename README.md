# Engine

A visual canvas editor for creating social posts, carousels, and reusable templates. Start blank or choose a defined design, then arrange independent text, image, and shape layers directly on the canvas.

The editor opens at `/admin/engine`, the research workspace at `/admin/engine/research`, and research API routes use `/api/engine`.

This repository is an independent copy with its own Git history. Configure service accounts and environment variables for this copy; do not reuse credentials, databases, or deployments from the source project.

Built with Next.js 16, React 19, and Tailwind v4. The editor retains the established Engine fonts, artwork, image handling, authentication, and persistence. One shared canvas renderer powers editing, library previews, and PNG exports.

## Create a post

1. Choose **New design** for a blank canvas, pick one of eight built-in templates, or start from **My templates**.
2. Add independent text boxes, images, rectangles, circles, or lines. Double-click text to type directly; drag to move, use handles to resize, and rotate with the rotation handle. Center guides help align objects. Shift-click adds to a selection; drag across empty canvas to select several elements together.
3. Add, duplicate, reorder, or remove pages. Undo and redo changes while the design is open. Save fonts, palettes, logos, and images in **Brand kits**, then reuse them from the editor’s **Brand** tab.
4. Use **Save as template** to keep the complete design as a starting point for future posts. Copies receive independent page and image identities.
5. Choose **Export** for PNG, JPG, WebP, multipage PDF, or an SVG for web viewers. Select the current page, all pages, or a range such as `1, 3-5`; choose resolution and image quality, and remove the background for PNG, WebP, or SVG. Multiple image pages download as a ZIP with numbered files and the caption when present. Captions can also be downloaded separately as TXT. Export checks fonts, image loading and resolution, and can be cancelled.

## Build your own template

Choose **Create template**, enter a name, and select portrait, square, or Story format. The editor opens an empty canvas. Add text boxes, images, and shapes, position each element, and arrange pages manually. Uploaded images become independent layers and can also replace a selected image.

Template drafts autosave and can be resumed from **My templates** or **Your designs**. **Save template** places the finished template in **My templates**. Use a custom template's **Edit template** action to reopen it, then **Update template** to replace that template. Existing posts remain independent of future template edits.

## Canvas tools

Select an element to open contextual properties: font, size, bold, italic, underline, uppercase/lowercase, text alignment, letter and line spacing, colors, opacity, rotation, and exact position and dimensions. Image controls include fill/fit, crop position, and corner radius; shapes include fill, border, and radius. Alignment actions place objects against page edges or center. Layers can be reordered, locked, duplicated, or deleted. Properties display output pixels; the renderer uses a canonical 360 px canvas. Default post formats export at 3×, while custom dimensions use their selected native resolution.

Right-click canvas elements, blank canvas, layers, pages, template/design cards, or the workspace for custom actions. Visible **⋯** buttons provide the same actions on touch screens. Menus support arrow keys, Escape, and **Shift+F10**; editable fields have custom copy/cut/paste/select-all menus. The quick toolbar keeps font, size, bold, italic, underline, uppercase, alignment, color, duplicate, and delete within reach.

Use **T** to add text, **R** for a rectangle, **O** for a circle, **⌘/Ctrl+D** to duplicate, **⌘/Ctrl+C/X/V** to copy/cut/paste elements, arrow keys to nudge, and **⌘/Ctrl+Z** to undo. The shortcut dialog lists the complete set. Text entry keeps normal typing and clipboard behavior. Images can be uploaded, dropped, or pasted into the workspace.

Older pages keep their original appearance. Choose **Edit individual elements** to convert a page to layers; Undo restores it. New posts from templates start with editable layers. Original legacy fields stay with each page. Legacy photo gradients and blur treatments become editable backdrop/shading layers; research rendering is unchanged.

| Format | Export size |
|---|---|
| Portrait post | 1080 × 1350 px |
| Square post | 1080 × 1080 px |
| Story | 1080 × 1920 px |

Upload JPG, PNG, or WebP images up to 15 MB. The editor resizes uploads to a maximum dimension of 1800 px, compresses them, and saves the resulting image with the design. The built-in template artwork lives in this repository and needs no external image service.

Shapes can contain a photo clipped to their exact outline, including stars, polygons and imported paths. The photo keeps independent cover/contain, crop position, zoom and flip controls while the shape retains its geometry, effects and border. Borders can sit inside, centered on, or outside the outline. Photo fills participate in image loading and resolution checks before export, share deduplicated assets with ordinary images, and survive templates, backups, autosave and version history. Private source notes and provenance stay in editable documents; review snapshots include the displayed photo and crop without those notes.

Text can use an image texture across a whole title or individual selected words. Word textures reference document assets through rich-text IDs, with up to 30 texture resources per text layer. Crop and fit controls belong to each texture; export waits for active textures to decode and checks detail against the actual rendered text range. Autosave and backups retain texture sources and word bindings, while public review snapshots omit private metadata and unused word textures.

The current editor supports up to 100 elements per scene, 20 pages per design, 150 designs, 80 custom templates, and 80 folders. Shared master scenes have their own scene limit. Trash continues to occupy workspace capacity until items are permanently removed. Images are deduplicated in storage and save requests: the complete request is limited to 12 MiB, with 64 KiB reserved for operation metadata, and the raw in-memory JSON has a 30 MiB character limit. This editor exports still images; the preserved research workspace retains its existing video tools.

## Continuous carousels, workspace, and layers

Choose **Layout → Continuous carousel** inside any design, or select it when creating a template. It starts with at least two slides and supports up to 20. All slides share one wide canvas, with visible slice boundaries; images and text can span any number of slides. Add slides at the end. Select an image, choose **From / Through**, and use **Fill slides** to cover that range with one image. Uploads in this mode retain up to 8192 pixels along their longest edge, subject to the existing embedded-image and library limits.

**Export → All pages** downloads separate numbered images in a ZIP in the selected PNG/JPG/WebP/SVG format, or one multipage PDF. Each image uses the selected resolution. The continuous scene uses exact page-width offsets, so adjoining slices match. Slide dividers, selection outlines, clipping controls, and onion skin are editor guides and never appear in exports. Continuous templates, copies, backups, and autosave retain the shared canvas. Switch back to **Separate slides** to create independent editable copies of crossing layers. Combining existing pages preserves their artwork and backgrounds; it requires at most 100 total layers. Undo restores either conversion. Continuous mode can remove the last boundary down to two slides; its artwork stays on the workspace.

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

The current library uses **schema version 2**. Schema-1 backups, browser drafts and saved records migrate on read; older clients cannot overwrite a schema-2 workspace and must refresh. Changes autosave through `/api/template-editor`. Saves send changes to individual designs, templates, brand kits and folders, with SHA-256 entity revisions and deduplicated image payloads. Retrying the same operation is idempotent, including when the first successful response was lost. With Supabase configured, the authenticated workspace is stored in `gf_client_state` under a separate `template-editor:` owner namespace. The template library does not replace the existing research workspace's saved data. In development without Supabase, writes use local files; production requires cloud storage and never reports a temporary filesystem write as a successful cloud save.

The browser keeps pending edits and the last confirmed workspace in IndexedDB. Save status distinguishes cloud, local development storage, offline edits and errors. Changes to different documents merge automatically across tabs/devices. Divergent edits to the same document become independent conflict copies; public review links are never inherited by those copies. If a merge would exceed workspace limits, editing pauses and the original browser draft remains available for download. Save requests must match the authenticated owner scope, so changing accounts in another tab cannot move private work into the new account. Offline recovery uses only the owner scope supplied by the authenticated page; it never selects an unrelated last-used account.

Browser drafts use the `engine-template-editor` recovery database. Existing recovery drafts migrate automatically before the editor opens, keeping their owner scope and saved revision. **Workspace menu → Browser recoveries** lists independent pending snapshots with download and restore-as-copy actions. Reconnecting resumes pending saves; an initial offline opening requires an already loaded/cached application and a confirmed copy for the current authenticated workspace.

**Your designs → Backup** downloads a JSON workspace containing designs, custom templates, folders, Trash, uploaded images, and every brand kit with its reusable assets. Design/template menus also export an individual editable `.engine.json` package. Imports accept files up to 64 MiB, then validate the normalized document and save budgets; this permits pretty-printed and Unicode backups without raising the actual library limit. **Import backup** adds copies of the imported designs and templates and adds independent copies of imported brand kits, selecting the imported active kit. Imports validate document structure, image URLs, rich text, and library limits before rendering.


## Organize, versions, and review

Use folder, favorite and tag filters in the library. Design/template menus open **Folder and tags**; folder management supports adding, renaming and removal without deleting its contents. Deleting an item moves it to **Trash**, where it can be restored or permanently removed. Built-in templates can also be deleted, restored or permanently removed. These choices are saved per workspace and included in backups; deleting a template leaves posts already created from it intact. Built-in template states do not consume the 80-custom-template limit.

**Version history** opens durable server checkpoints. Autosave records a baseline and then checkpoints at most every 30 seconds, up to 30 per design within a shared 20 MiB raw history budget. Named versions remain part of the document, up to 20 per design. Undo/redo remains the working history while a design is open.

Create a **review link** explicitly from the document workflow. Links are read-only snapshots, expire after 7 days by default (the API permits 1–30 days), and can be revoked by their authenticated owner. A design can keep up to 20 links. The snapshot excludes editor provenance, internal comments/versions, hidden and parked artwork, layer names, slots, groups and private image metadata. Visible remote images are frozen as embedded WebP assets using bounded requests that reject private network addresses and revalidate redirects. Review links therefore do not expose the authenticated image proxy. Reviewers can add up to 100 comments, each up to 2,000 characters, with a two-second minimum between submissions. Owners import that feedback into the document and can revoke the link.

Review storage shares the existing `gf_client_state` infrastructure in a separate namespace; development uses private local files. Production requires configured cloud storage. Review tokens contain 256 random bits; lookup keys use their SHA-256 hashes. No credentials or internal workspace fields are included in the public response.

## Export limits and compatibility

Raster exports have a 40-megapixel limit per page and a 16,384-pixel maximum dimension. Export scale ranges from 0.25 to 24 canonical pixels. Large custom canvases can be exported at a lower resolution when their native size exceeds these limits. PNG/WebP/SVG support a transparent page background; JPG and PDF are opaque. JPEG and WebP quality ranges from 10% to 100%.

PDF embeds each rendered page as an RGB JPEG, keeping multipage layout and page order; it is an appearance-preserving document rather than a vector print file. SVG preserves the styled canvas through SVG/HTML `foreignObject`, with embedded images/fonts, and is intended for compatible web viewers. Use editable `.engine.json` packages to transfer complete designs/templates between Engine workspaces. ZIP compression has its own progress stage, and cancellation prevents a download from being issued after the job is cancelled.

## Research workspace

The original story research and curation experience remains at `/admin/engine/research`, linked from the template studio sidebar. Its story feed, research engine, sources, image search, channels, scheduling integrations, and existing exports are preserved. **Open in post editor** transfers selected still images, per-slide styling and the current caption into an independent editable post; the original research remains available. The main entry point now opens the template editor.

Research uses `gpt-5.4` by default; chat and image review use `gpt-5.4-mini`. Override these through `OPENAI_RESEARCH_MODEL`, `OPENAI_CHAT_MODEL`, and `OPENAI_VISION_MODEL` when appropriate for your API project.

## Tests and validation

```sh
npm run test:template-editor
npm run lint
npm run build
```

The template-editor tests use Node's built-in test runner and the installed TypeScript compiler. They load the real model and persistence modules; authentication and database boundaries are replaced with controlled fixtures. No API keys, live database, or additional test dependencies are required. Coverage includes independent design copies, template round trips, import validation, unsafe rich text, owner isolation, concurrent saves, API access, request limits, brand migrations and asset validation, and immutable selection commands with locked-layer protection. Additional checks cover entity merges, stable hashes across schema normalization, idempotent retries, owner-scope changes, legacy-client rejection, deduplicated assets and forged-hash rejection, durable checkpoints, PDF binary cross references, export option validation/cancellation, review privacy, revocation and protected image fetching.

Recovery migration checks use isolated browser contexts when Playwright is available. Set `ENGINE_BROWSER_PATH` to an installed Chromium executable if needed. Environments without browser tooling skip these additional checks.

For a browser check, create a carousel, edit text and imagery, reorder pages, reopen the design after a reload, save it as a template, and export each of the three formats. Check the exported dimensions and appearance as well as the save status.

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

## Deploy this independent copy on Render

Create a **new Supabase project** for this copy. Run `supabase/migrations/0014` through `0017` in order in its SQL editor. Migration `0017` supplies `gf_client_state` for both the preserved research state and the separately namespaced template library; no additional template-editor table is required. Configure the site URL and allowed redirect URL in Supabase Auth for its one-time sign-in links. Set allowed owner emails with `OWNER_EMAIL`.

Create a Render **Web Service** from `chatgptricks/engine`, branch `main`, using Node 22. Build with `npm ci && npm run build` and start with `npm run start`. Configure these environment variables before deployment:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL of the new Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key of the new project |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key of the new project; keep secret |
| `OWNER_EMAIL` | Allowed owner email, such as `esteban@sentientagency.io`; commas separate multiple addresses |
| `NEXT_PUBLIC_SITE_URL` | This service's public URL, such as `https://your-service.onrender.com` |
| `OPENAI_API_KEY` | Separate secret API key for optional research, chat, and image review |

Production requires Supabase Auth and durable cloud storage. A missing configuration does not open the studio publicly or enable local-file saving. Owners share the owner workspace; optional members have separate workspace partitions. Render's service filesystem is temporary, so it is not the production design store. Subscription access remains disabled unless explicitly enabled.

`vercel.json` is only for Vercel; Render does not run its cron schedule. Configure a separate scheduler or Render cron job if scheduled research is needed.

## Optional integrations

See `.env.example` for configuration. These are not required for template editing:

- **Scheduled research:** Supabase, `CRON_SECRET`, and an external scheduler. On Vercel, `vercel.json` schedules the research cron hourly.
- **Image search:** `APIFY_TOKEN` enables “Find images on X”; Google Custom Search keys enable another image source in research.
- **Large research uploads:** `BLOB_READ_WRITE_TOKEN` enables Vercel Blob storage for uploads beyond the existing video limit.
- **Instagram channels:** configure a Meta app through `/admin/instagram-setup`.
- **Paid memberships:** disabled for this owner deployment. Enabling access later requires `GF_ENABLE_MEMBERS=true`, `STRIPE_SECRET_KEY`, `GF_STRIPE_PRICE_ID`, and `UNLOCK_SECRET`.

## Fonts

Four slide fonts—GT Walsheim, GT Walsheim Condensed, PP Kyoto, and Century Gothic—are commercial, so their files are not in this repository. Put your licensed copies in `public/fonts/licensed/`, using the filenames documented there. Without them, those options fall back to system fonts. The other fonts are open source and included locally.

## Working together

Use a branch for each change and open a pull request into `main`.

```sh
git checkout -b codex/your-change
git push -u origin codex/your-change
```
