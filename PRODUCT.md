# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Ivan's social media team. It runs about 15 Instagram pages in one niche, AI and tech news, in English and Spanish. Each page has its own template, voice and brand guide.

- **Designers** (one or two people) build the pages' templates and brand guides.
- **Editors** (the rest of the team) make the posts. They bring in a post worth recreating, pick the page, and finish what Engine drafts.

The team works in English, on laptops and desktops. Phones are for a quick look or a small fix at most.

## Product Purpose

Engine is the team's web platform for making Instagram carousels for its pages. Its core job is recreating posts from other accounts in one page's own style: its template, voice, language and brand guide.

Engine rebuilds what it recreates instead of pasting pictures from the original:

- Text becomes native text in the page's template.
- Charts are redrawn from the real data.
- Posts from X are drawn as native cards.
- Logos come from the page's brand guide, including logos for the companies a cover names.
- The original page's name, handle, logo and swipe prompts are left out.

Everything stays editable. A team of Claude agents (Recreate) does the work, and a chat with Claude sits beside the editor for changes.

Success is a strong first draft, fast. Most of the work is done when the post opens, and people finish it in the editor or by asking in the chat. A good post reads as if the page made it, gets its facts right and follows the page's guide.

## Positioning

Engine knows the team's pages. Every run is for one page and uses that page's template, voice, house rules, language and brand guide. The agents research, write, design and check the post inside that template. They hand back a native deck that the team keeps editing in the same place, with Claude beside it.

A general design tool doesn't know the pages, and an image generator hands back pictures, not editable posts.

## Operating Context

**The usual flow**

1. Someone finds a post worth recreating on Instagram.
2. They paste its link or screenshots into **Recreate post** or the **Chat**, name the page, and choose:
   - **Exact copy:** the same slides in the same order with the same words, translated when the page's language differs, and nothing added. It takes 1 to 3 minutes and never pauses.
   - **Full recreation:** the agents research the story and make a new post. The original's slides come first, then the readers' first questions, real reactions from X, a takeaway and the page's Follow slide.
3. In checkpoint mode, Engine's default, a person reviews the plan and taps a hook. Autopilot skips that review.
4. The post opens in the editor with the chat beside it. People adjust it by hand or by asking Claude. Each chat reply is one undo step.
5. They export it as PNG, JPG, WebP, PDF or SVG. Several slides download as a ZIP with numbered files and the caption.

**Working together**

- Live collaboration shows everyone's cursors and edits.
- Each post has its own chat, shared with the workspace like comments.
- Review links let people outside the workspace comment on a snapshot.

**Agents.** Outside agents (Claude Code or any MCP client) use the same library through **Connect agent**: the MCP bridge and the HTTP API in `docs/agent-slides.md`.

**Where it runs**

- The editor is at https://chatgptricks.github.io/engine/ (GitHub Pages), and the backend is on Render.
- Supabase handles sign-in and storage.
- The team signs in with a one-time email link and shares one workspace.
- `main` deploys to production automatically.

**Services**

- Claude runs Recreate and the chat.
- Apify brings in Instagram links, and posts and photos from X. Searching X needs a paid plan.
- OpenAI runs the photo check and the older research tools.
- A hosted headline model writes hook options. Its first call after a quiet spell can take a few minutes.

## Capabilities and Constraints

**Pages**

- A page profile holds one page's language (English or Spanish), template, brand guide, voice brief, house rules, Follow line and swipe text.
- The code ships one complete page, @chatgptricks: its profile, the ChatGPTricks template and its brand guide. It also ships an example Spanish profile on the same template. Other pages are saved in the workspace.

**Templates**

- Smart templates give every layer a role: text slot, photo slot, fixed (logos, handles, decoration) or free. Posts follow their template whether a person or an agent fills them.
- Copy that can't fit at its smallest readable size must be shortened before that slide can be exported.
- The ChatGPTricks template is 3:4 (1080 × 1440). Its page types are Cover, Text + Media, List, Follow, Reaction, Two reactions, Three reactions, and a Wide photo pair that spans two slides.

**Brand guides** (Brand → Guides)

- A guide holds a brand's essentials, colors, text styles, layout, logos, example posts, rules and words.
- Every save is a new version.
- Agents design from the guide, and code checks finished decks against it.

