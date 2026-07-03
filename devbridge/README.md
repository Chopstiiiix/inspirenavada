# InspireNavada dev bridge — the free, no-cloud Phase 2

Run the **real Claude Code CLI** from the dev-mode terminal on the site, backed
by **your own machine** — no Cloudflare, no paid plan, no API key to paste.
It uses whatever auth your local `claude` already has.

## Prerequisites

- Node 18+ (`node --version`)
- The Claude Code CLI installed and logged in:
  ```bash
  npm i -g @anthropic-ai/claude-code
  claude   # once, to log in with your Anthropic account (or set ANTHROPIC_API_KEY)
  ```

## Run it

From the repo root:

```bash
node devbridge/bridge.mjs
```

You'll see it listening on `http://localhost:7717` (bound to `127.0.0.1` only —
it is never exposed to your network). It creates a working folder
`./inspirenavada-workspace` where the CLI reads and writes.

Then, in the dev-mode terminal **on the site** (signed in + dev mode unlocked):

```
sandbox set http://localhost:7717
sandbox health          # → ✓ sandbox online · agents: claude
claude build me a landing page in index.html
```

`claude` now runs the real CLI on your disk. Files it creates show up in the
Code Editor and Git apps. `Ctrl+C` interrupts a run (your files are kept).
`sandbox clear` switches back to the in-browser agent.

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--port <n>` | `7717` | Port to listen on |
| `--workspace <dir>` | `./inspirenavada-workspace` | Folder the CLI works in |
| `--origin <url>` | — | Allow an extra browser origin (repeatable, e.g. a preview URL) |

Example: `node devbridge/bridge.mjs --port 8080 --workspace ~/dev/playground`

## How it works / security

- Speaks the same API as the cloud sandbox Worker (`/api/exec` SSE stream,
  `/api/fs/list|read|write`, `/api/health`), so the site's `window.sandbox`
  talks to it with zero changes.
- Binds to `127.0.0.1` only; browser access is gated by CORS to the site
  origins. Path access is confined to the workspace folder.
- The Anthropic key is **optional** — if the site sends one it's used for that
  run, otherwise your local `claude` login is used.
- Zero npm dependencies (Node built-ins only), so there's nothing to install for
  the bridge itself.

## Cloud instead?

If you'd rather host this so other people can use it without running anything,
see [`../PHASE2.md`](../PHASE2.md) for the Cloudflare Containers deployment (needs
Workers Paid) or point the same `sandbox set <url>` at any server that speaks
these endpoints (e.g. Google Cloud Run's free tier).
