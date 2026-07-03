# Phase 2 — real Claude Code CLI in per-user cloud sandboxes

This is the backend that makes `claude` in the dev-mode terminal run the **real
Claude Code CLI** on a **real filesystem** inside a **per-user Cloudflare
Container**, instead of the in-browser agent. It's a *separate* Worker
(`inspirenavada-sandbox`) that lives in [`sandbox-service/`](./sandbox-service).
The static site is untouched and keeps deploying exactly as before.

## How it fits together

```
browser (dev mode terminal)
  │  Supabase access token  (proves who you are)
  │  your Anthropic API key (X-Anthropic-Key header, powers the CLI)
  ▼
inspirenavada-sandbox  Worker  ── verifies the token against Supabase
  ▼
getSandbox(env.Sandbox, <supabase user id>)   ← one container per user
  ▼
Cloudflare Container (Dockerfile: cloudflare/sandbox + @anthropic-ai/claude-code)
  runs:  claude --print --dangerously-skip-permissions --model <m> "<prompt>"
  stdout ──stream──► browser terminal, files persist in /workspace
```

- **Auth**: the browser already has a Supabase session. It sends that token; the
  Worker calls `GET /auth/v1/user` to confirm it and derive the user id. The
  sandbox id **is** the user id, so each user gets an isolated container.
- **Key handling**: the user's Anthropic key rides one request into *their own*
  container as an env var for the CLI. It is never written to disk in the Worker
  and never stored server-side. (This is the "paste-key" model. A stricter
  variant that keeps the key entirely out of the container — outbound API
  proxying with a single site-owned key — is noted under "Hardening" below.)
- **Files**: anything the CLI writes lands in `/workspace` in the container. After
  a run, the terminal mirrors those files back into the Code Editor / Git apps.

## One-time deploy (requires the Workers **Paid** plan)

Containers are not on the free plan. Enable Workers Paid first
(https://dash.cloudflare.com → Workers & Pages → Plans), then:

```bash
cd sandbox-service
npm install
# first deploy builds + pushes the container image (~2–3 min)
NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler deploy
```

`wrangler deploy` prints the service URL, e.g.
`https://inspirenavada-sandbox.<your-subdomain>.workers.dev`.

> The `NODE_OPTIONS=--dns-result-order=ipv4first` prefix is the same DNS
> workaround that fixed the static-site deploy timeout. Drop it if deploys are
> fast for you.

## Turn it on in the site

In the dev-mode terminal (signed in, Claude key connected):

```
sandbox set https://inspirenavada-sandbox.<your-subdomain>.workers.dev
sandbox health          # → ✓ sandbox online · agents: /usr/local/bin/claude …
claude build me a todo app in index.html
```

`claude` now says *"the real CLI, running in your cloud sandbox"*. The URL is
remembered in `localStorage`. `sandbox clear` reverts to the in-browser agent.
Nothing is wired to the cloud until you run `sandbox set`, so the live site
behaves exactly as it does today until you flip it on.

## Cost (rough)

Billed per 10ms of active container time; `basic` instance = 1/4 vCPU, 1 GiB.
Free monthly allowance: 25 GiB-hr memory, 375 vCPU-min, 200 GB-hr disk. A handful
of testers doing short `claude` runs stays comfortably inside that. Containers
sleep after 20 min idle (`sleepAfter`), so you don't pay for idle sessions.

## Endpoints (all POST, all require a Supabase bearer token)

| Route | Body | Returns |
|---|---|---|
| `/api/health` | — | `{ok, user, agents[]}` |
| `/api/exec` | `{prompt, model}` + `X-Anthropic-Key` | SSE stream of `{type:'text'\|'stderr'\|'error'\|'done'}` |
| `/api/fs/list` | — | `{files[]}` (workspace, relative paths) |
| `/api/fs/read` | `{path}` | `{path, content}` |
| `/api/fs/write` | `{path, content}` | `{ok, path}` |

`ALLOWED_ORIGINS` in `wrangler.jsonc` gates CORS — add any new site origin there.

## Not done yet (Stage 2 candidates)

- **Interactive PTY** (a full bash shell via xterm.js over WebSocket). The SDK
  supports it (`sandbox.terminal()` + `@cloudflare/sandbox/xterm`), but the
  client addon needs a JS bundler and the site is deliberately buildless — so
  that's a deliberate follow-up, not an oversight. Stage 1 gives the real CLI via
  streaming `--print`, which covers the core "build with a real agent" use case.
- **codex**: the image installs it, but its OpenAI auth isn't wired. Adding a
  `/api/exec` variant that runs `codex` with an OpenAI key is small.
- **Durable workspace**: today the container FS persists only while warm (20 min
  idle window). To make it survive restarts, mount an R2 bucket
  (`sandbox.mountBucket`) or snapshot with `createBackup`/`restoreBackup`, or
  reuse the existing Supabase `workspaces` table by syncing on run completion.

## Hardening (before opening to real users)

- **Key-out-of-container option**: run with `enableInternet=false`,
  `interceptHttps=true`, `allowedHosts=['api.anthropic.com','github.com']`, and
  inject the key via `Sandbox.outboundByHost['api.anthropic.com']` so the
  container only ever sees a placeholder. Trade-off: that pattern uses one
  site-owned key, not per-user keys — pick per your billing model.
- **Rate limiting / abuse**: cap runs per user (e.g. a Durable Object counter or
  a Supabase check) before spawning work. `max_instances` in `wrangler.jsonc`
  caps concurrency but not per-user spend.
- **Prompt size / timeout**: `COMMAND_TIMEOUT_MS` (Dockerfile) bounds a run at
  10 min; tune to taste.
