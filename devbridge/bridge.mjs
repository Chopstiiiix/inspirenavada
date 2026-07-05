#!/usr/bin/env node
/**
 * InspireNavada dev bridge — the $0, no-cloud Phase-2 backend.
 *
 * Runs on YOUR machine. It exposes the exact same HTTP contract as the cloud
 * `inspirenavada-sandbox` Worker, but backed by your *local* `claude` CLI and a
 * real folder on your disk. Because it's your own machine, it uses whatever auth
 * your local claude already has — a `claude login` subscription session or an
 * ANTHROPIC_API_KEY in your env — so you don't even have to paste a key.
 *
 * Start it:
 *     node devbridge/bridge.mjs
 * then in the dev-mode terminal on the site:
 *     sandbox set http://localhost:7717
 *     claude build me a snake game in index.html
 *
 * Zero dependencies (Node built-ins only). Binds to 127.0.0.1 only, so it is
 * never exposed on your network; browser access is gated by CORS to the site.
 *
 * Flags:
 *   --port <n>         listen port (default 7717)
 *   --workspace <dir>  where the CLI works (default ./inspirenavada-workspace)
 *   --origin <url>     extra allowed browser origin (repeatable)
 */
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import os from "node:os";

/* ── args ─────────────────────────────────────────────── */
function argVal(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function argAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  return out;
}
const PORT = parseInt(argVal("--port", "7717"), 10);
const WORKSPACE = path.resolve(argVal("--workspace", path.join(process.cwd(), "inspirenavada-workspace")));
const ALLOWED_ORIGINS = [
  "https://inspirenavada.inspire-edge.net",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:3000",
  ...argAll("--origin"),
];

const CLAUDE_BIN = process.platform === "win32" ? "claude.cmd" : "claude";
const CODEX_BIN = process.platform === "win32" ? "codex.cmd" : "codex";

const MODELS = { opus: "claude-opus-4-8", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" };
function resolveModel(name) {
  const n = String(name || "").toLowerCase().trim();
  if (MODELS[n]) return MODELS[n];
  if (n.indexOf("claude-") === 0) return n;
  return MODELS.opus;
}

/* ── helpers ──────────────────────────────────────────── */
function corsFor(req) {
  const origin = req.headers.origin;
  const allow = origin && ALLOWED_ORIGINS.indexOf(origin) >= 0 ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Anthropic-Key",
    "Access-Control-Allow-Private-Network": "true", // Chrome local-network access
    Vary: "Origin",
  };
}
function sendJson(res, cors, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 8e6) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}
function hasBin(bin) {
  try {
    const r = spawnSync(bin, ["--version"], { timeout: 4000, stdio: "ignore" });
    return !r.error && (r.status === 0 || r.status === null);
  } catch { return false; }
}
// resolve a workspace-relative path, refusing anything that escapes it
function safePath(rel) {
  const clean = String(rel || "").replace(/^~?[/\\]*/, "");
  const full = path.resolve(WORKSPACE, clean);
  if (full !== WORKSPACE && !full.startsWith(WORKSPACE + path.sep)) return null;
  return full;
}
async function listFiles(dir, base, acc) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const abs = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) await listFiles(abs, rel, acc);
    else acc.push(rel);
  }
  return acc;
}