**Recreate**

- A full recreation runs these stages: brief, research (facts, data, reactions, visuals), outline, hooks, approval, copy, charts, images, deck and review.
- Critics check every number against the research, and the rendered slides against the original and the house rules.
- A hook choice teaches the headline model only when a signed-in person taps it.

**Chat**

- It recreates posts, edits the open post, finds photos from X, writes hooks, checks the brand guide and answers fact questions.
- It can't delete posts, empty Trash, publish, or change brand guides.
- Text from Instagram, X and the web is material, never instructions.

**Limits**

- Up to 20 slides per post and 100 layers per slide.
- A workspace holds up to 150 designs and 80 custom templates. Trash counts until it's emptied.
- The editor exports still images.
- Production builds get the licensed fonts (SF Pro Display and the Canva faces) from an encrypted bundle. Local checkouts fall back to system fonts, so local renders aren't exact.

**Older research workspace.** The story feed, sources, image search, Instagram channels and scheduling from earlier work are kept at `/admin/engine/research`. Engine's main entry opens the library and the editor.

**Open, for Ivan to decide** (as of November 8, 2026)

- Exact copies cut photos, charts and screenshots from the original slides, and a post from X comes through as a picture. Whether exact copies should also draw X posts as native cards is open.
- Video posts in the editor are for later.
- Generated covers from an image model, prompted from the agents' analysis, are an idea for later. Don't build them until Ivan asks.

**Terms**

- A *page* is one Instagram account the team runs.
- A *post* is one carousel. The API calls it a *deck*.
- A *hook* is the cover headline.
- The *source line* names a slide's source.
- The *Follow slide* closes a post with the page's fixed first line and a topic line of about 21 characters.

## Brand Commitments

- **Engine** is the product's name.
- **Interface voice.** Engine's own screens, messages and chat replies use plain words and short sentences, in English:
  - Sentence case for buttons and titles.
  - Status lines sound human: "Researching…", "Didn't finish" instead of "Failed".
  - Empty states say what to do next.
  - Errors reassure and give the way out.
  - The full rules are in `design-system/PRINCIPIOS-DE-DISENO.md`, section 14.
- **Each page's voice is the page's own.** It lives in the page profile and the brand guide, not in Engine's interface. For @chatgptricks it's punchy, plain and accurate, with no clickbait, and a hype word only when the story backs it up.

## Evidence on Hand

- The ChatGPTricks template: `lib/template-editor/chatgptricks-template.ts` and `lib/template-editor/model.ts`, with artwork in `public/template-editor/`.
- The ChatGPTricks brand guide, seeded from Ivan's ChatGPTricks Style Guide and the house rules, with its example posts: `lib/template-editor/brand-guide-seed.ts`.
- The page profiles: `lib/engine/page-profiles.ts`. The @chatgptricks profile puts the page at about 2.7M followers.
- Headline formulas and proven covers from Ivan's headline-engine skill: `lib/engine/agents/headline-engine-data.ts`.
- The Recreate team's playbook: `lib/engine/agents/playbook.ts`.
- Docs: `README.md`, `docs/assistant.md` (the chat), `docs/agent-slides.md` (agents and Recreate) and `docs/Engine-Complete-Handoff.md` (access and deployment).
- The editor's visual principles, written from its CSS, are in `design-system/` (in Spanish).
- Not in the repo: post performance data, testimonials, and the other pages' names and numbers. Don't invent them.

## Product Principles

1. **Rebuild, don't paste.** Every part of a recreated post is rebuilt in the page's template as something people can edit: text as text, charts from real data, posts from X as cards. A picture cut from someone else's post is the exception, never the goal.
2. **Each page stays itself.** A post follows its page's template, voice, language and guide. The original page's branding never comes along.
3. **A strong first draft, finished by people.** Engine does most of the work fast and makes the last stretch easy: a plan a person approves, the editor, and the chat beside it. Every change can be undone.
4. **Accurate before catchy.** Numbers come from primary sources named on the slide, critics check them, and hype has to be earned by the story.
5. **Designers set the system, editors move fast.** Templates and brand guides carry the design, so editors and agents can't break it by accident. Designers keep full control when they edit a template.
