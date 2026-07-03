// InspireNavada — Dev Mode desktop: window manager, dock behaviour & apps
(function () {
  "use strict";

  var layer = document.getElementById("devmode");
  var dock = document.getElementById("dock");
  var swInput = document.getElementById("dev-mode");
  if (!layer || !dock) return;

  /* ── tiny helpers ─────────────────────────────────────── */
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pretty(obj) { return JSON.stringify(obj, null, 2); }
  // signed-in builders get their handle everywhere the shell says "builder"
  function currentUser() {
    var u = window.inAuth && window.inAuth.get();
    return u && u.handle ? String(u.handle) : "builder";
  }

  /* ── syntax highlighting (used by editor, terminal, api) ── */
  function hlWith(src, re, classNames) {
    var out = "", last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      var cls = "";
      for (var g = 1; g < m.length; g++) if (m[g] != null) { cls = classNames[g - 1]; break; }
      out += '<i class="' + cls + '">' + esc(m[0]) + "</i>";
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out + esc(src.slice(last));
  }
  var HL = {
    js: { re: /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|var|function|return|if|else|for|while|of|in|new|class|import|export|from|typeof|true|false|null|undefined|this)\b|(\b\d+(?:\.\d+)?\b)/g, cls: ["c", "s", "k", "n"] },
    json: { re: /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g, cls: ["c", "s", "k", "n"] },
    css: { re: /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'[^'\n]*')|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|s|ms|vh|vw)?\b)|((?:^|\n)\s*[.#:>@a-zA-Z][^{\n;]*(?=\{))/g, cls: ["c", "s", "n", "t"] },
    html: { re: /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z][^>]*>)/g, cls: ["c", "t"] },
    md: { re: /((?:^|\n)#{1,6}[^\n]*)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|((?:^|\n)\s*[-*]\s)/g, cls: ["k", "s", "n", "t"] },
  };
  var EXT_LANG = { js: "js", mjs: "js", json: "json", jsonc: "json", css: "css", html: "html", htm: "html", md: "md" };
  function hl(src, ext) {
    var rule = HL[EXT_LANG[ext] || ext];
    if (!rule) return esc(src);
    return hlWith(src, rule.re, rule.cls);
  }
  function extOf(path) {
    var base = path.split("/").pop();
    return base.indexOf(".") > 0 ? base.split(".").pop().toLowerCase() : "";
  }

  /* ── virtual filesystem (shared by Terminal + Code Editor) ── */
  function F(content) { return { type: "file", content: content }; }
  function D(children) { return { type: "dir", children: children }; }

  var FS = D({
    ".zshrc": F('export EDITOR=vim\nalias g="git"\nalias ll="ls -la"\nalias dev="cd ~/inspirenavada"\n'),
    "README.md": F("# builder@inspirenavada\n\nHome directory for hackathon builds.\n\n- current entry: **The Offline-First Challenge** (№ 032)\n- rank: Tier II — Contributor\n"),
    notes: D({
      "todo.md": F("# todo\n\n- [x] ship the industrial dev-mode switch\n- [x] dock with macOS magnification\n- [x] windows + working apps\n- [ ] offline-first entry: finish the sync engine\n- [ ] write the submission notes before Friday\n"),
      "ideas.md": F("# ideas\n\n- CRDT-based notes app that merges offline edits\n- service-worker cache that survives airplane mode\n- `sync-diff` CLI to inspect pending offline mutations\n"),
    }),
    inspirenavada: D({
      "README.md": F("# inspirenavada\n\nOnline hackathons & a home for young builders.\nOnline everywhere, headquartered nowhere.\n\n## Dev\n\nNo build step. Open `index.html` and go.\nDeployed on Cloudflare Pages via `wrangler`.\n"),
      "index.html": F('<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>InspireNavada</title>\n  <link rel="stylesheet" href="assets/styles.css" />\n</head>\n<body>\n  <header class="masthead">\n    <a class="wordmark" href="#top">inspirenavada<sup>*</sup></a>\n  </header>\n  <script src="assets/main.js"></script>\n</body>\n</html>\n'),
      "wrangler.jsonc": F('{\n  // Cloudflare Pages config\n  "name": "inspirenavada",\n  "compatibility_date": "2026-06-01",\n  "pages_build_output_dir": "."\n}\n'),
      assets: D({
        "styles.css": F("/* editorial design system */\n:root {\n  --paper: #F7F4EC;\n  --ink: #141414;\n  --red: #C8102E;\n  --mono: 'Spline Sans Mono', monospace;\n}\n\nbody {\n  background: var(--paper);\n  color: var(--ink);\n}\n"),
        "main.js": F('// live countdowns & the industrial switch\n(function () {\n  "use strict";\n\n  var timers = document.querySelectorAll(".countdown[data-deadline]");\n  // scoring happens in public — so do deadlines\n  setInterval(function () {\n    /* tick */\n  }, 1000);\n})();\n'),
      }),
    }),
  });

  var fsListeners = [];
  function fsEmit() {
    fsListeners.forEach(function (fn) { fn(); });
    scheduleWorkspaceSave();
  }

  function resolvePath(cwd, p) {
    var segs;
    if (!p || p === "~" || p === "~/") segs = [];
    else if (p.slice(0, 2) === "~/") segs = p.slice(2).split("/");
    else if (p[0] === "/") segs = p.split("/");
    else segs = cwd.concat(p.split("/"));
    var out = [];
    segs.filter(Boolean).forEach(function (s) {
      if (s === ".") return;
      if (s === "..") out.pop();
      else out.push(s);
    });
    return out;
  }
  function nodeAt(segs) {
    var n = FS;
    for (var i = 0; i < segs.length; i++) {
      if (n.type !== "dir" || !n.children[segs[i]]) return null;
      n = n.children[segs[i]];
    }
    return n;
  }

  /* ── git state (fed by editor saves & terminal writes) ── */
  var GIT = {
    branch: "main",
    ahead: 0,
    modified: [],
    staged: [],
    log: [
      { hash: "cbf9343", msg: "Dock: dev tool icons, wider spacing, stronger macOS zoom", meta: "Chopstiiiix · 14 hours ago" },
      { hash: "b773224", msg: "Dock: static bar, mild in-place icon zoom, back on the switch line", meta: "Chopstiiiix · 14 hours ago" },
      { hash: "0f46c89", msg: "Dock: layout-based magnification, no dots, smaller and lower", meta: "Chopstiiiix · 15 hours ago" },
      { hash: "7adb48e", msg: "Dev Mode: switch-on slides to screen edge, dark desktop with nav dock", meta: "Chopstiiiix · 16 hours ago" },
      { hash: "3cc706b", msg: "Dev Mode switch: smaller, spaced from card, off by default", meta: "Chopstiiiix · 17 hours ago" },
    ],
    listeners: [],
  };
  function gitEmit() {
    GIT.listeners.forEach(function (fn) { fn(); });
    scheduleWorkspaceSave();
  }
  function gitTouch(path) {
    if (GIT.modified.indexOf(path) < 0 && GIT.staged.indexOf(path) < 0) GIT.modified.push(path);
    gitEmit();
  }

  /* ── workspace persistence: signed-in users keep FS + git across
        reloads and devices (Supabase); guests stay in-memory ── */
  var FS_PRISTINE = JSON.stringify(FS.children);
  function gitSnapshot() {
    return { branch: GIT.branch, ahead: GIT.ahead, modified: GIT.modified, staged: GIT.staged, log: GIT.log };
  }
  var GIT_PRISTINE = JSON.stringify(gitSnapshot());
  var wsUser;            // uid the in-page workspace currently belongs to
  var wsReady = false;   // saves allowed only after the remote copy is loaded
  var wsPending = false; // a change arrived while the remote copy was loading
  var wsSaveTimer = null;

  function applyGitSnapshot(g) {
    GIT.branch = g.branch || "main";
    GIT.ahead = g.ahead || 0;
    GIT.modified = g.modified || [];
    GIT.staged = g.staged || [];
    if (g.log && g.log.length) GIT.log = g.log;
  }

  function scheduleWorkspaceSave() {
    if (!window.inWorkspace) return;
    if (!wsReady) { wsPending = true; return; }
    clearTimeout(wsSaveTimer);
    wsSaveTimer = setTimeout(function () {
      window.inWorkspace.save(FS, gitSnapshot()).catch(function () { /* offline — keep working in-memory */ });
    }, 2000);
  }

  function syncWorkspaceForUser() {
    var u = window.inAuth && window.inAuth.get();
    var uid = u ? u.loginId.split(".")[0] : null;
    if (uid === wsUser) return;
    // account changed (or signed out): reset to the pristine sandbox first
    wsUser = uid;
    wsReady = false;
    wsPending = false;
    clearTimeout(wsSaveTimer);
    FS.children = JSON.parse(FS_PRISTINE);
    applyGitSnapshot(JSON.parse(GIT_PRISTINE));
    fsListeners.forEach(function (fn) { fn(); });
    GIT.listeners.forEach(function (fn) { fn(); });
    if (!uid || !window.inWorkspace) return; // guests: in-memory only
    window.inWorkspace.load().then(function (data) {
      if (wsUser !== uid) return; // user switched while the fetch was in flight
      if (data) {
        if (data.fs && data.fs.children) FS.children = data.fs.children;
        if (data.git) applyGitSnapshot(data.git);
        fsListeners.forEach(function (fn) { fn(); });
        GIT.listeners.forEach(function (fn) { fn(); });
      }
      wsReady = true; // no row yet is fine — first change creates it
      if (wsPending) { wsPending = false; scheduleWorkspaceSave(); }
    }).catch(function () { /* offline — stay in-memory, don't overwrite remote */ });
  }

  /* ── sample database ──────────────────────────────────── */
  var DB = {
    builders: [
      { id: 1, handle: "pris", tier: "V", points: 5240, country: "KE" },
      { id: 2, handle: "kemi_a", tier: "IV", points: 3120, country: "NG" },
      { id: 3, handle: "tunde_builds", tier: "IV", points: 2841, country: "NG" },
      { id: 4, handle: "rgw", tier: "III", points: 1904, country: "GB" },
      { id: 5, handle: "yuewang", tier: "III", points: 1688, country: "CN" },
      { id: 6, handle: "dfranco", tier: "III", points: 1512, country: "BR" },
      { id: 7, handle: "mabel_dev", tier: "II", points: 811, country: "US" },
      { id: 8, handle: "jnr", tier: "II", points: 745, country: "GH" },
      { id: 9, handle: "lisbet", tier: "I", points: 203, country: "SE" },
      { id: 10, handle: "ozan", tier: "I", points: 188, country: "TR" },
    ],
    hackathons: [
      { id: 30, title: "Ship It Weekend", track: "Product", prize: 4000, entries: 318, status: "closed" },
      { id: 31, title: "Agents That Do Chores", track: "ML / Research", prize: 9000, entries: 502, status: "closed" },
      { id: 32, title: "The Offline-First Challenge", track: "Engineering", prize: 12000, entries: 642, status: "open" },
      { id: 33, title: "Small Models, Big Ideas", track: "ML / Research", prize: 8000, entries: 417, status: "open" },
      { id: 34, title: "The 48-Hour Game Jam", track: "Games", prize: 5000, entries: 0, status: "scheduled" },
      { id: 35, title: "Tools for One Person", track: "Product", prize: 6500, entries: 0, status: "scheduled" },
    ],
    submissions: [
      { id: 9401, team: "null pointer club", hackathon_id: 32, score: 94.821, submitted: "2026-07-03 14:36" },
      { id: 9398, team: "two grads & a laptop", hackathon_id: 32, score: 94.377, submitted: "2026-07-03 12:02" },
      { id: 9395, team: "cache me outside", hackathon_id: 32, score: 93.94, submitted: "2026-07-03 13:59" },
      { id: 9382, team: "solo: @tunde_builds", hackathon_id: 32, score: 93.104, submitted: "2026-07-03 11:41" },
      { id: 9377, team: "the sleep deprived", hackathon_id: 32, score: 92.688, submitted: "2026-07-03 07:22" },
      { id: 9351, team: "gradient dissent", hackathon_id: 33, score: 88.914, submitted: "2026-07-02 22:10" },
      { id: 9344, team: "tiny giants", hackathon_id: 33, score: 87.45, submitted: "2026-07-02 19:03" },
      { id: 9317, team: "overfit club", hackathon_id: 33, score: 83.212, submitted: "2026-07-01 16:44" },
    ],
  };

  /* ── minimal SQL engine ───────────────────────────────── */
  function runSQL(q) {
    q = q.trim().replace(/;\s*$/, "");
    if (/^show\s+tables$/i.test(q)) {
      return { cols: ["table", "rows"], rows: Object.keys(DB).map(function (t) { return [t, DB[t].length]; }) };
    }
    var dm = q.match(/^(?:describe|desc)\s+(\w+)$/i);
    if (dm) {
      var dt = DB[dm[1].toLowerCase()];
      if (!dt) throw new Error("unknown table: " + dm[1]);
      return { cols: ["column", "type"], rows: Object.keys(dt[0]).map(function (c) { return [c, typeof dt[0][c] === "number" ? "numeric" : "text"]; }) };
    }
    var m = q.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+(\w+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?$/i);
    if (!m) throw new Error("Couldn't parse that. Supported:\n  SELECT cols FROM table [WHERE col op val [AND …]]\n         [ORDER BY col [DESC]] [LIMIT n]\n  SHOW TABLES · DESCRIBE table\n  ops: = != > < >= <= LIKE");
    var table = DB[m[2].toLowerCase()];
    if (!table) throw new Error("unknown table: " + m[2] + " (try SHOW TABLES)");
    var rows = table.slice();

    if (m[3]) {
      m[3].split(/\s+and\s+/i).forEach(function (cond) {
        var cm = cond.trim().match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<|like)\s*(.+)$/i);
        if (!cm) throw new Error("bad WHERE clause: " + cond);
        var col = cm[1].toLowerCase(), op = cm[2].toLowerCase();
        var val = cm[3].trim().replace(/^['"]|['"]$/g, "");
        if (!(col in table[0])) throw new Error("unknown column: " + col);
        var num = parseFloat(val);
        rows = rows.filter(function (r) {
          var cell = r[col];
          if (op === "like") {
            var rx = new RegExp("^" + val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
            return rx.test(String(cell));
          }
          var a = typeof cell === "number" ? cell : String(cell).toLowerCase();
          var b = typeof cell === "number" && !isNaN(num) ? num : val.toLowerCase();
          switch (op) {
            case "=": return a === b;
            case "!=": case "<>": return a !== b;
            case ">": return a > b;
            case "<": return a < b;
            case ">=": return a >= b;
            case "<=": return a <= b;
          }
        });
      });
    }
    if (m[4]) {
      var oc = m[4].toLowerCase();
      if (!(oc in table[0])) throw new Error("unknown column: " + oc);
      var dir = (m[5] || "asc").toLowerCase() === "desc" ? -1 : 1;
      rows.sort(function (a, b) { return (a[oc] > b[oc] ? 1 : a[oc] < b[oc] ? -1 : 0) * dir; });
    }
    if (m[6]) rows = rows.slice(0, +m[6]);

    var colSpec = m[1].trim();
    if (/^count\(\*\)$/i.test(colSpec)) return { cols: ["count(*)"], rows: [[rows.length]] };
    var cols = colSpec === "*" ? Object.keys(table[0]) : colSpec.split(",").map(function (c) { return c.trim().toLowerCase(); });
    cols.forEach(function (c) { if (!(c in table[0])) throw new Error("unknown column: " + c); });
    return { cols: cols, rows: rows.map(function (r) { return cols.map(function (c) { return r[c]; }); }) };
  }

  /* ── fake API (used by API Console + terminal curl) ───── */
  var API_LIST = [
    { m: "GET", p: "/api" },
    { m: "GET", p: "/api/stats" },
    { m: "GET", p: "/api/hackathons" },
    { m: "GET", p: "/api/hackathons/32" },
    { m: "GET", p: "/api/standings?limit=5" },
    { m: "GET", p: "/api/builders" },
    { m: "POST", p: "/api/submissions" },
  ];
  function fakeApi(method, url, payload) {
    var parts = url.split("?");
    var path = parts[0].replace(/\/+$/, "") || "/";
    var params = {};
    (parts[1] || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
    });
    function ok(b, code) { return { status: code || 200, body: b }; }

    if (method === "GET") {
      if (path === "/api") return ok({ service: "inspirenavada-api", version: "1.4.2", region: "everywhere", endpoints: API_LIST.map(function (e) { return e.m + " " + e.p.split("?")[0]; }) });
      if (path === "/api/stats") return ok({ builders: 14208, countries: 96, hackathons_run: 31, prizes_awarded_usd: 214500, projects_shipped: 2417, latest_submission: "41s ago" });
      if (path === "/api/hackathons") {
        var st = params.status;
        var hs = DB.hackathons.filter(function (h) { return !st || h.status === st; });
        return ok({ count: hs.length, hackathons: hs });
      }
      var hm = path.match(/^\/api\/hackathons\/(\d+)$/);
      if (hm) {
        var h = DB.hackathons.filter(function (x) { return x.id === +hm[1]; })[0];
        return h ? ok(h) : ok({ error: "no hackathon with id " + hm[1] }, 404);
      }
      if (path === "/api/standings") {
        var lim = Math.min(+params.limit || 10, 50);
        var standings = DB.submissions
          .filter(function (s) { return s.hackathon_id === 32; })
          .sort(function (a, b) { return b.score - a.score; })
          .slice(0, lim)
          .map(function (s, i) { return { rank: i + 1, team: s.team, score: s.score, last_entry: s.submitted }; });
        return ok({ hackathon: "The Offline-First Challenge", refreshed: "41s ago", standings: standings });
      }
      if (path === "/api/builders") return ok({ count: DB.builders.length, builders: DB.builders });
    }
    if (method === "POST" && path === "/api/submissions") {
      var b;
      try { b = payload ? JSON.parse(payload) : {}; }
      catch (e) { return ok({ error: "invalid JSON body", detail: String(e.message) }, 400); }
      if (!b.team) return ok({ error: "field 'team' is required", example: { team: "your team", hackathon_id: 32, repo: "https://…" } }, 422);
      var sub = { id: 9402 + rand(1, 40), team: b.team, hackathon_id: b.hackathon_id || 32, score: null, status: "queued for scoring", eta: rand(20, 90) + "s" };
      DB.submissions.unshift({ id: sub.id, team: sub.team, hackathon_id: sub.hackathon_id, score: 0, submitted: "just now" });
      return ok(sub, 201);
    }
    return ok({ error: "not found", hint: "GET /api lists all endpoints" }, method === "GET" ? 404 : 405);
  }

  /* ══ window manager ══════════════════════════════════════ */
  var wins = {};
  var zTop = 20;
  var focusedName = null;
  var state = { docked: false };

  function dockBtnFor(name) {
    return dock.querySelector('.dock__item[data-label="' + name + '"]');
  }

  function dockShiftY() {
    var baseTop = parseFloat(dock.style.top) || window.innerHeight / 2;
    return window.innerHeight - 16 - dock.offsetHeight / 2 - baseTop;
  }
  function setDocked(on) {
    if (state.docked === on) return;
    state.docked = on;
    dock.style.transition = "transform 0.65s cubic-bezier(0.32, 0.72, 0.28, 1)";
    if (on) {
      dock.classList.add("dock--docked");
      dock.style.transform = "translate(-50%, -50%) translateY(" + dockShiftY() + "px)";
    } else {
      dock.classList.remove("dock--docked");
      dock.style.transform = "";
      setTimeout(function () { if (!state.docked) dock.style.transition = ""; }, 700);
    }
  }
  window.addEventListener("resize", function () {
    if (!state.docked) return;
    var t = dock.style.transition;
    dock.style.transition = "none";
    dock.style.transform = "translate(-50%, -50%) translateY(" + dockShiftY() + "px)";
    requestAnimationFrame(function () { dock.style.transition = t; });
  });

  function focusWin(rec) {
    var wasFocused = focusedName === rec.name;
    Object.keys(wins).forEach(function (n) { wins[n].el.classList.toggle("is-focused", wins[n] === rec); });
    rec.el.classList.add("is-focused");
    rec.el.style.zIndex = ++zTop;
    focusedName = rec.name;
    // only steal keyboard focus on a window switch — re-clicks inside an
    // already-focused window must not kill an in-progress text selection
    if (rec.onFocus && !wasFocused) rec.onFocus();
  }

  function openApp(name) {
    var app = APPS[name];
    if (!app) return;
    var rec = wins[name];
    if (rec) {
      if (rec.min) {
        rec.min = false;
        rec.el.classList.remove("win--min");
        if (rec.onRelaunch) rec.onRelaunch();
      }
      focusWin(rec);
      return;
    }
    setDocked(true);
    rec = createWindow(name, app);
    wins[name] = rec;
    var btn = dockBtnFor(name);
    if (btn) btn.classList.add("is-running");
  }

  function closeApp(name, instant) {
    var rec = wins[name];
    if (!rec) return;
    if (rec.dispose) rec.dispose();
    delete wins[name];
    var btn = dockBtnFor(name);
    if (btn) btn.classList.remove("is-running");
    if (instant) {
      rec.el.remove();
    } else {
      rec.el.classList.remove("is-open");
      rec.el.classList.add("is-closing");
      setTimeout(function () { rec.el.remove(); }, 320);
    }
    if (focusedName === name) focusedName = null;
    if (!Object.keys(wins).length) setDocked(false);
  }

  function minimizeApp(name) {
    var rec = wins[name];
    if (!rec) return;
    rec.min = true;
    rec.el.classList.add("win--min");
    if (focusedName === name) focusedName = null;
  }

  function createWindow(name, app) {
    var el = document.createElement("section");
    el.className = "win";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", name);

    var dockZone = 110; // keep spawn area clear of the docked dock
    var w = Math.min(app.w, window.innerWidth - 48);
    var h = Math.min(app.h, window.innerHeight - dockZone - 32);
    var x = Math.round((window.innerWidth - w) / 2);
    var y = Math.max(16, Math.round((window.innerHeight - dockZone - h) / 2));

    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.zIndex = ++zTop;

    el.innerHTML =
      '<header class="win__bar">' +
        '<div class="win__lights">' +
          '<button class="win__light win__light--close" type="button" aria-label="Close"></button>' +
          '<button class="win__light win__light--min" type="button" aria-label="Minimize"></button>' +
          '<button class="win__light win__light--zoom" type="button" aria-label="Zoom"></button>' +
        "</div>" +
        '<div class="win__title"><strong>' + esc(name) + "</strong><span>" +
          esc(typeof app.subtitle === "function" ? app.subtitle() : app.subtitle) + "</span></div>" +
      "</header>" +
      '<div class="win__body"></div>' +
      '<div class="win__grip" aria-hidden="true"></div>';

    layer.appendChild(el);

    var rec = { name: name, el: el, min: false, maxed: null, dispose: null, onFocus: null };

    el.querySelector(".win__light--close").addEventListener("click", function () { closeApp(name); });
    el.querySelector(".win__light--min").addEventListener("click", function () { minimizeApp(name); });
    el.querySelector(".win__light--zoom").addEventListener("click", function () {
      if (rec.maxed) {
        el.style.left = rec.maxed.left; el.style.top = rec.maxed.top;
        el.style.width = rec.maxed.width; el.style.height = rec.maxed.height;
        rec.maxed = null;
      } else {
        rec.maxed = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
        el.style.left = "14px";
        el.style.top = "14px";
        el.style.width = window.innerWidth - 28 + "px";
        el.style.height = window.innerHeight - 14 - dockZone + "px";
      }
    });

    el.addEventListener("pointerdown", function () { if (wins[name]) focusWin(rec); });

    // drag by title bar
    var bar = el.querySelector(".win__bar");
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".win__light")) return;
      var r = el.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      bar.setPointerCapture(e.pointerId);
      el.classList.add("is-dragging");
      function mv(ev) {
        el.style.left = Math.min(Math.max(ev.clientX - sx, 90 - r.width), window.innerWidth - 90) + "px";
        el.style.top = Math.min(Math.max(ev.clientY - sy, 0), window.innerHeight - 60) + "px";
      }
      function up() {
        bar.removeEventListener("pointermove", mv);
        el.classList.remove("is-dragging");
      }
      bar.addEventListener("pointermove", mv);
      bar.addEventListener("pointerup", up, { once: true });
    });

    // resize by grip
    var grip = el.querySelector(".win__grip");
    grip.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      var r = el.getBoundingClientRect();
      var sx = e.clientX, sy = e.clientY;
      grip.setPointerCapture(e.pointerId);
      function mv(ev) {
        el.style.width = Math.max(380, Math.min(r.width + ev.clientX - sx, window.innerWidth - r.left - 8)) + "px";
        el.style.height = Math.max(240, Math.min(r.height + ev.clientY - sy, window.innerHeight - r.top - 8)) + "px";
      }
      function up() { grip.removeEventListener("pointermove", mv); }
      grip.addEventListener("pointermove", mv);
      grip.addEventListener("pointerup", up, { once: true });
    });

    app.build(el.querySelector(".win__body"), rec);
    focusWin(rec);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add("is-open"); });
    });
    // rAF can be throttled (background tabs, capture) — make sure the window shows up
    setTimeout(function () { el.classList.add("is-open"); }, 250);
    return rec;
  }

  /* ══ apps ════════════════════════════════════════════════ */

  /* ── real Claude agent (BYO API key, browser → api.anthropic.com) ── */
  var CLAUDE_MODEL = "claude-opus-4-8";
  var CLAUDE_MODELS = {
    opus: "claude-opus-4-8",
    sonnet: "claude-sonnet-5",
    haiku: "claude-haiku-4-5",
  };
  function resolveModel(name) {
    if (!name) return null;
    var n = String(name).toLowerCase();
    if (CLAUDE_MODELS[n]) return CLAUDE_MODELS[n];
    if (n.indexOf("claude-") === 0) return n; // full model id passthrough
    return null;
  }

  function allFiles() {
    var res = [];
    (function walk(n, p) {
      Object.keys(n.children).forEach(function (k) {
        var c = n.children[k];
        if (c.type === "dir") walk(c, p + k + "/");
        else res.push(p + k);
      });
    })(FS, "");
    return res;
  }

  var AGENT_TOOLS = [
    {
      name: "list_files",
      description: "List every file in the sandbox workspace (paths relative to the home directory ~).",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "read_file",
      description: "Read a file from the sandbox workspace. Call this before editing a file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to ~, e.g. inspirenavada/assets/main.js" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a file in the sandbox workspace. Missing parent directories are created. The user sees the change in their Code Editor and Git apps.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to ~" },
          content: { type: "string", description: "Full new file content" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "str_replace",
      description: "Replace an exact string in a file with a new string. old_str must appear exactly once in the file.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to ~" },
          old_str: { type: "string", description: "Exact text to replace (must be unique in the file)" },
          new_str: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_str", "new_str"],
        additionalProperties: false,
      },
    },
  ];

  function agentToolRun(name, input) {
    var segs, node, parent, i;
    try {
      switch (name) {
        case "list_files":
          return { text: allFiles().map(function (p) { return "~/" + p; }).join("\n") };
        case "read_file":
          node = nodeAt(resolvePath([], String(input.path || "")));
          if (!node) return { text: "No such file: " + input.path, is_error: true };
          if (node.type === "dir") return { text: input.path + " is a directory", is_error: true };
          return { text: node.content.slice(0, 40000) };
        case "write_file": {
          segs = resolvePath([], String(input.path || ""));
          if (!segs.length) return { text: "write_file needs a file path", is_error: true };
          parent = FS;
          for (i = 0; i < segs.length - 1; i++) {
            if (!parent.children[segs[i]]) parent.children[segs[i]] = D({});
            parent = parent.children[segs[i]];
            if (parent.type !== "dir") return { text: segs[i] + " is a file, not a directory", is_error: true };
          }
          parent.children[segs[segs.length - 1]] = F(String(input.content));
          gitTouch("~/" + segs.join("/"));
          fsEmit();
          return { text: "Wrote ~/" + segs.join("/") + " (" + String(input.content).length + " chars)" };
        }
        case "str_replace": {
          segs = resolvePath([], String(input.path || ""));
          node = nodeAt(segs);
          if (!node || node.type !== "file") return { text: "No such file: " + input.path, is_error: true };
          var hits = node.content.split(String(input.old_str)).length - 1;
          if (hits === 0) return { text: "old_str not found in " + input.path, is_error: true };
          if (hits > 1) return { text: "old_str appears " + hits + " times in " + input.path + " — it must be unique", is_error: true };
          node.content = node.content.replace(String(input.old_str), String(input.new_str));
          gitTouch("~/" + segs.join("/"));
          fsEmit();
          return { text: "Edited ~/" + segs.join("/") };
        }
        default:
          return { text: "Unknown tool: " + name, is_error: true };
      }
    } catch (e) {
      return { text: "Tool failed: " + e.message, is_error: true };
    }
  }

  function agentSystemPrompt() {
    return (
      "You are Claude Code, running inside InspireNavada's browser-based dev-mode desktop for user @" + currentUser() + ". " +
      "You work on a small sandboxed virtual filesystem (home directory ~) via your tools; edits you make appear live in the user's Code Editor and Git apps. " +
      "The project is 'inspirenavada', a static website with no build step. The platform's running hackathon is № 032 'The Offline-First Challenge' (closes 2026-07-19). " +
      "Output rules: your replies render in a plain terminal, so write plain text — no markdown headings, bold, or fenced code blocks; indent code by two spaces instead. " +
      "Be concise. Read files before editing them. When asked to build or change something, actually do it with the tools rather than describing what you would do."
    );
  }

  function anthropicStream(key, model, messages, signal, onText) {
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 16000,
        stream: true,
        // Haiku 4.5 predates adaptive thinking; JSON.stringify drops the undefined
        thinking: model.indexOf("haiku") < 0 ? { type: "adaptive" } : undefined,
        system: agentSystemPrompt(),
        tools: AGENT_TOOLS,
        messages: messages,
      }),
    }).then(
      function (r) {
        if (!r.ok) {
          return r.json().then(function (j) {
            var msg = (j && j.error && j.error.message) || ("HTTP " + r.status);
            var err = new Error(msg);
            err.status = r.status;
            throw err;
          });
        }
        return readSSE(r, onText);
      },
      function (err) {
        if (err && err.name === "AbortError") throw err;
        throw new Error("network error — couldn't reach api.anthropic.com");
      }
    );
  }

  // minimal SSE reader for the Messages streaming shape:
  // accumulates content blocks, streams text deltas out via onText
  function readSSE(response, onText) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";
    var blocks = [];
    var stopReason = null;

    function handleEvent(ev) {
      if (ev.type === "content_block_start") {
        var b = ev.content_block;
        blocks[ev.index] = b.type === "tool_use"
          ? { type: "tool_use", id: b.id, name: b.name, input: {}, _json: "" }
          : b.type === "thinking"
            ? { type: "thinking", thinking: b.thinking || "", signature: "" }
            : { type: b.type, text: b.text || "" };
      } else if (ev.type === "content_block_delta") {
        var blk = blocks[ev.index];
        if (!blk) return;
        if (ev.delta.type === "text_delta") {
          blk.text += ev.delta.text;
          if (blk.type === "text" && onText) onText(ev.delta.text);
        } else if (ev.delta.type === "input_json_delta") {
          blk._json += ev.delta.partial_json;
        } else if (ev.delta.type === "thinking_delta") {
          blk.thinking += ev.delta.thinking;
        } else if (ev.delta.type === "signature_delta") {
          blk.signature = (blk.signature || "") + ev.delta.signature;
        }
      } else if (ev.type === "content_block_stop") {
        var done = blocks[ev.index];
        if (done && done.type === "tool_use") {
          try { done.input = done._json ? JSON.parse(done._json) : {}; } catch (e) { done.input = {}; }
          delete done._json;
        }
      } else if (ev.type === "message_delta") {
        if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        var err = new Error((ev.error && ev.error.message) || "stream error");
        throw err;
      }
    }

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return { content: blocks.filter(Boolean), stop_reason: stopReason };
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop(); // keep the trailing partial line
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf("data: ") !== 0) continue;
          var payload = line.slice(6).trim();
          if (!payload) continue;
          handleEvent(JSON.parse(payload));
        }
        return pump();
      });
    }
    return pump();
  }

  /* ── Terminal ─────────────────────────────────────────── */
  var OPEN_ALIASES = {
    terminal: "Terminal", term: "Terminal",
    editor: "Code Editor", code: "Code Editor",
    git: "Git",
    db: "Database", database: "Database", sql: "Database",
    api: "API Console",
    containers: "Containers", docker: "Containers",
    logs: "Logs",
    profiler: "Profiler", perf: "Profiler",
  };
  var bootTime = Date.now();
  var TERM_HIST = []; // survives relaunches so ↑ still recalls past commands

  function buildTerminal(body, rec) {
    body.classList.add("app-term");
    body.innerHTML =
      '<div class="term">' +
        '<div class="term__out"></div>' +
        '<div class="term__line"><span class="term__ps1"></span>' +
        '<input class="term__in" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Terminal input" /></div>' +
      "</div>";
    var out = body.querySelector(".term__out");
    var input = body.querySelector(".term__in");
    var ps1 = body.querySelector(".term__ps1");
    var cwd = ["inspirenavada"];
    var hist = TERM_HIST;
    var hi = hist.length;
    var claudeMode = false;
    var claudeIdle = 0;
    var claudeReal = false;    // true when a linked API key backs the session
    var claudeBusy = false;
    var claudeHistory = [];
    var claudeModel = CLAUDE_MODEL;
    var claudeAbort = null;    // AbortController for the in-flight turn

    function pathStr() { return "~" + (cwd.length ? "/" + cwd.join("/") : ""); }
    function ps1Str() {
      return claudeMode ? "✻ >" : currentUser() + "@inspirenavada " + pathStr() + " %";
    }
    function prompt() { ps1.textContent = ps1Str(); }
    function print(html) {
      var d = document.createElement("div");
      d.innerHTML = html;
      out.appendChild(d);
      out.scrollTop = out.scrollHeight;
    }
    function say(text, cls) { print('<span class="' + (cls || "") + '">' + esc(text) + "</span>"); }

    function lsHTML(node) {
      var names = Object.keys(node.children).sort(function (a, b) {
        var da = node.children[a].type === "dir", db = node.children[b].type === "dir";
        return da === db ? a.localeCompare(b) : da ? -1 : 1;
      });
      if (!names.length) return '<span class="t-dim">(empty)</span>';
      return names.map(function (n) {
        return node.children[n].type === "dir" ? '<span class="t-path">' + esc(n) + "/</span>" : esc(n);
      }).join("  ");
    }

    /* `claude` — sandbox answers (used when no API key is connected) */
    function claudeAnswer(q) {
      var ql = q.toLowerCase();
      var lines = [];
      function a(text, cls) { lines.push('<span class="' + (cls || "") + '">' + esc(text) + "</span>"); }

      var filePath = allFiles().filter(function (p) {
        return ql.indexOf(p.split("/").pop().toLowerCase()) >= 0;
      })[0];

      if (/^\/?help$/.test(ql) || /what can you do/.test(ql)) {
        a("Here in the sandbox I can:");
        a("  · read this repo — mention any file by name and I'll open it");
        a("  · summarise the project, your todos, or `git status`");
        a("  · brief you on the running hackathon and the standings");
        a("  /exit (or Ctrl+C) hands you back to zsh.", "t-dim");
      } else if (/^(hi|hey|hello|yo|sup)\b/.test(ql)) {
        a("Hey @" + currentUser() + ". Ready when you are — ask about the repo, your todos, or the hackathon.");
      } else if (/who are you|what are you|are you real/.test(ql)) {
        a("I'm Claude Code — well, a sandboxed stand-in running entirely in your browser tab.");
        a("No API key, no network. Everything I know lives in this dev-mode toy box.", "t-dim");
      } else if (filePath) {
        var f = nodeAt(filePath.split("/"));
        var preview = f.content.split("\n").slice(0, 6).join("\n");
        a("Read ~/" + filePath + ":");
        lines.push('<span class="hlt">' + hl(preview, extOf(filePath)) + "</span>");
        a(f.content.split("\n").length > 6 ? "  …use `cat " + filePath.split("/").pop() + "` for the rest." : "  That's the whole file.", "t-dim");
      } else if (/(files|repo|project|codebase|structure)/.test(ql)) {
        a("This workspace has " + allFiles().length + " files:");
        allFiles().forEach(function (p) { a("  ~/" + p, "t-path"); });
        a("Static site, no build step — index.html plus assets. Refreshingly boring.", "t-dim");
      } else if (/(todo|task|next|plan)/.test(ql)) {
        a("From ~/notes/todo.md — the sync engine and the submission notes are still open:");
        lines.push('<span class="hlt">' + hl(nodeAt(["notes", "todo.md"]).content.trim(), "md") + "</span>");
        a("Deadline math says do the sync engine first.", "t-dim");
      } else if (/(hackathon|offline|deadline|challenge|№|032)/.test(ql)) {
        var msLeft = Date.parse("2026-07-19T23:59:00Z") - Date.now();
        var d = Math.floor(msLeft / 86400000), h = Math.floor((msLeft % 86400000) / 3600000);
        a("The Offline-First Challenge (№ 032): $12,000 pool, 642 entries, closes in " + d + "d " + h + "h.");
        a("Build software that survives a dead connection — which, notably, I currently am.", "t-dim");
      } else if (/(standing|leaderboard|rank|winning|score)/.test(ql)) {
        a("Top of the № 032 board right now:");
        DB.submissions.filter(function (s) { return s.hackathon_id === 32; })
          .sort(function (x, y) { return y.score - x.score; })
          .slice(0, 3)
          .forEach(function (s, i) { a("  " + (i + 1) + ". " + s.team + " — " + s.score.toFixed(3)); });
        a("Half a point separates the podium. Ship something.", "t-dim");
      } else if (/(fix|bug|error|broken|debug)/.test(ql)) {
        a("I'd normally read the stack trace, but this sandbox has a strict no-real-bugs policy.");
        a("Try `git status` — " + (GIT.modified.length + GIT.staged.length ? "you do have uncommitted changes sitting there." : "your tree is clean, so the bug is hiding somewhere braver."), "t-dim");
      } else if (/(commit|push|git)/.test(ql)) {
        var pending = GIT.modified.length + GIT.staged.length;
        a(pending
          ? "You have " + pending + " changed file" + (pending === 1 ? "" : "s") + ". The Git app on the dock will stage and commit them."
          : "Working tree is clean on `" + GIT.branch + "`" + (GIT.ahead ? ", but you're ahead by " + GIT.ahead + " — push it." : " and in sync. Nothing to do but write more code."));
      } else if (/(joke|funny|laugh)/.test(ql)) {
        a("A hackathon team named their sync engine \"Schrödinger\" — its state was unknowable until the demo. It did not survive observation.");
      } else {
        var stock = [
          ["Good question. My honest sandbox answer: I'd start by reading the repo — mention a file by name and I'll open it."],
          ["I only know this little world — the repo, the todos, hackathon № 032. Within it, I'm surprisingly confident. Try `/help`."],
          ["That's beyond my sandbox, but the instinct is right. Locally I can read files, check git, or talk standings."],
        ];
        stock[claudeIdle++ % stock.length].forEach(function (t) { a(t); });
      }
      return lines;
    }

    function claudeReply(q) {
      var thinking = document.createElement("div");
      thinking.innerHTML = '<span class="t-dim">✻ thinking…</span>';
      out.appendChild(thinking);
      out.scrollTop = out.scrollHeight;
      setTimeout(function () {
        thinking.remove();
        var lines = claudeAnswer(q);
        print('<span class="t-claude">⏺</span> ' + lines[0]);
        lines.slice(1).forEach(function (l) { print("  " + l); });
        print("&nbsp;");
      }, rand(450, 1000));
    }

    function exitClaude(msg) {
      claudeMode = false;
      claudeReal = false;
      claudeBusy = false;
      claudeHistory = [];
      say(msg || "✻ session ended — back to zsh", "t-dim");
      prompt();
    }

    /* real agent loop: streaming Messages API + tool use over the sandbox FS */
    function realClaudeReply(q) {
      var key = window.claudeLink && window.claudeLink.getKey();
      if (!key) { exitClaude("✻ key disconnected — back to zsh"); return; }
      claudeBusy = true;
      claudeAbort = new AbortController();
      // keep the context bounded; a clean reset avoids orphaned tool_use pairs
      if (claudeHistory.length > 60) {
        claudeHistory = [];
        say("✻ (long session — context reset)", "t-dim");
      }
      var turnStart = claudeHistory.length; // rollback point on abort/error
      claudeHistory.push({ role: "user", content: q });

      var thinking = document.createElement("div");
      thinking.innerHTML = '<span class="t-dim">✻ working…</span>';
      out.appendChild(thinking);
      out.scrollTop = out.scrollHeight;
      var hops = 0;
      var liveSpan = null; // text streams into here as it generates

      function onText(t) {
        if (!liveSpan) {
          var d = document.createElement("div");
          d.innerHTML = '<span class="t-claude">⏺</span> <span class="t-stream"></span>';
          out.insertBefore(d, thinking);
          liveSpan = d.querySelector(".t-stream");
        }
        liveSpan.textContent += t;
        out.scrollTop = out.scrollHeight;
      }

      function finish() {
        thinking.remove();
        print("&nbsp;");
        claudeBusy = false;
        claudeAbort = null;
        out.scrollTop = out.scrollHeight;
      }

      function fail(err) {
        thinking.remove();
        claudeHistory.length = turnStart; // clean slate for a retry
        if (err && err.name === "AbortError") {
          say("✻ interrupted", "t-dim");
        } else {
          say("✻ " + err.message, "t-err");
          if (err.status === 401) say("  the key was rejected — reconnect via the account menu or `claude connect`", "t-dim");
          else if (err.status === 429) say("  rate limited — wait a moment and try again", "t-dim");
        }
        claudeBusy = false;
        claudeAbort = null;
        prompt();
      }

      function step() {
        liveSpan = null; // fresh stream element per round
        anthropicStream(key, claudeModel, claudeHistory, claudeAbort.signal, onText).then(function (res) {
          if (res.stop_reason === "refusal") {
            say("✻ Claude declined that request.", "t-err");
            claudeHistory.length = turnStart;
            finish();
            return;
          }
          claudeHistory.push({ role: "assistant", content: res.content });
          var toolUses = res.content.filter(function (b) { return b.type === "tool_use"; });
          if (res.stop_reason === "tool_use" && toolUses.length && hops++ < 12) {
            var results = toolUses.map(function (tu) {
              var label = tu.name + "(" + (tu.input && (tu.input.path || "") || "") + ")";
              print('<span class="t-dim">  ⚒ ' + esc(label) + "</span>");
              var r = agentToolRun(tu.name, tu.input || {});
              var result = { type: "tool_result", tool_use_id: tu.id, content: r.text };
              if (r.is_error) result.is_error = true;
              return result;
            });
            claudeHistory.push({ role: "user", content: results });
            out.scrollTop = out.scrollHeight;
            step();
          } else {
            if (res.stop_reason === "max_tokens") say("✻ (response hit the token limit)", "t-dim");
            if (hops >= 12) say("✻ (stopped after 12 tool rounds)", "t-dim");
            finish();
          }
        }).catch(fail);
      }
      step();
    }

    function exec(raw) {
      print('<span class="t-ok">' + esc(ps1Str()) + "</span> " + esc(raw));
      var line = raw.trim();
      if (!line) return;
      hist.push(raw);
      hi = hist.length;

      if (claudeMode) {
        if (claudeBusy) {
          say("✻ still working — Ctrl+C interrupts", "t-dim");
          return;
        }
        if (/^\/?(exit|quit|q)$/i.test(line)) exitClaude();
        else if (/^\/model(\s|$)/i.test(line)) {
          var wanted = resolveModel(line.split(/\s+/)[1]);
          if (wanted) {
            claudeModel = wanted;
            say("✻ model → " + claudeModel, "t-dim");
          } else {
            say("✻ model: " + claudeModel + " · switch with /model opus · sonnet · haiku", "t-dim");
          }
        }
        else if (claudeReal) realClaudeReply(line);
        else claudeReply(line);
        prompt();
        return;
      }

      var parts = line.split(/\s+/);
      var cmd = parts[0], args = parts.slice(1);
      var target, node, segs, parent, name;

      switch (cmd) {
        case "help":
          say("InspireNavada devshell — available commands:", "t-dim");
          say("  ls cd pwd cat echo mkdir touch rm clear history");
          say("  git <status|log|branch>   curl <path>   open <app>   apps");
          say("  claude   whoami date uname neofetch sudo exit");
          say("tip: `open editor` launches other dock apps · `claude` starts a pairing session.", "t-dim");
          break;
        case "ls":
          target = args.filter(function (a) { return a[0] !== "-"; })[0];
          node = nodeAt(resolvePath(cwd, target || "."));
          if (!node) say("ls: " + target + ": No such file or directory", "t-err");
          else if (node.type === "file") say(target);
          else print(lsHTML(node));
          break;
        case "pwd":
          say("/home/" + currentUser() + (cwd.length ? "/" + cwd.join("/") : ""));
          break;
        case "cd":
          segs = resolvePath(cwd, args[0] || "~");
          node = nodeAt(segs);
          if (!node) say("cd: no such file or directory: " + args[0], "t-err");
          else if (node.type !== "dir") say("cd: not a directory: " + args[0], "t-err");
          else cwd = segs;
          break;
        case "cat":
          if (!args.length) { say("usage: cat <file>", "t-dim"); break; }
          args.forEach(function (a) {
            var n = nodeAt(resolvePath(cwd, a));
            if (!n) say("cat: " + a + ": No such file or directory", "t-err");
            else if (n.type === "dir") say("cat: " + a + ": Is a directory", "t-err");
            else print('<span class="hlt">' + hl(n.content, extOf(a)) + "</span>");
          });
          break;
        case "echo": {
          var rest = raw.replace(/^\s*echo\s?/, "");
          var gt = rest.indexOf(">");
          if (gt >= 0) {
            var text = rest.slice(0, gt).trim().replace(/^["']|["']$/g, "");
            var fname = rest.slice(gt + 1).trim();
            segs = resolvePath(cwd, fname);
            parent = nodeAt(segs.slice(0, -1));
            name = segs[segs.length - 1];
            if (!parent || parent.type !== "dir" || !name) { say("echo: cannot write: " + fname, "t-err"); break; }
            parent.children[name] = F(text + "\n");
            gitTouch("~/" + segs.join("/"));
            fsEmit();
          } else {
            say(rest.replace(/^["']|["']$/g, ""));
          }
          break;
        }
        case "mkdir":
        case "touch":
          if (!args[0]) { say("usage: " + cmd + " <name>", "t-dim"); break; }
          segs = resolvePath(cwd, args[0]);
          parent = nodeAt(segs.slice(0, -1));
          name = segs[segs.length - 1];
          if (!parent || parent.type !== "dir" || !name) { say(cmd + ": cannot create: " + args[0], "t-err"); break; }
          if (parent.children[name]) { if (cmd === "mkdir") say("mkdir: " + args[0] + ": File exists", "t-err"); break; }
          parent.children[name] = cmd === "mkdir" ? D({}) : F("");
          fsEmit();
          break;
        case "rm": {
          var recursive = args.indexOf("-r") >= 0 || args.indexOf("-rf") >= 0;
          target = args.filter(function (a) { return a[0] !== "-"; })[0];
          if (!target) { say("usage: rm [-r] <name>", "t-dim"); break; }
          segs = resolvePath(cwd, target);
          parent = nodeAt(segs.slice(0, -1));
          name = segs[segs.length - 1];
          node = parent && parent.type === "dir" ? parent.children[name] : null;
          if (!node) say("rm: " + target + ": No such file or directory", "t-err");
          else if (node.type === "dir" && !recursive) say("rm: " + target + ": is a directory (use rm -r)", "t-err");
          else { delete parent.children[name]; fsEmit(); }
          break;
        }
        case "clear":
          out.innerHTML = "";
          break;
        case "history":
          hist.forEach(function (h2, i) { say("  " + (i + 1) + "  " + h2, "t-dim"); });
          break;
        case "whoami":
          say(currentUser());
          break;
        case "date":
          say(new Date().toString());
          break;
        case "uname":
          say("InspireNavadaOS dev-desktop 1.0.0 wasm64 (online everywhere)");
          break;
        case "git":
          if (args[0] === "status") {
            say("On branch " + GIT.branch);
            if (GIT.ahead) say("Your branch is ahead of 'origin/main' by " + GIT.ahead + " commit" + (GIT.ahead > 1 ? "s" : "") + ".", "t-dim");
            if (!GIT.modified.length && !GIT.staged.length) say("nothing to commit, working tree clean", "t-ok");
            if (GIT.staged.length) { say("Changes to be committed:", "t-dim"); GIT.staged.forEach(function (p) { say("\tmodified:   " + p, "t-ok"); }); }
            if (GIT.modified.length) { say("Changes not staged for commit:", "t-dim"); GIT.modified.forEach(function (p) { say("\tmodified:   " + p, "t-red"); }); }
          } else if (args[0] === "log") {
            GIT.log.slice(0, 8).forEach(function (c) {
              print('<span class="t-red">' + esc(c.hash) + "</span> " + esc(c.msg) + ' <span class="t-dim">(' + esc(c.meta) + ")</span>");
            });
          } else if (args[0] === "branch") {
            say("* " + GIT.branch, "t-ok");
          } else {
            say("supported here: git status · git log · git branch — the Git app does the rest", "t-dim");
          }
          break;
        case "curl": {
          var url = args.filter(function (a) { return a[0] !== "-"; })[0];
          if (!url) { say("usage: curl /api/…", "t-dim"); break; }
          if (url[0] === "/") {
            var res = fakeApi("GET", url);
            say("HTTP/2 " + res.status, res.status < 400 ? "t-ok" : "t-err");
            print('<span class="hlt">' + hl(pretty(res.body), "json") + "</span>");
          } else {
            say("curl: only the local /api is reachable from this sandbox (try `curl /api`)", "t-err");
          }
          break;
        }
        case "open":
          name = OPEN_ALIASES[(args[0] || "").toLowerCase()];
          if (!name) say("open: unknown app '" + (args[0] || "") + "' — try `apps`", "t-err");
          else {
            say("opening " + name + "…", "t-dim");
            // defer so the Enter keystroke finishes in this input before focus moves
            setTimeout(function () { openApp(name); }, 0);
          }
          break;
        case "apps":
          say(Object.keys(APPS).join("  "));
          break;
        case "neofetch": {
          var up = Math.max(1, Math.round((Date.now() - bootTime) / 60000));
          print(
            '<span class="t-red">        *        </span>  ' + esc(currentUser()) + "@inspirenavada\n" +
            '<span class="t-red">      *   *      </span>  <span class="t-dim">─────────────────────</span>\n' +
            '<span class="t-red">    *   *   *    </span>  OS: InspireNavadaOS 1.0 (dev mode)\n' +
            '<span class="t-red">      *   *      </span>  Shell: zsh 5.9 · Uptime: ' + up + "m\n" +
            '<span class="t-red">        *        </span>  Rank: Tier II — Contributor'
          );
          break;
        }
        case "claude": {
          if (args[0] === "--version" || args[0] === "-v") {
            say("claude 2.1.7 (Claude Code, InspireNavada sandbox build)");
            break;
          }
          if (args[0] === "connect") {
            if (!(window.inAuth && window.inAuth.get())) {
              say("claude: sign in first (top right), then run `claude connect`", "t-err");
            } else if (window.claudeLink) {
              say("opening the key panel… your key stays in this tab and goes only to api.anthropic.com", "t-dim");
              window.claudeLink.connect();
            }
            break;
          }
          if (args[0] === "disconnect") {
            if (window.claudeLink) window.claudeLink.disconnect();
            say("✻ key disconnected — `claude` is back to sandbox mode", "t-dim");
            break;
          }
          var argv = args.slice();
          for (var mi = 0; mi < argv.length; mi++) {
            if (argv[mi] === "--model" || argv[mi] === "-m") {
              var picked = resolveModel(argv[mi + 1]);
              if (picked) claudeModel = picked;
              else say("claude: unknown model '" + (argv[mi + 1] || "") + "' — opus · sonnet · haiku", "t-err");
              argv.splice(mi, 2);
              break;
            }
          }
          claudeMode = true;
          claudeReal = !!(window.claudeLink && window.claudeLink.getKey());
          claudeHistory = [];
          if (claudeReal) {
            print('<span class="t-claude">✻ Welcome to Claude Code</span> <span class="t-dim">· linked to your Anthropic account (' + esc(claudeModel) + ")</span>");
            say("  real agent — reads & edits this sandbox · Ctrl+C interrupts · /model switches · /exit leaves", "t-dim");
          } else {
            print('<span class="t-claude">✻ Welcome to Claude Code</span> <span class="t-dim">v2.1.7 · sandbox — no API key needed in here</span>');
            say("  ask about this repo, your todos, or hackathon № 032 · /exit to leave", "t-dim");
            if (window.inAuth && window.inAuth.get()) {
              say("  tip: `claude connect` links your Anthropic API key for the real thing", "t-dim");
            }
          }
          print("&nbsp;");
          var initial = argv.join(" ").replace(/^["']|["']$/g, "");
          if (initial) {
            if (claudeReal) realClaudeReply(initial);
            else claudeReply(initial);
          }
          break;
        }
        case "sudo":
          say(currentUser() + " is not in the sudoers file. This incident will be reported.", "t-err");
          break;
        case "exit":
          closeApp("Terminal");
          return;
        default:
          say("zsh: command not found: " + cmd, "t-err");
          say("type `help` for the command list", "t-dim");
      }
      prompt();
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var v = input.value;
        input.value = "";
        exec(v);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (hi > 0) { hi--; input.value = hist[hi] || ""; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (hi < hist.length) { hi++; input.value = hist[hi] || ""; }
      } else if (e.key === "Tab") {
        e.preventDefault();
        var toks = input.value.split(/\s+/);
        var lastTok = toks[toks.length - 1];
        if (!lastTok) return;
        var slash = lastTok.lastIndexOf("/");
        var dirPart = slash >= 0 ? lastTok.slice(0, slash + 1) : "";
        var stem = slash >= 0 ? lastTok.slice(slash + 1) : lastTok;
        var dirNode = nodeAt(resolvePath(cwd, dirPart || "."));
        if (!dirNode || dirNode.type !== "dir") return;
        var hits = Object.keys(dirNode.children).filter(function (n) { return n.indexOf(stem) === 0; });
        if (hits.length === 1) {
          toks[toks.length - 1] = dirPart + hits[0] + (dirNode.children[hits[0]].type === "dir" ? "/" : "");
          input.value = toks.join(" ");
        } else if (hits.length > 1) {
          print('<span class="t-dim">' + esc(hits.join("  ")) + "</span>");
        }
      } else if (e.key === "c" && e.ctrlKey) {
        print('<span class="t-ok">' + esc(ps1Str()) + "</span> " + esc(input.value) + "^C");
        input.value = "";
        if (claudeBusy && claudeAbort) claudeAbort.abort(); // stop the turn, stay in the session
        else if (claudeMode) exitClaude("✻ interrupted — back to zsh");
      } else if (e.key === "l" && e.ctrlKey) {
        e.preventDefault();
        out.innerHTML = "";
      }
    });

    body.addEventListener("mouseup", function () {
      // click focuses the prompt, but a drag-selection is left alone
      if (!String(window.getSelection())) input.focus();
    });
    rec.onFocus = function () { setTimeout(function () { input.focus(); }, 0); };

    function showWelcome() {
      out.innerHTML = "";
      say("InspireNavada devshell v1.0 — online everywhere, headquartered nowhere.", "t-dim");
      say("Type `help` to see what works. `open <app>` launches the other dock apps.", "t-dim");
      print("&nbsp;");
      prompt();
    }
    // every launch starts with a clean screen; scrollback stays in the
    // background (↑ history) rather than replaying on screen
    rec.onRelaunch = function () {
      showWelcome();
      hi = hist.length;
    };
    showWelcome();
  }

  /* ── Code Editor ──────────────────────────────────────── */
  function buildEditor(body, rec) {
    body.innerHTML =
      '<div class="ed">' +
        '<aside class="ed__tree"></aside>' +
        '<div class="ed__main">' +
          '<div class="ed__tabs"></div>' +
          '<div class="ed__wrap">' +
            '<div class="ed__gutter"><div class="ed__gutter-in"></div></div>' +
            '<div class="ed__code"><pre class="ed__hl hlt" aria-hidden="true"></pre>' +
            '<textarea class="ed__ta" spellcheck="false" aria-label="Editor"></textarea></div>' +
          "</div>" +
          '<div class="ed__status"><span class="ed__stat-left">no file open</span><span class="ed__stat-right">⌘S to save · UTF-8 · LF</span></div>' +
        "</div>" +
      "</div>";

    var tree = body.querySelector(".ed__tree");
    var tabsEl = body.querySelector(".ed__tabs");
    var pre = body.querySelector(".ed__hl");
    var ta = body.querySelector(".ed__ta");
    var gutter = body.querySelector(".ed__gutter-in");
    var statL = body.querySelector(".ed__stat-left");

    var tabs = [];      // paths
    var drafts = {};    // path -> unsaved text
    var active = null;

    function nodeFor(path) { return nodeAt(path.split("/")); }
    function isDirty(path) {
      var n = nodeFor(path);
      return n && path in drafts && drafts[path] !== n.content;
    }

    function renderTree() {
      var html = "";
      (function walk(node, prefix, depth) {
        Object.keys(node.children).sort(function (a, b) {
          var da = node.children[a].type === "dir", db = node.children[b].type === "dir";
          return da === db ? a.localeCompare(b) : da ? -1 : 1;
        }).forEach(function (nm) {
          var child = node.children[nm];
          var pad = 8 + depth * 13;
          if (child.type === "dir") {
            html += '<div class="dirlbl" style="padding-left:' + pad + 'px">' + esc(nm) + "/</div>";
            walk(child, prefix + nm + "/", depth + 1);
          } else {
            var p = prefix + nm;
            html += '<button type="button" data-path="' + esc(p) + '" style="padding-left:' + pad + 'px"' +
              (p === active ? ' class="is-active"' : "") + ">" + esc(nm) + "</button>";
          }
        });
      })(FS, "", 0);
      tree.innerHTML = html;
    }

    function renderTabs() {
      tabsEl.innerHTML = tabs.map(function (p) {
        return '<button type="button" class="ed__tab' + (p === active ? " is-active" : "") + (isDirty(p) ? " is-dirty" : "") + '" data-path="' + esc(p) + '">' +
          '<span class="dot"></span>' + esc(p.split("/").pop()) + '<span class="x" data-close="' + esc(p) + '">×</span></button>';
      }).join("");
    }

    function renderCode() {
      var n = active ? nodeFor(active) : null;
      var text = active ? (active in drafts ? drafts[active] : (n ? n.content : "")) : "";
      ta.value = text;
      ta.disabled = !active;
      pre.innerHTML = active ? hl(text, extOf(active)) + "\n" : "";
      var lines = text.split("\n").length;
      var g = "";
      for (var i = 1; i <= lines; i++) g += "<div>" + i + "</div>";
      gutter.innerHTML = g;
      statL.textContent = active ? "~/" + active + " · " + (EXT_LANG[extOf(active)] || "plain") + (isDirty(active) ? " · modified" : "") : "no file open";
      syncScroll();
    }

    function syncScroll() {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
      gutter.style.transform = "translateY(" + -ta.scrollTop + "px)";
    }

    function openFile(path) {
      if (!nodeFor(path)) return;
      if (tabs.indexOf(path) < 0) tabs.push(path);
      active = path;
      renderTree(); renderTabs(); renderCode();
      ta.focus();
    }

    function closeTab(path) {
      var i = tabs.indexOf(path);
      if (i < 0) return;
      tabs.splice(i, 1);
      delete drafts[path];
      if (active === path) active = tabs[Math.min(i, tabs.length - 1)] || null;
      renderTree(); renderTabs(); renderCode();
    }

    tree.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-path]");
      if (b) openFile(b.getAttribute("data-path"));
    });
    tabsEl.addEventListener("click", function (e) {
      var x = e.target.closest("[data-close]");
      if (x) { e.stopPropagation(); closeTab(x.getAttribute("data-close")); return; }
      var t = e.target.closest(".ed__tab");
      if (t) { active = t.getAttribute("data-path"); renderTree(); renderTabs(); renderCode(); }
    });

    ta.addEventListener("input", function () {
      if (!active) return;
      drafts[active] = ta.value;
      pre.innerHTML = hl(ta.value, extOf(active)) + "\n";
      var lines = ta.value.split("\n").length;
      if (gutter.children.length !== lines) {
        var g = "";
        for (var i = 1; i <= lines; i++) g += "<div>" + i + "</div>";
        gutter.innerHTML = g;
      }
      renderTabs();
      statL.textContent = "~/" + active + " · " + (EXT_LANG[extOf(active)] || "plain") + (isDirty(active) ? " · modified" : "");
      syncScroll();
    });
    ta.addEventListener("scroll", syncScroll);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Tab") {
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input"));
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!active) return;
        var n = nodeFor(active);
        if (!n) return;
        if ((active in drafts) && drafts[active] !== n.content) {
          n.content = drafts[active];
          gitTouch("~/" + active);
        }
        delete drafts[active];
        renderTabs();
        statL.textContent = "~/" + active + " · saved ✓";
        setTimeout(renderCode, 900);
      }
    });

    var onFs = function () { renderTree(); };
    fsListeners.push(onFs);
    rec.dispose = function () {
      var i = fsListeners.indexOf(onFs);
      if (i >= 0) fsListeners.splice(i, 1);
    };
    rec.onFocus = function () { if (active) ta.focus(); };

    renderTree();
    openFile("inspirenavada/README.md");
  }

  /* ── Git ──────────────────────────────────────────────── */
  function buildGit(body, rec) {
    body.innerHTML = '<div class="gitapp"></div>';
    var root = body.querySelector(".gitapp");
    var pushing = false;

    function render() {
      var clean = !GIT.modified.length && !GIT.staged.length;
      var html =
        '<div class="git__head">' +
          '<span class="pill pill--branch">⎇ ' + esc(GIT.branch) + "</span>" +
          '<span class="pill">origin/main' + (GIT.ahead ? " · ahead " + GIT.ahead : " · up to date") + "</span>" +
          (GIT.ahead ? '<button type="button" class="wbtn wbtn--go" data-act="push">' + (pushing ? "pushing…" : "Push " + GIT.ahead + " ↑") + "</button>" : "") +
        "</div>";

      html += "<section><h3>Changes</h3>";
      if (clean) {
        html += '<p class="git__clean">✓ nothing to commit, working tree clean</p>' +
          '<p class="git__hint">Edit a file in the Code Editor (⌘S) or write one from the Terminal — it shows up here.</p>';
      } else {
        GIT.staged.forEach(function (p) {
          html += '<div class="git__file"><span class="a">S</span><span class="git__path">' + esc(p) + '</span><button type="button" class="wbtn" data-unstage="' + esc(p) + '">unstage</button></div>';
        });
        GIT.modified.forEach(function (p) {
          html += '<div class="git__file"><span class="m">M</span><span class="git__path">' + esc(p) + '</span><button type="button" class="wbtn" data-stage="' + esc(p) + '">stage</button></div>';
        });
        html += '<div class="git__commit">' +
          '<textarea class="wfield git__msg" placeholder="Commit message…"></textarea>' +
          '<button type="button" class="wbtn wbtn--go" data-act="commit"' + (GIT.staged.length ? "" : " disabled") + ">Commit " + GIT.staged.length + " file" + (GIT.staged.length === 1 ? "" : "s") + "</button>" +
        "</div>";
      }
      html += "</section><section><h3>History</h3>";
      GIT.log.forEach(function (c) {
        html += '<div class="git__c"><span class="git__hash">' + esc(c.hash) + '</span><div><div>' + esc(c.msg) + '</div><div class="git__cmeta">' + esc(c.meta) + "</div></div></div>";
      });
      html += "</section>";
      root.innerHTML = html;
    }

    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var p = b.getAttribute("data-stage");
      if (p) { GIT.modified.splice(GIT.modified.indexOf(p), 1); GIT.staged.push(p); gitEmit(); return; }
      p = b.getAttribute("data-unstage");
      if (p) { GIT.staged.splice(GIT.staged.indexOf(p), 1); GIT.modified.push(p); gitEmit(); return; }
      if (b.getAttribute("data-act") === "commit") {
        var msg = (root.querySelector(".git__msg").value || "").trim();
        if (!msg || !GIT.staged.length) return;
        var hash = "";
        for (var i = 0; i < 7; i++) hash += "0123456789abcdef"[rand(0, 15)];
        GIT.log.unshift({ hash: hash, msg: msg, meta: currentUser() + " · just now" });
        GIT.staged = [];
        GIT.ahead++;
        gitEmit();
      }
      if (b.getAttribute("data-act") === "push") {
        if (pushing) return;
        pushing = true;
        render();
        setTimeout(function () {
          pushing = false;
          GIT.ahead = 0;
          gitEmit();
        }, 1100);
      }
    });

    GIT.listeners.push(render);
    rec.dispose = function () {
      var i = GIT.listeners.indexOf(render);
      if (i >= 0) GIT.listeners.splice(i, 1);
    };
    render();
  }

  /* ── Database ─────────────────────────────────────────── */
  function buildDatabase(body, rec) {
    body.innerHTML =
      '<div class="dbapp">' +
        '<aside class="db__side"><div class="dirlbl">inspire_prod</div></aside>' +
        '<div class="db__main">' +
          '<div class="db__editor">' +
            '<textarea class="wfield db__sql" spellcheck="false" aria-label="SQL query">SELECT * FROM hackathons;</textarea>' +
            '<button type="button" class="wbtn wbtn--go db__run">Run ⌘⏎</button>' +
          "</div>" +
          '<div class="db__result"></div>' +
          '<div class="ed__status"><span class="db__stat">psql 16.3 · connected to inspire_prod</span><span>read-only replica</span></div>' +
        "</div>" +
      "</div>";
    var side = body.querySelector(".db__side");
    var sql = body.querySelector(".db__sql");
    var result = body.querySelector(".db__result");
    var stat = body.querySelector(".db__stat");

    Object.keys(DB).forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = "▦ " + t + ' <span class="t-dim">' + DB[t].length + "</span>";
      b.addEventListener("click", function () {
        sql.value = "SELECT * FROM " + t + ";";
        run();
      });
      side.appendChild(b);
    });

    function run() {
      var t0 = performance.now();
      try {
        var res = runSQL(sql.value);
        var ms = Math.max(1, Math.round(performance.now() - t0)) + rand(1, 6);
        var html = '<table class="wtable"><thead><tr>' + res.cols.map(function (c) { return "<th>" + esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        res.rows.forEach(function (r) {
          html += "<tr>" + r.map(function (v) { return "<td>" + esc(v == null ? "NULL" : v) + "</td>"; }).join("") + "</tr>";
        });
        html += "</tbody></table>";
        if (!res.rows.length) html += '<p class="t-dim" style="padding:10px 4px">(0 rows)</p>';
        result.innerHTML = html;
        stat.textContent = res.rows.length + " row" + (res.rows.length === 1 ? "" : "s") + " · " + ms + " ms";
      } catch (err) {
        result.innerHTML = '<pre class="werr">ERROR:  ' + esc(err.message) + "</pre>";
        stat.textContent = "query failed";
      }
    }

    body.querySelector(".db__run").addEventListener("click", run);
    sql.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); }
    });
    rec.onFocus = function () { sql.focus(); };
    run();
  }

  /* ── API Console ──────────────────────────────────────── */
  function buildApi(body, rec) {
    body.innerHTML =
      '<div class="apiapp">' +
        '<aside class="api__side"><div class="dirlbl">endpoints</div></aside>' +
        '<div class="api__main">' +
          '<div class="api__bar">' +
            '<select class="wfield api__method" aria-label="Method"><option>GET</option><option>POST</option></select>' +
            '<input class="wfield api__url" value="/api/standings?limit=5" spellcheck="false" aria-label="URL" />' +
            '<button type="button" class="wbtn wbtn--go api__send">Send</button>' +
          "</div>" +
          '<textarea class="wfield api__payload" spellcheck="false" placeholder=\'{"team": "my team", "hackathon_id": 32}\' hidden></textarea>' +
          '<div class="api__meta"><span class="api__status t-dim">—</span><span class="api__time"></span><span class="api__size"></span></div>' +
          '<pre class="api__resp hlt">Hit Send, or pick an endpoint on the left.\nAny absolute http(s) URL is fetched for real.</pre>' +
        "</div>" +
      "</div>";
    var side = body.querySelector(".api__side");
    var methodEl = body.querySelector(".api__method");
    var urlEl = body.querySelector(".api__url");
    var payloadEl = body.querySelector(".api__payload");
    var statusEl = body.querySelector(".api__status");
    var timeEl = body.querySelector(".api__time");
    var sizeEl = body.querySelector(".api__size");
    var respEl = body.querySelector(".api__resp");

    API_LIST.forEach(function (ep) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = '<span class="' + (ep.m === "GET" ? "t-ok" : "t-red") + '">' + ep.m + "</span> " + esc(ep.p);
      b.addEventListener("click", function () {
        methodEl.value = ep.m;
        urlEl.value = ep.p;
        if (ep.m === "POST") payloadEl.value = '{\n  "team": "null pointer club",\n  "hackathon_id": 32,\n  "repo": "https://github.com/…"\n}';
        syncPayload();
        send();
      });
      side.appendChild(b);
    });

    function syncPayload() { payloadEl.hidden = methodEl.value !== "POST"; }
    methodEl.addEventListener("change", syncPayload);

    function show(status, ms, bodyText, isJSON) {
      statusEl.textContent = "HTTP " + status;
      statusEl.className = "api__status " + (status < 400 ? "t-ok" : "t-err");
      timeEl.textContent = ms + " ms";
      sizeEl.textContent = bodyText.length + " B";
      respEl.innerHTML = isJSON ? hl(bodyText, "json") : esc(bodyText);
    }

    function send() {
      var method = methodEl.value, url = urlEl.value.trim();
      respEl.textContent = "…";
      statusEl.textContent = "—";
      statusEl.className = "api__status t-dim";
      timeEl.textContent = "";
      sizeEl.textContent = "";
      if (/^https?:\/\//i.test(url)) {
        var t0 = performance.now();
        fetch(url, { method: method, body: method === "POST" ? payloadEl.value : undefined })
          .then(function (r) {
            return r.text().then(function (t) {
              var ms = Math.round(performance.now() - t0);
              var isJSON = false, txt = t;
              try { txt = pretty(JSON.parse(t)); isJSON = true; } catch (e) { /* keep raw */ }
              show(r.status, ms, txt.slice(0, 20000), isJSON);
            });
          })
          .catch(function (err) {
            show(0, Math.round(performance.now() - t0), "request failed (likely CORS): " + err.message, false);
          });
      } else {
        var latency = rand(40, 190);
        setTimeout(function () {
          var res = fakeApi(method, url, method === "POST" ? payloadEl.value : null);
          show(res.status, latency, pretty(res.body), true);
        }, latency);
      }
    }

    body.querySelector(".api__send").addEventListener("click", send);
    urlEl.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
    syncPayload();
  }

  /* ── Containers ───────────────────────────────────────── */
  function buildContainers(body, rec) {
    body.innerHTML = '<div class="ctr"><table class="wtable"><thead><tr>' +
      "<th></th><th>name</th><th>image</th><th>cpu</th><th>mem</th><th>uptime</th><th>actions</th>" +
      "</tr></thead><tbody></tbody></table></div>";
    var tbody = body.querySelector("tbody");

    var containers = [
      { name: "inspire-web", image: "nginx:1.27-alpine", state: "running", up: 93600, cpu: 2, mem: 24 },
      { name: "inspire-api", image: "node:20-slim", state: "running", up: 93600, cpu: 11, mem: 182 },
      { name: "inspire-db", image: "postgres:16", state: "running", up: 249000, cpu: 6, mem: 410 },
      { name: "inspire-cache", image: "redis:7-alpine", state: "running", up: 249000, cpu: 1, mem: 38 },
      { name: "score-worker", image: "node:20-slim", state: "exited", up: 0, cpu: 0, mem: 0 },
      { name: "grafana", image: "grafana/grafana:11", state: "running", up: 41000, cpu: 3, mem: 96 },
    ];

    function fmtUp(s) {
      if (!s) return "—";
      if (s < 3600) return Math.floor(s / 60) + "m";
      if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
      return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
    }

    function render() {
      tbody.innerHTML = containers.map(function (c, i) {
        var dot = c.state === "running" ? '<span class="dot-run">●</span>' : c.state === "restarting" ? '<span class="dot-warn">●</span>' : '<span class="dot-off">●</span>';
        var actions = c.state === "running"
          ? '<button type="button" class="wbtn" data-i="' + i + '" data-act="stop">stop</button> <button type="button" class="wbtn" data-i="' + i + '" data-act="restart">restart</button>'
          : c.state === "restarting" ? '<span class="t-dim">restarting…</span>'
          : '<button type="button" class="wbtn" data-i="' + i + '" data-act="start">start</button>';
        return "<tr><td>" + dot + "</td><td>" + esc(c.name) + '</td><td class="t-dim">' + esc(c.image) + "</td><td>" +
          (c.state === "running" ? c.cpu.toFixed(1) + "%" : "—") + "</td><td>" +
          (c.state === "running" ? Math.round(c.mem) + " MiB" : "—") + "</td><td>" + fmtUp(c.up) + "</td><td>" + actions + "</td></tr>";
      }).join("");
    }

    tbody.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-act]");
      if (!b) return;
      var c = containers[+b.getAttribute("data-i")];
      var act = b.getAttribute("data-act");
      if (act === "stop") { c.state = "exited"; c.up = 0; c.cpu = 0; }
      if (act === "start") { c.state = "running"; c.up = 1; c.cpu = rand(1, 8); c.mem = rand(20, 120); }
      if (act === "restart") {
        c.state = "restarting"; c.up = 0;
        setTimeout(function () { c.state = "running"; c.up = 1; render(); }, 900);
      }
      render();
    });

    var iv = setInterval(function () {
      containers.forEach(function (c) {
        if (c.state !== "running") return;
        c.up += 1.2;
        c.cpu = Math.max(0.2, Math.min(96, c.cpu + (Math.random() - 0.5) * 3));
        c.mem = Math.max(12, c.mem + (Math.random() - 0.5) * 6);
      });
      render();
    }, 1200);
    rec.dispose = function () { clearInterval(iv); };
    render();
  }

  /* ── Logs ─────────────────────────────────────────────── */
  function buildLogs(body, rec) {
    body.innerHTML =
      '<div class="logs">' +
        '<div class="logs__bar">' +
          '<input class="wfield logs__filter" placeholder="filter…" aria-label="Filter logs" />' +
          '<select class="wfield logs__level" aria-label="Level"><option value="">all</option><option>info</option><option>warn</option><option>error</option></select>' +
          '<button type="button" class="wbtn logs__pause">pause</button>' +
          '<button type="button" class="wbtn logs__clear">clear</button>' +
          '<span class="logs__count t-dim"></span>' +
        "</div>" +
        '<div class="logs__out"></div>' +
      "</div>";
    var out = body.querySelector(".logs__out");
    var filterEl = body.querySelector(".logs__filter");
    var levelEl = body.querySelector(".logs__level");
    var pauseBtn = body.querySelector(".logs__pause");
    var countEl = body.querySelector(".logs__count");

    var TEAMS = ["null pointer club", "cache me outside", "tiny giants", "gradient dissent", "the sleep deprived", "overfit club"];
    var USERS = ["kemi_a", "tunde_builds", "rgw", "mabel_dev", "jnr", "yuewang", "pris"];
    var GEN = {
      info: [
        function () { return "GET /api/standings 200 " + rand(3, 42) + "ms"; },
        function () { return "GET /api/hackathons/32 200 " + rand(2, 18) + "ms"; },
        function () { return 'scored submission #' + rand(9350, 9440) + ' team="' + pick(TEAMS) + '" score=' + (80 + Math.random() * 15).toFixed(3); },
        function () { return "ws: " + rand(180, 460) + " clients connected"; },
        function () { return "cache hit ratio " + rand(88, 99) + "% (last 5m)"; },
        function () { return "@" + pick(USERS) + " climbed to rank #" + rand(4, 120); },
        function () { return "POST /api/submissions 201 " + rand(20, 120) + "ms"; },
      ],
      warn: [
        function () { return "slow query (" + rand(300, 1400) + "ms): SELECT * FROM submissions WHERE hackathon_id=32"; },
        function () { return "rate limit near threshold ip=41.190." + rand(2, 250) + "." + rand(2, 250); },
        function () { return "scoring queue depth " + rand(30, 120) + " (threshold 100)"; },
      ],
      error: [
        function () { return "failed to fetch avatar for @" + pick(USERS) + ": upstream 502"; },
        function () { return "job retry " + rand(1, 3) + "/3: webhook delivery to discord"; },
        function () { return "submission #" + rand(9350, 9440) + " sandbox OOM (512MiB limit)"; },
      ],
    };

    var entries = [];
    var paused = false;

    function passes(en) {
      var f = filterEl.value.trim().toLowerCase();
      if (levelEl.value && en.level !== levelEl.value) return false;
      if (f && en.msg.toLowerCase().indexOf(f) < 0) return false;
      return true;
    }
    function lineHTML(en) {
      return '<div class="lg lg-' + en.level + '"><span class="lg-t">' + en.time + "</span> <b>" + en.level.toUpperCase() + "</b> " + esc(en.msg) + "</div>";
    }
    function renderAll() {
      out.innerHTML = entries.filter(passes).map(lineHTML).join("");
      out.scrollTop = out.scrollHeight;
      countEl.textContent = entries.length + " lines";
    }

    var iv = setInterval(function () {
      if (paused || Math.random() < 0.25) return;
      var roll = Math.random();
      var level = roll < 0.78 ? "info" : roll < 0.93 ? "warn" : "error";
      var en = { time: new Date().toTimeString().slice(0, 8), level: level, msg: pick(GEN[level])() };
      entries.push(en);
      if (entries.length > 500) entries.shift();
      if (passes(en)) {
        var stick = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
        out.insertAdjacentHTML("beforeend", lineHTML(en));
        while (out.children.length > 500) out.firstChild.remove();
        if (stick) out.scrollTop = out.scrollHeight;
      }
      countEl.textContent = entries.length + " lines";
    }, 420);

    filterEl.addEventListener("input", renderAll);
    levelEl.addEventListener("change", renderAll);
    pauseBtn.addEventListener("click", function () {
      paused = !paused;
      pauseBtn.textContent = paused ? "resume" : "pause";
      pauseBtn.classList.toggle("is-on", paused);
    });
    body.querySelector(".logs__clear").addEventListener("click", function () {
      entries = [];
      renderAll();
    });
    rec.dispose = function () { clearInterval(iv); };
  }

  /* ── Profiler ─────────────────────────────────────────── */
  function buildProfiler(body, rec) {
    body.innerHTML =
      '<div class="prof">' +
        '<div class="prof__tiles">' +
          '<div class="prof__tile"><b class="p-fps">—</b><span>fps <i class="sw sw-fps"></i></span></div>' +
          '<div class="prof__tile"><b class="p-ms">—</b><span>frame time</span></div>' +
          '<div class="prof__tile"><b class="p-heap">—</b><span>js heap <i class="sw sw-heap"></i></span></div>' +
          '<div class="prof__tile"><b class="p-dom">—</b><span>dom nodes</span></div>' +
        "</div>" +
        '<canvas class="prof__canvas"></canvas>' +
      "</div>";
    var cv = body.querySelector("canvas");
    var ctx = cv.getContext("2d");
    var elFps = body.querySelector(".p-fps");
    var elMs = body.querySelector(".p-ms");
    var elHeap = body.querySelector(".p-heap");
    var elDom = body.querySelector(".p-dom");

    var buf = [];
    var frames = 0;
    var last = performance.now();
    var raf;

    function loop() {
      frames++;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    var iv = setInterval(function () {
      var now = performance.now();
      var fps = frames * 1000 / (now - last);
      var ms = frames ? (now - last) / frames : 0;
      frames = 0;
      last = now;
      var heap = (performance.memory && performance.memory.usedJSHeapSize)
        ? performance.memory.usedJSHeapSize / 1048576
        : 34 + 8 * Math.sin(now / 9000) + Math.random() * 2;
      buf.push({ fps: Math.min(fps, 120), heap: heap });
      if (buf.length > 90) buf.shift();
      elFps.textContent = fps.toFixed(0);
      elMs.textContent = ms.toFixed(1) + " ms";
      elHeap.textContent = heap.toFixed(1) + " MB";
      elDom.textContent = document.getElementsByTagName("*").length;
      draw();
    }, 500);

    function draw() {
      var dpr = window.devicePixelRatio || 1;
      var W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      for (var g = 1; g < 4; g++) {
        ctx.beginPath();
        ctx.moveTo(0, H * g / 4);
        ctx.lineTo(W, H * g / 4);
        ctx.stroke();
      }
      if (buf.length < 2) return;
      var heaps = buf.map(function (b) { return b.heap; });
      var hMin = Math.min.apply(null, heaps), hMax = Math.max.apply(null, heaps);
      var hSpan = Math.max(hMax - hMin, 4);
      function plot(get, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        buf.forEach(function (b, i) {
          var x = i / (buf.length - 1) * W;
          var y = H - get(b) * (H - 12) - 6;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      }
      plot(function (b) { return b.fps / 120; }, "#34d399");
      plot(function (b) { return (b.heap - hMin) / hSpan * 0.85; }, "#7cb8ff");
    }

    rec.dispose = function () {
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
  }

  /* ── app registry ─────────────────────────────────────── */
  var APPS = {
    "Terminal": { w: 920, h: 580, subtitle: function () { return "zsh — " + currentUser() + "@inspirenavada"; }, build: buildTerminal },
    "Code Editor": { w: 1080, h: 660, subtitle: "~/inspirenavada", build: buildEditor },
    "Git": { w: 760, h: 660, subtitle: "inspirenavada — main", build: buildGit },
    "Database": { w: 980, h: 620, subtitle: "psql — inspire_prod", build: buildDatabase },
    "API Console": { w: 1000, h: 620, subtitle: "api.inspirenavada.dev", build: buildApi },
    "Containers": { w: 940, h: 540, subtitle: "6 containers · local context", build: buildContainers },
    "Logs": { w: 960, h: 580, subtitle: "inspire-api — live tail", build: buildLogs },
    "Profiler": { w: 900, h: 560, subtitle: "this very page, live", build: buildProfiler },
  };

  /* ── access gate (vanilla port of components/ui/otp-input.tsx) ── */
  var GATE_LEN = 6; // the code itself lives server-side; see inAuth.verifyDevCode
  var UNLOCK_KEY = "in-devmode-unlocked";      // guests: this tab only
  var UNLOCK_LOGIN_KEY = "in-devmode-unlock";  // logged in: until sign-out
  var gateEl = null, gateBoxes = null, gateInputs = [], gateStatus = null, gateBusy = false;

  function gateValue() {
    return gateInputs.map(function (i) { return i.value; }).join("");
  }
  function gateSetError(on) {
    gateBoxes.classList.toggle("is-error", on);
  }
  function gateReset(focus) {
    gateBusy = false;
    gateBoxes.classList.remove("is-error", "is-valid");
    gateInputs.forEach(function (i) { i.value = ""; i.disabled = false; });
    gateStatus.textContent = " ";
    gateStatus.className = "gate__status mono-sm";
    if (focus) gateInputs[0].focus();
  }
  function gateClose() {
    if (gateEl) gateEl.classList.remove("is-open");
  }
  function gateCheck() {
    if (gateBusy || gateValue().length < GATE_LEN) return;
    gateBusy = true;
    gateStatus.textContent = "checking…";
    gateStatus.className = "gate__status mono-sm";
    var verify = window.inAuth && window.inAuth.verifyDevCode
      ? window.inAuth.verifyDevCode(gateValue())
      : Promise.reject(new Error("verification unavailable"));
    verify.then(function (ok) {
      if (ok) {
        gateBoxes.classList.add("is-valid");
        gateInputs.forEach(function (i) { i.disabled = true; });
        gateStatus.textContent = "✓ access granted";
        gateStatus.className = "gate__status mono-sm is-ok";
        setTimeout(function () {
          var user = window.inAuth && window.inAuth.get();
          try {
            if (user) {
              // logged in: unlock survives reloads, keyed to this login —
              // signing out (or any fresh login) requires the code again
              localStorage.setItem(UNLOCK_LOGIN_KEY, user.loginId);
            } else {
              sessionStorage.setItem(UNLOCK_KEY, "1");
            }
          } catch (e) { /* private mode */ }
          gateClose();
          if (swInput && !swInput.checked) {
            swInput.checked = true;
            swInput.dispatchEvent(new Event("change"));
          }
        }, 550);
      } else {
        gateSetError(true);
        gateStatus.textContent = "✗ wrong code";
        gateStatus.className = "gate__status mono-sm is-bad";
        setTimeout(function () { gateReset(true); }, 650);
      }
    }).catch(function (err) {
      gateSetError(true);
      gateStatus.textContent = "✗ couldn't verify — " + err.message;
      gateStatus.className = "gate__status mono-sm is-bad";
      setTimeout(function () { gateReset(true); }, 1400);
    });
  }

  function buildGate() {
    gateEl = document.createElement("div");
    gateEl.className = "gate";
    gateEl.setAttribute("role", "dialog");
    gateEl.setAttribute("aria-label", "Dev mode access code");
    var boxes = "";
    for (var i = 0; i < GATE_LEN; i++) {
      boxes += '<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="Digit ' + (i + 1) + '" />';
    }
    gateEl.innerHTML =
      '<div class="gate__panel">' +
        '<p class="gate__kicker mono-sm">restricted · dev mode</p>' +
        "<h3>Enter access code</h3>" +
        '<div class="gate__boxes">' + boxes + "</div>" +
        '<p class="gate__status mono-sm"> </p>' +
        '<p class="gate__hint mono-sm">hint: the hackathon on the marquee, twice</p>' +
        '<p class="gate__note mono-sm"></p>' +
        '<button class="gate__cancel mono-sm" type="button">cancel · esc</button>' +
      "</div>";
    document.body.appendChild(gateEl);

    gateBoxes = gateEl.querySelector(".gate__boxes");
    gateStatus = gateEl.querySelector(".gate__status");
    gateInputs = Array.prototype.slice.call(gateBoxes.querySelectorAll("input"));

    gateInputs.forEach(function (input, index) {
      input.addEventListener("input", function () {
        var v = input.value.replace(/\D/g, "").slice(0, 1);
        input.value = v;
        if (v && index < GATE_LEN - 1) gateInputs[index + 1].focus(); // auto-advance
        gateCheck();
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Backspace") {
          if (!input.value && index > 0) gateInputs[index - 1].focus(); // auto-retreat
        } else if (e.key === "ArrowLeft" && index > 0) {
          e.preventDefault();
          gateInputs[index - 1].focus();
        } else if (e.key === "ArrowRight" && index < GATE_LEN - 1) {
          e.preventDefault();
          gateInputs[index + 1].focus();
        }
      });
      input.addEventListener("paste", function (e) {
        e.preventDefault();
        var digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, GATE_LEN);
        if (!digits) return;
        gateInputs.forEach(function (inp, i) { inp.value = digits[i] || ""; });
        gateInputs[Math.min(digits.length, GATE_LEN - 1)].focus();
        gateCheck();
      });
    });

    gateEl.querySelector(".gate__cancel").addEventListener("click", gateClose);
    gateEl.addEventListener("mousedown", function (e) {
      if (e.target === gateEl) gateClose(); // click the backdrop to dismiss
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && gateEl.classList.contains("is-open")) gateClose();
    });
  }

  window.devModeGate = {
    isUnlocked: function () {
      var user = window.inAuth && window.inAuth.get();
      try {
        if (user) return localStorage.getItem(UNLOCK_LOGIN_KEY) === user.loginId;
        return sessionStorage.getItem(UNLOCK_KEY) === "1";
      } catch (e) { return false; }
    },
    open: function () {
      if (!gateEl) buildGate();
      gateReset(false);
      var user = window.inAuth && window.inAuth.get();
      gateEl.querySelector(".gate__note").textContent = user
        ? "signed in as @" + user.handle + " — remembered until you sign out"
        : "not signed in — remembered for this tab only";
      gateEl.classList.add("is-open");
      setTimeout(function () { gateInputs[0].focus(); }, 60);
    },
  };

  /* ── wiring ───────────────────────────────────────────── */
  dock.addEventListener("click", function (e) {
    var btn = e.target.closest(".dock__item");
    if (btn) openApp(btn.getAttribute("data-label"));
  });

  // Escape closes the focused window (unless typing in a field)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || !document.body.classList.contains("dev-mode")) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (focusedName) closeApp(focusedName);
  });

  // switching Dev Mode off tears the desktop down; on pulls the user's workspace
  if (swInput) {
    var onSwitch = function () {
      if (swInput.checked) {
        syncWorkspaceForUser();
        return;
      }
      Object.keys(wins).forEach(function (n) { closeApp(n, true); });
      setDocked(false);
    };
    swInput.addEventListener("change", onSwitch);
    swInput.addEventListener("pointerup", function () { setTimeout(onSwitch, 0); });
  }
})();
