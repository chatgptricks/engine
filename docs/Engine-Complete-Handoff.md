# Engine — complete project handoff and access guide

Updated **October 29, 2026**. **Share only this Markdown file. No separate bundle, patch or checksum attachment is required.**

The complete code, Git history, local design-system notes, and this guide are available in a dedicated GitHub handoff branch. This document includes direct service access links, actual public connection settings, local setup, architecture, testing, data/font transfer and deployment instructions.

Public connection settings are included. Private server/provider/font keys, passwords and session tokens are obtained through authorized service accounts, not embedded in this shareable file.

## 1. Complete source

| Purpose | Location / version |
|---|---|
| Complete handoff source | https://github.com/chatgptricks/engine/tree/codex/project-handoff-2026-10-29 |
| Application code checkpoint included | `bbcd16cc9e7c0645c10be3366d69e306c1bb8114` — October 27 smart templates |
| Production / default GitHub branch | `main` — `3597332e7ff83a973b6f5cb531b9c5ee55c5371b` |
| Main editor | https://chatgptricks.github.io/engine/ |
| Backend | https://greatful-independent.onrender.com |
| Backend version | https://greatful-independent.onrender.com/api/engine/version |
| Pages version | https://chatgptricks.github.io/engine/version.json |

The handoff branch includes the latest local Smart Templates work, which is newer than production, plus documentation and the previously local `CLAUDE.md` / `design-system/` notes. A normal clone of `main` does not include that application commit.

The source is public and can be cloned without an invitation. Production records, private original media, unsaved browser edits and font secrets are separate from source; see sections 4 and 5.

The production version endpoints returned HTTP 200 with the production SHA above on October 29. This establishes deployed code, not a new authenticated save or billing audit.

## 2. Access directory

### Direct service links

| Access | URL |
|---|---|
| Engine editor | https://chatgptricks.github.io/engine/ |
| Backend sign-in | https://greatful-independent.onrender.com/admin/login |
| Research workspace | https://greatful-independent.onrender.com/admin/engine/research |
| GitHub source | https://github.com/chatgptricks/engine |
| GitHub collaborator invitations | https://github.com/chatgptricks/engine/settings/access |
| GitHub Actions | https://github.com/chatgptricks/engine/actions |
| Pages deployment workflow | https://github.com/chatgptricks/engine/actions/workflows/pages.yml |
| Pages settings | https://github.com/chatgptricks/engine/settings/pages |
| Build variables | https://github.com/chatgptricks/engine/settings/variables/actions |
| Render backend service | https://dashboard.render.com/web/srv-das9ogt9fdbs73cgig4g |
| Render configuration | https://dashboard.render.com/web/srv-das9ogt9fdbs73cgig4g/settings |
| Render environment / secret configuration | https://dashboard.render.com/web/srv-das9ogt9fdbs73cgig4g/env |
| Render logs | https://dashboard.render.com/web/srv-das9ogt9fdbs73cgig4g/logs |
| Render deployments | https://dashboard.render.com/web/srv-das9ogt9fdbs73cgig4g/deploys |
| Supabase project | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx |
| Supabase API keys | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx/settings/api-keys |
| Supabase Auth redirects | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx/auth/url-configuration |
| Supabase Auth users | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx/auth/users |
| Supabase email / SMTP | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx/auth/smtp |
| Supabase SQL editor | https://supabase.com/dashboard/project/vmizejpnzlrotvknnoqx/sql/new |

Dashboard links require a signed-in account with the appropriate permission. A link itself does not grant access. GitHub settings may return 404 to accounts without settings access.

### Actual public connection configuration

Verified from the existing backend's public configuration. This is the production reference, **not the blank local-development configuration**.

~~~dotenv
NEXT_PUBLIC_SUPABASE_URL=https://vmizejpnzlrotvknnoqx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_vcPmh1655vollqvbjiUYSA_ZPEYSuKa
NEXT_PUBLIC_SITE_URL=https://greatful-independent.onrender.com
ENGINE_FRONTEND_URL=https://chatgptricks.github.io/engine/
ENGINE_API_URL=https://greatful-independent.onrender.com
ENGINE_PAGES_BASE_PATH=/engine
~~~

