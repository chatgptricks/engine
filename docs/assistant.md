# Engine chat

Engine has a chat panel where people talk to Claude about posts. Paste an Instagram link or drop screenshots, name the page, and Claude runs the Recreate team. Then ask for changes in plain words ("shorter title on slide 2", "make FREE green on the cover", "swap the photo on slide 3 for Sam Altman on stage", "is the 40% right?") and Claude makes them in the open post.

The chat is for people signed in to Engine. Agents and automation keep using the MCP bridge and the HTTP API in [agent-slides.md](agent-slides.md).

## Using it

- **Open it** with **Chat** in the library header or the editor header. On screens 1100px and wider the panel docks on the right and the page moves over; on smaller screens it opens on top.
- **Two kinds of chat.**
  - With a post open, the panel shows **that post's chat**, shared with everyone in the workspace, like comments. Each message shows who wrote it.
  - With no post open, it's **your own chat**, which only you see.
  - In the editor, **This post** and **Your chat** switch between them.
- **Recreating a post.** Claude starts the run and a card follows it stage by stage.
  - In checkpoint mode, the card shows the plan and the hook options. **Tap a hook** (or write your own) to approve the plan.
  - When the post is ready, **Open post** opens it with the chat beside it.
  - Checkpoint is the default. Ask for autopilot to skip the review.
- **Watching Claude work.** While Claude works, the panel shows what it's doing as it happens:
  - a short line on what it's about to do ("Checking the 94% against Anthropic's report."),
  - each step once it's done, with what came of it ("Searched X for "NYSE trading floor" · 7 photos", "Read the post · 9 slides"),
  - and a live line with the step under way and a timer ("Searching the web for "JOLTS peak 2022"… 12s").
  - When the answer is done, the steps fold into "Worked for 22s · 4 steps", which opens to show them again.
- **Editing a post.** Claude reads the post as it is right now, makes the edits and says what changed.
  - The edits go through your editor, so each reply's edits are **one undo step** (⌘Z / Ctrl+Z) and everyone with the post open sees them live.
  - If you close the post or leave while Claude is working, the edits are saved on the server instead. They still show up live for anyone who has the post open, but they aren't in anyone's undo history.
- **Photos.** Ask for photos and Claude shows a few from X. Tap one to put it on the slide, or ask Claude to choose.
  - With `OPENAI_API_KEY` set, a vision check looks at the photos first: it drops the ones that don't fit and says what each of the rest shows.
  - Without it, the photos aren't checked, and Claude knows each one only by the text of the X post it came from.
- **Attachments.** Paste, drop or attach up to 10 images per message (screenshots of a post, or a photo to use). Images are downscaled to 1600px. They stay usable in later messages in the same chat for 6 hours.
- **Voice.**
  - The mic button dictates into the message box: hold it to talk, or tap to start and tap again to stop. **EN / ES** sets the language.
  - Dictation uses the browser's own speech recognition (Chrome, Edge and Safari), and the mic is hidden in browsers without it, such as Firefox.
  - The speaker button in the header reads Claude's replies aloud.
- **Reloading is safe.** A reply keeps going on the server when the browser disconnects. The panel shows the latest state and picks up the finished answer.

## What Claude can do here

| Tool | What it does |
| --- | --- |
| `list_pages` | The page profiles a post can be made for |
| `recreate_post` | Starts a Recreate run from a link or attached screenshots, in checkpoint or autopilot mode, with notes and posts from X |
| `recreate_status`, `rerun_stage`, `add_x_posts` | Follows a run, redoes one stage with instructions, adds posts from X to the reactions |
| `approve_plan` | Approves a checkpoint, only when the person tells Claude to choose |
| `open_post` | Opens a post in the editor |
| `read_post` | The open post as it is in the live editor: slides, text, photos, notes |
| `edit_post` | Edits to the open post: text, colored or bold words, photos, slides added, moved or removed, the caption. Template text with a fixed style takes colored words, like the page's own highlights, but not bold |
| `look_at_slides` | Renders up to 3 slides so Claude can check its work (slow, so only when it matters) |
| `check_brand` | Checks the post against the page's brand guide |
| `find_photos` | Photos from X for a slide, shown as a card. Claude gets what each photo shows from the vision check, or only its post's text when the check didn't look at it |
| `write_hooks` | Hook options from the headline model, shown as a card |
| `web_search`, `web_fetch` | Fact questions |

Left out on purpose: deleting posts, emptying Trash, publishing, changing brand guides, and anything outside Engine. Text from Instagram, X and web pages is treated as material, never as instructions.

**Hook picks teach the headline model only when a person taps a hook** on a run card, the same as in the Recreate dialog. When someone picks a hook in words, Claude asks them to tap it. `approve_plan` approves as the agent, and those approvals are never sent to the headline model.

## How it works