/* ── request handling ─────────────────────────────────── */
async function handle(req, res) {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  if (req.method !== "POST") return sendJson(res, cors, 405, { error: "method not allowed" });

  const url = new URL(req.url, "http://localhost");
  await fs.mkdir(WORKSPACE, { recursive: true }).catch(() => {});

  try {
    if (url.pathname === "/api/health") {
      const agents = [];
      if (hasBin(CLAUDE_BIN)) agents.push(CLAUDE_BIN);
      if (hasBin(CODEX_BIN)) agents.push(CODEX_BIN);
      return sendJson(res, cors, 200, { ok: true, user: os.userInfo().username, workspace: WORKSPACE, agents });
    }

    if (url.pathname === "/api/exec") {
      const body = await readBody(req);
      const prompt = String(body.prompt || "").trim();
      if (!prompt) return sendJson(res, cors, 400, { error: "prompt is required" });
      const model = resolveModel(body.model);

      // key is optional here — local claude uses your own login if none is sent
      const key = req.headers["x-anthropic-key"];
      const env = { ...process.env };
      if (key) env.ANTHROPIC_API_KEY = String(key);

      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", ...cors });
      const send = (obj) => { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch {} };

      const args = ["--print", "--dangerously-skip-permissions", "--model", model, prompt];
      let child;
      try {
        // stdin: "ignore" gives claude immediate EOF so it doesn't wait 3s for
        // piped input (the prompt is passed as an argument, not on stdin)
        child = spawn(CLAUDE_BIN, args, { cwd: WORKSPACE, env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        send({ type: "error", error: "could not start claude: " + e.message });
        return res.end();
      }
      let sawError = false;
      child.stdout.on("data", (d) => send({ type: "text", text: d.toString() }));
      child.stderr.on("data", (d) => send({ type: "stderr", text: d.toString() }));
      child.on("error", (e) => {
        sawError = true;
        if (e.code === "ENOENT") send({ type: "error", error: "claude CLI not found on PATH — install it with: npm i -g @anthropic-ai/claude-code" });
        else send({ type: "error", error: e.message });
        res.end();
      });
      child.on("close", (code) => {
        if (sawError) return;
        send({ type: "done", exitCode: code, success: code === 0 });
        res.end();
      });
      // client hit Ctrl+C (aborted fetch) → stop the CLI, keep the files
      req.on("close", () => { if (child && child.exitCode === null) { try { child.kill("SIGTERM"); } catch {} } });
      return;
    }

    if (url.pathname === "/api/fs/list") {
      const files = (await listFiles(WORKSPACE, "", [])).sort();
      return sendJson(res, cors, 200, { files });
    }

    if (url.pathname === "/api/fs/read") {
      const body = await readBody(req);
      const full = safePath(body.path);
      if (!full) return sendJson(res, cors, 400, { error: "bad path" });
      try {
        const content = await fs.readFile(full, "utf8");
        return sendJson(res, cors, 200, { path: body.path, content: content.slice(0, 400000) });
      } catch { return sendJson(res, cors, 404, { error: "not found" }); }
    }

    if (url.pathname === "/api/fs/write") {
      const body = await readBody(req);
      const full = safePath(body.path);
      if (!full) return sendJson(res, cors, 400, { error: "bad path" });
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, String(body.content || ""), "utf8");
      return sendJson(res, cors, 200, { ok: true, path: body.path });
    }

    return sendJson(res, cors, 404, { error: "not found" });
  } catch (err) {
    return sendJson(res, cors, 500, { error: String((err && err.message) || err) });
  }
}

/* ── boot ─────────────────────────────────────────────── */
fss.mkdirSync(WORKSPACE, { recursive: true });
const server = http.createServer((req, res) => { handle(req, res); });
server.listen(PORT, "127.0.0.1", () => {
  const claudeOk = hasBin(CLAUDE_BIN);
  console.log("\n  InspireNavada dev bridge");
  console.log("  ───────────────────────────────────────────");
  console.log("  listening   http://localhost:" + PORT + "  (127.0.0.1 only)");
  console.log("  workspace   " + WORKSPACE);
  console.log("  claude CLI  " + (claudeOk ? "found ✓" : "NOT FOUND ✗  → npm i -g @anthropic-ai/claude-code"));
  console.log("\n  In the dev-mode terminal on the site, run:");
  console.log("    sandbox set http://localhost:" + PORT);
  console.log("    sandbox health");
  console.log("    claude <your task>");
  console.log("\n  Ctrl+C to stop.\n");
});