The publishable key is public application configuration. It does not grant dashboard access, bypass Row Level Security, or put an email on Engine's owner allowlist. [Supabase key types](https://supabase.com/docs/guides/getting-started/api-keys)

### Recipient access status

| Access | Status |
|---|---|
| Read/clone all current source | Available through the public handoff branch |
| Work locally without cloud credentials | Available immediately with section 3 |
| Push to the owner's GitHub repository | Requires the recipient's GitHub username and accepted collaborator invitation |
| Render dashboard/configuration | Requires the recipient's Render account email and workspace invitation |
| Supabase dashboard/SQL | Requires the recipient's Supabase account email and selected organization role |
| Shared production Engine workspace | Requires the recipient's email in `OWNER_EMAIL` |
| Exact font files/key and optional provider secrets | Obtain privately through the authorized accounts when required |

Engine uses a one-time sign-in link sent to an allowed email. There is no shared Engine username/password.

### Owner: grant access before expecting independent production work

Ask the developer for their GitHub username, Render account email, Supabase account email, and desired Engine sign-in email. Use their own accounts.

| Access | Owner action | What it enables |
|---|---|---|
| Source read / local development | Send this single guide; the full handoff branch is public | Clone, run locally, inspect and change code |
| Contributing to the existing repository | Invite their GitHub account as a collaborator through repository Settings → Collaborators → Add people; they must accept | Push feature branches and submit work; settings/admin operations may still require the owner |
| Backend operations | Invite their account to the **existing** Render workspace; Developer is normally sufficient for engineering | Deployments, logs, service configuration, and sensitive environment access, subject to protected-environment restrictions |
| Database operations | Invite their Supabase account to the existing organization's team | Developer for project content; Administrator if their duties require project settings such as Auth configuration |
| Existing Engine workspace | Append their email to Render's comma-separated `OWNER_EMAIL`, preserving existing entries; deploy the configuration change | Sign in through Engine using their own Supabase email link |
| Exact font fidelity | Give them authorized access to the font bundle key or appropriately licensed files through a private channel | Match the production typography and build the backend with its licensed font bundle |
| Production content for local/staging work | Share an authorized fresh workspace backup privately | Reproduce the curated templates, designs, brand kit, and embedded media locally |

**Important distinctions:**

- All emails in `OWNER_EMAIL` share the **same owner workspace**. This grants broad access to the existing templates/designs; it does not create a separate personal workspace.
- GitHub, Render, Supabase, app sign-in, and agent access are separate permissions.
- Supabase Free organization invitations are organization-wide. Project-scoped roles require Team/Enterprise, so an invitation can also expose other projects in the organization. Choose the role deliberately; no plan upgrade is required by this handoff.
- Render workspace invitations require Pro or higher. Paid service compute alone does not establish the workspace plan. Verify the existing workspace; if invitations are unavailable on Hobby, the owner retains backend operations until a separate workspace-plan change is authorized. This handoff does not authorize an upgrade.
- Render Developer access includes sensitive service configuration. Use it for a trusted engineer. Do not share the owner's login or browser session.
- If the recipient only needs to develop locally, infrastructure invitations and production secrets are unnecessary.