- **Route.** `app/api/engine/assistant/route.ts`.
  - `GET ?deckId=` returns the thread, whether a reply is running, and who's asking. Leave out `deckId` for your own chat.
  - `POST {deckId?, text, uploads?, turn?, editor?}` answers as a stream of `data: {json}` events: `queued`, `message`, `reply`, `text`, `note`, `tool`, `card`, `deck_ops`, `open`, `done` and `error`.
  - `POST {action: "ack", …}` is how the editor reports what it did with `deck_ops`.
  - The browser sends a per-browser `sessionId`, so a local dev server tells people apart.
- **Agent.** `lib/engine/assistant/agent.ts` streams Claude with adaptive thinking at medium effort.
  - Thinking display "updates" can turn Claude's reasoning between tool calls into short progress notes. None came up in live testing, so the panel mostly relies on Claude's own narration (next point).
  - The system prompt asks Claude to say in a few words what it's doing before it uses a tool, and to write its whole answer after its last tool call. The panel shows what Claude writes before its last step as narration, and folds it away with the steps (`answerItems` and `foldAnswer` in `chat-stream.ts`).
  - Each step carries what it's doing while it runs, what it did, and what came of it. A tool's `label` gives the first two and its result can add a `detail` ("6 photos").
  - Web searches and page reads are labeled from their input as it streams in. Web search runs code that searches; that code shows as a step only when it does something besides searching ("Going through the results").
  - A finished answer records `doneAt`, so the panel can say how long it worked.
  - The system prompt and the tools never change during a thread, and the conversation is only ever added to, so Claude's earlier reasoning stays valid across turns.
  - What changes each turn goes into the new message: who asked, where they are, the slide they're on, what's selected, and what's attached.
  - A conversation over 400,000 characters starts again from a summary. The messages people see stay whole.
- **Tools.** `lib/engine/assistant/tools.ts` wraps the Recreate team (`lib/engine/agents/orchestrator.ts`) and the deck functions in `lib/template-editor/agent-decks.ts`.
  - `edit_post` checks the edits against the live post first, and Claude gets the exact error back if they don't fit.
  - On top of the deck operations, `style_words` colors or bolds words inside a text box (`lib/engine/assistant/chat-edits.ts`).
- **Edits.**
  - While the asker's editor is connected, the route sends `deck_ops` and waits up to 15 seconds for the editor's answer. The editor applies them with `commit()`, the same path as a person's edit.
  - Otherwise `lib/engine/assistant/live-deck.ts` writes them into the post's live collaboration document as a remote edit. A normal library save would reset the live session for everyone who has the post open, so it isn't used.
- **Threads.** `lib/engine/assistant/threads.ts` stores one row per thread (`assistant-thread:…`) with revision checks, or a local JSON file in development.
  - A thread keeps the messages people see, Claude's conversation for replay, and token use.
  - It holds up to 300 messages and expires 90 days after its last message.
- **Replies.** `lib/engine/assistant/replies.ts` runs one reply at a time per thread. Up to 2 more wait their turn.
  - It holds the reply being written, so a reload shows it, and it holds attached images for 6 hours (up to 40 images or 80 MB per thread).
  - This state lives in the server process. With more than one server instance, a reply's live state shows only on the instance that runs it, but the saved thread is the same everywhere.
- **Panel.** `components/template-editor/assistant-panel.tsx`.
  - The browser side of the stream is `lib/engine/assistant/chat-stream.ts`.
  - The editor lends the panel a bridge (`onChatBridge` on `DesignEditor`) that applies edits and reports the current slide and selection.

## Limits and cost

- Claude Opus 5.5 by default. Set `ENGINE_MODEL_ASSISTANT` (for example to `claude-sonnet-5-5`) for a cheaper chat.
- At most 12 tool calls per reply, and 30 messages per person per hour across their chats.
- A message is at most 8,000 characters.
- Rendered slides go to Claude only when it asks to look, since images cost the most.

## Setup

- **Required:** `ANTHROPIC_API_KEY`. Without it, the panel says the chat isn't set up.
- **Optional:**
  - `APIFY_TOKEN` for links, photos and posts from X.
  - `OPENAI_API_KEY` for the vision check on photos, the same key research uses.
  - `HEADLINE_API_KEY` for hook options.
  - A Chromium for `look_at_slides`, the same as Recreate's design critic.
- Nothing else is new for production. The chat runs on the same server and storage as Recreate.

## Tests

```bash
node --test tests/template-editor-assistant-threads.test.mjs tests/template-editor-assistant-agent.test.mjs tests/template-editor-assistant-edits.test.mjs tests/template-editor-assistant-stream.test.mjs
```

They run with `npm run test:template-editor` too. Claude is stubbed with scripted streams, so no network or key is needed.

## Later

- A hands-free spoken conversation, which needs a speech service.
- A Stop button for a reply.
- Exact-copy mode in `recreate_post`, once Recreate's exact mode lands.
- The trend scout posting trending posts into a team chat, and a Slack hand-off.
