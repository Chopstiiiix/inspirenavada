/**
 * InspireNavada dev-mode sandbox service (Phase 2).
 *
 * A per-user Cloudflare Container that runs the *real* Claude Code CLI against a
 * *real* filesystem. Each signed-in user gets their own sandbox, keyed to their
 * Supabase user id. The browser sends the user's Supabase access token (to prove
 * who they are) plus their own Anthropic API key (which powers the CLI inside
 * their own isolated container and is never persisted server-side).
 *
 * Routes (all POST, all require a valid Supabase bearer token):
 *   /api/health        -> liveness + which agents are installed
 *   /api/exec          -> run `claude --print <prompt>`, stream stdout back (SSE)
 *   /api/fs/list       -> list files in the workspace
 *   /api/fs/read       -> read one file
 *   /api/fs/write      -> write one file
 *
 * The static site is a completely separate Worker; nothing here affects it.
 */
import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";

// Re-export the Container-backed Durable Object class for wrangler.
export { Sandbox } from "@cloudflare/sandbox";

interface Env {
  Sandbox: DurableObjectNamespace;
  SUPA_URL: string;
  SUPA_ANON_KEY: string;
  ALLOWED_ORIGINS: string;
}

const WORKDIR = "/workspace";

const MODELS: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5",
};
function resolveModel(name?: string): string {
  const n = (name || "").toLowerCase().trim();
  if (MODELS[n]) return MODELS[n];
  if (n.indexOf("claude-") === 0) return n;
  return MODELS.opus;
}

// Single-quote a string for safe use as one shell argument.
function shq(s: string): string {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/* ── CORS ─────────────────────────────────────────────── */
function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const allow = origin && allowed.indexOf(origin) >= 0 ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Anthropic-Key",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/* ── auth: verify the caller's Supabase access token ─────── */
async function verifyUser(req: Request, env: Env): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const res = await fetch(env.SUPA_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: env.SUPA_ANON_KEY },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user && user.id ? { id: user.id } : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(env, origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // Preview-URL / exposed-port routing for the sandbox SDK (harmless no-op otherwise).
    const proxied = await proxyToSandbox(request, env as any);
    if (proxied) return proxied;

    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, cors);

    // Every route is authenticated.
    const user = await verifyUser(request, env);
    if (!user) return json({ error: "unauthorized — sign in to InspireNavada first" }, 401, cors);

    // One sandbox per user, warm for 20 minutes after last activity.
    const sandbox = getSandbox(env.Sandbox, user.id, { sleepAfter: "20m" });

    try {
      if (url.pathname === "/api/health") {
        await sandbox.exec("mkdir -p " + WORKDIR);
        const which = await sandbox.exec("command -v claude || true; command -v codex || true");
        return json(
          { ok: true, user: user.id, agents: (which.stdout || "").trim().split("\n").filter(Boolean) },
          200,
          cors
        );
      }

      if (url.pathname === "/api/exec") {
        const body = (await request.json().catch(() => ({}))) as {
          prompt?: string;
          model?: string;
        };
        const prompt = (body.prompt || "").trim();
        if (!prompt) return json({ error: "prompt is required" }, 400, cors);

        const key = request.headers.get("X-Anthropic-Key") || "";
        if (!key) return json({ error: "missing Anthropic API key" }, 400, cors);
        const model = resolveModel(body.model);

        await sandbox.exec("mkdir -p " + WORKDIR);

        // Run the real CLI headless; it reads/edits files in WORKDIR autonomously.
        const cmd =
          "claude --print --dangerously-skip-permissions --model " +
          shq(model) +
          " " +
          shq(prompt);

        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        const send = (obj: unknown) =>
          writer.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n"));

        const run = sandbox
          .exec(cmd, {
            cwd: WORKDIR,
            env: { ANTHROPIC_API_KEY: key, IS_SANDBOX: "1" },
            stream: true,
            onOutput: (streamName: string, data: string) => {
              send({ type: streamName === "stderr" ? "stderr" : "text", text: data });
            },
          } as any)
          .then((res: any) => send({ type: "done", exitCode: res && res.exitCode, success: res && res.success }))
          .catch((err: any) => send({ type: "error", error: String((err && err.message) || err) }))
          .finally(() => writer.close());

        ctx.waitUntil(run);
        return new Response(readable, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...cors },
        });
      }

      if (url.pathname === "/api/fs/list") {
        await sandbox.exec("mkdir -p " + WORKDIR);
        const res = await sandbox.exec(
          "cd " + WORKDIR + " && find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | sed 's|^\\./||' | sort"
        );
        const files = (res.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
        return json({ files }, 200, cors);
      }

      if (url.pathname === "/api/fs/read") {
        const body = (await request.json().catch(() => ({}))) as { path?: string };
        const path = (body.path || "").replace(/^~?\/*/, "");
        if (!path || path.indexOf("..") >= 0) return json({ error: "bad path" }, 400, cors);
        const res = await sandbox.exec("cat -- " + shq(WORKDIR + "/" + path));
        if (!res.success) return json({ error: "not found" }, 404, cors);
        return json({ path, content: res.stdout }, 200, cors);
      }

      if (url.pathname === "/api/fs/write") {
        const body = (await request.json().catch(() => ({}))) as { path?: string; content?: string };
        const path = (body.path || "").replace(/^~?\/*/, "");
        if (!path || path.indexOf("..") >= 0) return json({ error: "bad path" }, 400, cors);
        const full = WORKDIR + "/" + path;
        // writeFile is the documented SDK method; fall back to a shell heredoc.
        try {
          await (sandbox as any).writeFile(full, body.content || "");
        } catch {
          await sandbox.exec("mkdir -p " + shq(full.replace(/\/[^/]*$/, "")));
          const b64 = btoa(unescape(encodeURIComponent(body.content || "")));
          await sandbox.exec("printf %s " + shq(b64) + " | base64 -d > " + shq(full));
        }
        return json({ ok: true, path }, 200, cors);
      }

      return json({ error: "not found" }, 404, cors);
    } catch (err: any) {
      return json({ error: String((err && err.message) || err) }, 500, cors);
    }
  },
};