Provider instructions: [GitHub collaborator invitations](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository), [Render workspace roles](https://render.com/docs/team-members), [Supabase access control](https://supabase.com/docs/guides/platform/access-control).

No invitations, allowlist changes, subscription changes, or production deployments were performed. A dedicated source handoff branch is published separately.

## 3. Developer: clone everything and run locally

Requirements: **Git, Node.js 22.x, and npm**. Commands use a macOS/Linux/Git Bash shell.

~~~sh
git clone --branch codex/project-handoff-2026-10-29 https://github.com/chatgptricks/engine.git engine
cd engine
git merge-base --is-ancestor bbcd16cc9e7c0645c10be3366d69e306c1bb8114 HEAD
git switch -c codex/your-task
npm ci
cp .env.example .env.local
npm run dev
~~~

The ancestor check exits successfully when the current application code is included. The branch tip additionally contains this guide and the local authoring notes.

Open **http://localhost:3000/admin/engine**. Leave all Supabase values blank in `.env.local` for development-only local-file-backed editing. No OpenAI key is required for the editor or Engine agent bridge. Do not paste the production connection block into local development unless production-connected access is intentional.

The template library initially uses source defaults; importing an authorized content backup reproduces the curated production library. See section 5.

The authoring notes are already in the clone: `CLAUDE.md`, `design-system/PRINCIPIOS-DE-DISENO.md`, and `design-system/design-system.css`. No patch is required.

### Production-only development instead

To intentionally exclude the newer Smart Templates work, clone `main` instead:

~~~sh
git clone --branch main https://github.com/chatgptricks/engine.git engine
~~~

### Git workflow

Use `codex/<task-name>` branches and submit reviewed pull requests. Without repository write permission, develop locally or use a fork and PR.

A PR from the handoff branch into `main` includes the not-yet-deployed smart-template commit and the handoff documentation/notes as well as new work. Review that scope explicitly. For a production-only hotfix, create a separate branch from fetched `origin/main`.

Merging/pushing `main` triggers production deployment. Working on the handoff branch does not.

### Project instructions and paths

Read `AGENTS.md` before modifying code. Next.js 16 APIs may differ from older tutorials; consult the relevant guides in `node_modules/next/dist/docs/` after `npm ci`.

On the original owner's computer the authoritative source checkout is `/Users/tbnalfaro/Developer/Codex Projects/21 Engine`. Another developer should use their own non-synced development directory.

Use `npm run dev` for the local bypass. `npm run start` is production mode and intentionally fails closed without cloud/auth configuration.

## 4. Configuration and privately supplied credentials

Use `.env.example` as the starting template. Do not paste actual secrets into this Markdown, Git, an issue, or a PR.

### Existing production / authenticated staging

| Variable | Purpose / expected form | Classification |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project origin | Public configuration |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable/anon key for that project | Public configuration; never substitute the service-role key |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged database access, backend only | Secret |
| `OWNER_EMAIL` | Comma-separated app-owner email allowlist | Access configuration |
| `NEXT_PUBLIC_SITE_URL` | **Backend** origin, e.g. `https://greatful-independent.onrender.com` | Public configuration |
| `ENGINE_FRONTEND_URL` | Allowed Pages URL, currently `https://chatgptricks.github.io/engine/` | Public configuration |
| `ENGINE_FONT_BUNDLE_KEY` | Canonical base64 encoding of the 32-byte licensed-font bundle key | Secret; missing from `.env.example` |
| `ENGINE_API_URL` | Backend origin used by the Pages build; configured as a GitHub repository **variable** | Public build configuration |
| `ENGINE_PAGES_BASE_PATH` | `/engine` for the existing Pages deployment | Public build configuration |

Production alternatively reads the font key from the Render secret file **`engine-fonts-key`**, mounted at **`/etc/secrets/engine-fonts-key`**. Use the owner's existing provisioning method. The key is not included in this package.

Supabase Auth must permit **`<backend-origin>/admin/auth/callback`** and have working sign-in email delivery. `NEXT_PUBLIC_SITE_URL` is the backend origin, not the GitHub Pages URL. The Pages sign-in popup runs on Render and hands the session back only to the configured frontend origin.

Pointing local code at the production Supabase project gives that code production data access. Prefer blank local configuration or a separate staging project for normal development. Do not replace production keys, reset the database, or overwrite the complete Render environment during onboarding.

### Fonts

- `assets/licensed-fonts.enc` and `assets/pages-fonts.json` are tracked.
- Decrypted commercial fonts under `public/fonts/licensed/` are ignored by Git.
- `npm run build` runs `scripts/prepare-licensed-fonts.mjs`.
- Local builds can use fallbacks, but text measurements, line breaks, and exports can differ without exact fonts.
- Render production builds require the correct authenticated bundle/key.
- Pages builds can fetch the existing backend's public font files and verify repository-pinned hashes.

See `public/fonts/licensed/README.md`. Transfer font material only with the owner's licensing permission.

### Optional integrations

| Feature | Configuration |
|---|---|
| Research/chat/vision | `OPENAI_API_KEY`; optional `OPENAI_RESEARCH_MODEL`, `OPENAI_CHAT_MODEL`, `OPENAI_VISION_MODEL` |
| X image search | `APIFY_TOKEN` |
| Google image search | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` |
| Large research uploads | `BLOB_READ_WRITE_TOKEN` |
| Instagram integration | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` |
| Scheduled research | `CRON_SECRET` and a separately configured scheduler |
| Optional memberships | `GF_ENABLE_MEMBERS`, `STRIPE_SECRET_KEY`, `UNLOCK_SECRET`; optional `GF_STRIPE_PRICE_ID` |
| Engine MCP bridge | `ENGINE_URL` and a revocable `ENGINE_AGENT_TOKEN` |

The membership path is separate from owner allowlisting and is not required to develop or use the owner's workspace. Render does not automatically execute the cron declarations in `vercel.json`.

## 5. Data: source code is not the production workspace

The curated **@chatgptricks-only** catalog, custom templates, designs, brand kits, and cleanup choices are saved data. A fresh clone does not reproduce them automatically; the source still contains built-in defaults.

### To reproduce content locally

1. An authorized owner opens the existing Engine workspace and waits for **Saved to cloud**.
2. Use **Library tools → Export workspace backup**.
3. Transfer the backup privately.
4. In a fresh **local or staging** workspace, use **Library tools → Import backup…**.
5. Check the templates, page dimensions, text/image layers, brand assets, and exports.

Portable backups can be **`.engine.json`** or **`.engine.zip`** when private original media needs packaging. A flattened PNG/PDF is not an editable workspace backup.

A workspace content backup is not a full database backup. Supabase Auth users, internal CRDT/history records, review infrastructure, and agent credentials require their own authorized database/account handoff when needed. Never restore an old backup over the current live workspace just to make a development copy.

### Storage map

| Data | Location |
|---|---|
| Production persisted application state | Supabase `gf_client_state`, with separate namespaces |
| Owner editor workspace | Owner key `template-editor:owner` |
| Preserved research client state | Owner key `owner`; do not confuse it with the editor namespace |
| Story/schedule/Instagram records | Tables created by the migrations, including `gf_stories`, `gf_schedule`, `gf_ig_credentials` |
| Pending browser edits and last verified workspace | Browser IndexedDB; `engine-template-editor` recovery database |
| Local editor records on macOS | `~/Library/Application Support/Engine/development/<checkout-hash>/` |
| Local editor records on Linux | `~/.local/share/engine/development/<checkout-hash>/` |
| Local editor records on Windows | `%LOCALAPPDATA%/Engine/development/<checkout-hash>/` |

`ENGINE_DEV_STORAGE_DIR` overrides the editor's local base directory. Each checkout gets its own path-derived namespace. Older editor `.engine-dev/` records migrate by copying; research/Instagram development fallbacks may still use `.engine-dev`.

Moving the checkout, changing a browser origin, or changing devices does not transfer browser recovery or local records automatically. Render's filesystem is temporary and is not the production design store.

### Database setup for a separate installation

Join the existing project for existing production work. Only provision another database when an independent installation/staging environment is actually needed.

For a **new database**, apply these repository migrations in order:

1. `0014_engine.sql`
2. `0015_engine_saas.sql`
3. `0016_instagram_credentials.sql`
4. `0017_engine_client_state.sql`
5. `0018_editor_storage_timeout.sql`
6. `0019_editor_revision_metadata.sql`

Do not blindly rerun them on production. Confirm the existing schema first. Migration 0018 sets the trusted server-role statement deadline; 0019 adds stored scalar revision metadata and takes a table lock while computing it.

RLS is enabled. Privileged writes belong on the server using the existing service-role helper, never in the static frontend.

## 6. Architecture and where to make changes

Engine is one source repository with **two Next applications**:

~~~text
GitHub Pages: frontend/ static editor
        |
        | service-worker proxy + authenticated requests / SSE
        v
Render: root Next application, API, sign-in popup, research, exports
        |
        v
Supabase: Auth + durable application data
~~~

| Responsibility | Main paths |
|---|---|
| Studio entry / authentication gate | `app/page.tsx`, `app/admin/(tool)/engine/` |
| Library, navigation, template/project workflows | `components/template-editor/studio.tsx` |
| Canvas editing / contextual properties | `components/template-editor/design-editor.tsx`, `canvas.tsx`, `element-inspector.tsx`, `quick-toolbar.tsx` in that directory |
| Shared document model / template preparation / role inference | `lib/template-editor/model.ts` |
| Smart text fitting and template behavior | `lib/template-editor/smart-text.ts`, `smart-template.ts`, `smart-template-editing.ts` |
| Browser save/recovery/merge | `lib/template-editor/use-library.ts`, `library-sync.ts`, `recovery-storage.ts` |
| Durable persistence / revision CAS / heavy-work queue | `lib/template-editor/persistence.ts` |
| Collaboration | `lib/template-editor/use-collaboration.ts`, `collaboration-document.ts`, `collaboration-server.ts`, `collaboration-metadata.ts` |
| Editor API / live collaboration API | `app/api/template-editor/` |
| Rendering and exports | `components/template-editor/preview.tsx`; `lib/template-editor/export.ts`, `pdf-document.ts`, `pdf-export.ts` |
| Original media / portable backups | `lib/template-editor/media-storage.ts`, `media-archive.ts` |
| Static host initialization / sessions | `frontend/`, `components/engine-hosting/pages-studio.tsx`, `lib/engine/pages-connection.ts` |
| Cross-origin/API forwarding | `frontend/static/engine-api-worker.js`, `proxy.ts`, `lib/engine/frontend-origin.ts` |
| Agent API / bridge | `app/api/agent/`, `lib/template-editor/agent-decks.ts`, `agent-access.ts`, `scripts/engine-agent-mcp.mjs` |
| Research and integrations | `components/engine/`, `lib/engine/`, `app/api/engine/`, `app/api/instagram/` |
| Original bundled artwork | `public/template-editor/` |
| Database schema | `supabase/migrations/` |
| Release and build tooling | `.github/workflows/pages.yml`, `render.yaml`, `scripts/` |
| Tests | `tests/template-editor-*.test.mjs` |

Where a table row abbreviates a filename after a full path, it is in the same directory.

### Product behavior to preserve

- Text, images, shapes, pages, and groups remain native editable objects.
- Preserve template artwork, dimensions, fonts, user text, and existing saved posts.
- Canonical native scene coordinates are based on a 360-wide canvas. The agent authoring API uses output pixels; do not mix the coordinate systems.
- Current development infers **text / media / fixed / free** template roles; explicit author overrides take precedence.
- New posts follow inferred constraints; editing the source template releases generated constraints for authoring. Existing posts are not rewritten just by opening them.
- Contextual Smart layout exposes **Auto / 2 / 3 / 4 lines** for text, photo fit/crop for images, and alignment/distribution for elements/groups.
- @chatgptricks keeps its tuned cover/title and content-slide behavior.
- Browser recovery, owner isolation, operation IDs, revision checks, and conflict handling are required contracts.
- Presence-only acknowledgments must not count as saved artwork or retire pending recovery.
- Export must resolve loaded fonts, fit all selected pages, and preserve editable source data.

### Agent workflow

Use **Library tools → Connect an AI agent…** to mint a separate token. Configure `ENGINE_URL` with the **backend origin**, not the Pages URL, and `ENGINE_AGENT_TOKEN` privately. The bridge is `npm run agent:mcp`.

Tokens expire after 30 days, are revocable, and permit workspace deck/template operations including edits/removals; they are not per-document read-only credentials. Start with capabilities to discover live schemas. See `docs/agent-slides.md`. App/agent tokens do not grant GitHub or dashboard access.

## 7. Tests and verification

Fresh checks on the application code checkpoint, October 29:

| Check | Result |
|---|---|
| `npm run test:template-editor` | **683 passed; 0 failed; 0 skipped** |
| `npm run lint` | Passed |
| `npx tsc --noEmit --incremental false --pretty false` | Passed |
| Source clone / code checkpoint / authoring notes | Passed |
| Full application browser acceptance / production builds | Not rerun for this documentation handoff |

Run before changing/releasing code:

~~~sh
npm run test:template-editor
npm run lint
npx tsc --noEmit
npm run build
~~~

Browser recovery acceptance:

~~~sh
npx playwright install chromium
npm run test:template-editor:recovery
~~~

Live collaboration acceptance requires a separate, disposable loopback server, cloud configuration disabled, and real Chromium/Chrome. Example server, in one terminal:

~~~sh
ENGINE_ACCEPT_DIR="$(mktemp -d)"
ENGINE_DEV_STORAGE_DIR="$ENGINE_ACCEPT_DIR" \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3121 \
NEXT_PUBLIC_SUPABASE_URL= \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
SUPABASE_SERVICE_ROLE_KEY= \
npm run dev -- --hostname 127.0.0.1 --port 3121
~~~

In a second terminal, from the same checkout:

~~~sh
ENGINE_COLLABORATION_BASE_URL=http://127.0.0.1:3121 \
npm run test:template-editor:collaboration
~~~

`ENGINE_BROWSER_PATH` can select an installed Chrome/Chromium executable. These strict acceptance commands fail when required browser tooling is missing. Do not treat passing model/API tests alone as full UI acceptance.

Before releasing, visually verify creating a post from the intended template; Auto/2/3/4-line edits; image replacement/crop; added editable elements; two or more participants; save/reload; offline recovery; and PNG/PDF output at the design's actual dimensions.

## 8. Deployment and operational handoff

### Existing Render backend

Keep the existing service and Supabase project for this production workspace.

- Repository: `chatgptricks/engine`; production branch: `main`.
- Build: `npm ci && npm run build`.
- Start: `node --max-old-space-size=768 node_modules/next/dist/bin/next start`.
- Health path: `/api/engine/version`.
- `render.yaml` is an **optional new-service blueprint**, not an instruction to create a replacement service.
- Source configuration documents `1c-2g` compute and a 768 MiB V8 cap. Check current billing/instance settings in Render before changing them.
- The owner chose to retain the existing Supabase Free plan. No additional Supabase subscription was authorized for this handoff.

The existing Render health requests trigger a tiny, read-only database probe every six hours per running process, with a five-second deadline and hourly failure cooldown. It helps keep Free database activity present without blocking the health response. See `lib/engine/database-health.ts`. A 200 version response alone does not prove successful saves.

### GitHub Pages frontend

Pages source: **GitHub Actions**, workflow `.github/workflows/pages.yml`.

Repository variable:

~~~text
ENGINE_API_URL=https://greatful-independent.onrender.com
~~~

The workflow runs tests, waits for the backend to expose the **same commit SHA**, builds the static editor, and publishes `frontend/out` using GitHub's automatic Pages token/OIDC permissions. It does not need a copied personal GitHub token or the server's private font key.

Manual frontend build, if needed:

~~~sh
ENGINE_API_URL=https://greatful-independent.onrender.com \
ENGINE_PAGES_BASE_PATH=/engine \
npm run build:pages
~~~

That build contacts the backend for public sign-in configuration and fonts. A new backend must have its public configuration and font files available before Pages can build.

### Release sequence

1. Work on a feature branch and review its full diff against `main`.
2. Run the relevant checks, browser acceptance, and production build.
3. Merge approved work into `main`.
4. Watch Render until the intended commit is live.
5. Watch **Publish Engine frontend** in GitHub Actions until successful.
6. Compare:
   - Backend: `/api/engine/version` → `commit`.
   - Pages: `/engine/version.json` → `commit`.
   - Both must equal the merged Git SHA.
7. In the actual signed-in editor, verify **Saved to cloud**, **Live**, preserved content, and a save/reload/export.

If the backend release fails, Pages waits/fails rather than publishing a mismatched frontend. Check the failed build/logs and repair forward or use a deliberate Render rollback; do not force a mismatched frontend into production.

### Common onboarding problems

| Symptom | Check |
|---|---|
| Local clone lacks the latest smart-template behavior | Use the GitHub handoff branch; `main` is older |
| Fresh local library contains more templates | Production catalog cleanup is saved data; import an authorized backup |
| Sign-in succeeds but app access is rejected | Preserve/update `OWNER_EMAIL` and verify the intended sign-in email |
| Auth popup cannot return to Pages | Backend `NEXT_PUBLIC_SITE_URL`, allowed `ENGINE_FRONTEND_URL`, Supabase callback URL, popup settings |
| Local fonts/line breaks differ | Supply authorized exact fonts/key; fallback metrics can differ |
| Render build fails at licensed fonts | Correct secret file/key and authenticated encrypted bundle |
| Browser remains connecting / edits only local | Provider health, auth/network deadlines, local recovery; never reset/delete pending data |
| Saves time out with `57014` | Existing role timeout/schema, large workspace load, deployed version; preserve recovery |
| Pages job skipped | Repository `ENGINE_API_URL` variable is missing |
| Pages waits for backend | Render has not deployed the exact workflow SHA |
| Agent cannot connect | Backend `ENGINE_URL`, unexpired/revoked token status, capabilities endpoint |
| Scheduled research never runs on Render | `vercel.json` does not provision a Render scheduler |

## 9. What remains outside this source package

| Material | How to obtain it |
|---|---|
| Production database and current curated library | Authorized app/Supabase access and private content/database backup as appropriate |
| Pending browser edits | Original user's Browser recoveries/export, or save them before moving origins/devices |
| Font key / raw licensed fonts | Owner's private secret management and licensing permission |
| Optional third-party API credentials | Respective service account/secret management |
| Old QA screenshots, reference assets, backups, and experiment outputs | Owner's local `outputs/`; transfer selected items privately if needed |
| Local runtime data | Original machine's paths above and legacy `.engine-dev/` |
| Generated dependencies/builds | Recreate with `npm ci` and the documented builds |

The original outputs directory contains QA/reference/generated material and may include private workspace backups. It was not published indiscriminately. The local authoring notes are included directly in the handoff branch.

The original checkout remains on its existing branch. The latest source, notes and this guide are published on a dedicated handoff branch; they were not merged into main or deployed to production.

## 10. Handoff completion checklist

**Owner**

- [ ] Send this single Markdown guide; its clone command retrieves all source and authoring notes.
- [ ] Collect the developer's account identifiers and send appropriate invitations.
- [ ] Add the developer's app email to `OWNER_EMAIL` if shared production editing is intended.
- [ ] Provide authorized fonts/key privately for exact builds.
- [ ] Provide a current private workspace backup if local/staging content parity is needed.
- [ ] Agree whether the developer continues the not-yet-deployed smart-template feature or only production `main`.

**Receiving developer**

- [ ] Clone the handoff branch and confirm it contains the application code checkpoint.
- [ ] Run the app locally with Node 22.
- [ ] Confirm whether the library is source defaults or an imported production copy.
- [ ] Confirm repository contribution, Render, Supabase, and app access separately.
- [ ] Run tests and verify exact-font output before changing layout.
- [ ] Keep native layers, existing user data, and recovery records intact.
- [ ] Use reviewed branches and verify both deployment SHAs before declaring a release live.
