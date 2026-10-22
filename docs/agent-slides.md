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

Pass that object to `engine_create_deck`. `format: "presentation"` currently means 1920 × 1080 output pixels. Capabilities also lists portrait, square, story, and custom size options, available font identifiers, and native templates. To start from a template, use its `templateId` and follow the slot and slide-count guidance returned by capabilities and `engine_list_templates`.

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
