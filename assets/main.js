// InspireNavada — live countdowns & small touches

(function () {
  "use strict";

  var UNITS = [
    { label: "d", ms: 86400000 },
    { label: "h", ms: 3600000 },
    { label: "m", ms: 60000 },
    { label: "s", ms: 1000 },
  ];

  function format(msLeft) {
    if (msLeft <= 0) return "closed";
    var parts = [];
    for (var i = 0; i < UNITS.length; i++) {
      var v = Math.floor(msLeft / UNITS[i].ms);
      msLeft -= v * UNITS[i].ms;
      // skip leading zero units, but always show minutes and seconds
      if (parts.length || v > 0 || UNITS[i].label === "m" || UNITS[i].label === "s") {
        parts.push((parts.length ? String(v).padStart(2, "0") : v) + UNITS[i].label);
      }
    }
    return parts.join(" ");
  }

  var timers = Array.prototype.slice.call(document.querySelectorAll(".countdown[data-deadline]"));

  function tick() {
    var now = Date.now();
    timers.forEach(function (el) {
      var deadline = Date.parse(el.getAttribute("data-deadline"));
      el.textContent = format(deadline - now);
    });
  }

  tick();
  setInterval(tick, 1000);

  var year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // industrial "Dev Mode" switch — click toggles, drag with snap
  var iswitch = document.getElementById("dev-mode-switch");
  if (iswitch) {
    var MAX_TRAVEL = 80;
    var swInput = iswitch.querySelector(".iswitch__input");
    var swHandle = iswitch.querySelector(".iswitch__handle");
    var dragStartY = null;
    var dragOffset = 0;
    var wasDragged = false;
    var dragScale = 1;

    swInput.addEventListener("pointerdown", function (e) {
      dragStartY = e.clientY;
      dragOffset = swInput.checked ? MAX_TRAVEL : 0;
      wasDragged = false;
      // the switch renders scaled; map screen px back to component px
      var t = getComputedStyle(iswitch).transform;
      dragScale = t && t !== "none" ? new DOMMatrixReadOnly(t).a : 1;
      swInput.setPointerCapture(e.pointerId);
    });

    swInput.addEventListener("pointermove", function (e) {
      if (dragStartY === null) return;
      if (Math.abs(e.clientY - dragStartY) > 4) wasDragged = true;
      if (wasDragged) {
        var pos = Math.max(0, Math.min(MAX_TRAVEL, (e.clientY - dragStartY) / dragScale + dragOffset));
        iswitch.classList.add("is-dragging");
        swHandle.style.transform = "translateY(" + pos + "px)";
      }
    });

    swInput.addEventListener("pointerup", function (e) {
      if (dragStartY === null) return;
      if (wasDragged) {
        var end = Math.max(0, Math.min(MAX_TRAVEL, (e.clientY - dragStartY) / dragScale + dragOffset));
        swInput.checked = end > MAX_TRAVEL / 2;
      }
      iswitch.classList.remove("is-dragging");
      swHandle.style.transform = "";
      dragStartY = null;
    });

    // a drag should not also fire the checkbox's click-toggle
    swInput.addEventListener("click", function (e) {
      if (wasDragged) {
        e.preventDefault();
        wasDragged = false;
      }
    });

    // ── dev mode: switch on -> slide to the right screen edge,
    //    page fades to the dot-grid dark layer, dock appears ──
    var devLayer = document.getElementById("devmode");
    if (devLayer) {
      var dock = document.getElementById("dock");
      var dockItems = Array.prototype.slice.call(dock.querySelectorAll(".dock__item"));

      var syncDevMode = function () {
        var isOn = document.body.classList.contains("dev-mode");
        if (swInput.checked === isOn) return;
        // dev mode is gated: flipping on without the access code opens the code prompt
        if (swInput.checked && window.devModeGate && !window.devModeGate.isUnlocked()) {
          swInput.checked = false;
          window.devModeGate.open();
          return;
        }
        if (swInput.checked) {
          var r = iswitch.getBoundingClientRect();
          var housing = iswitch.querySelector(".iswitch__housing").getBoundingClientRect();
          var dx = window.innerWidth - r.right - 28;
          iswitch.style.transform = "translateX(" + dx + "px) scale(0.45)";
          // dock sits on the same horizontal line as the switch housing
          dock.style.top = housing.top + housing.height / 2 + "px";
          document.body.classList.add("dev-mode");
          devLayer.setAttribute("aria-hidden", "false");
        } else {
          iswitch.style.transform = "";
          document.body.classList.remove("dev-mode");
          devLayer.setAttribute("aria-hidden", "true");
        }
      };

      swInput.addEventListener("change", syncDevMode);
      // drags set .checked programmatically, which fires no change event
      swInput.addEventListener("pointerup", function () {
        setTimeout(syncDevMode, 0);
      });

      // dock magnification: bar stays static, icons zoom in place.
      // max scale 1.4 on a 44px tile + falloff neighbour eat at most
      // ~13.5px of the 16px gap, so icons can never touch.
      var itemCenters = function () {
        var dr = dock.getBoundingClientRect();
        return dockItems.map(function (it) {
          return dr.left + it.offsetLeft + it.offsetWidth / 2;
        });
      };
      dock.addEventListener("mousemove", function (e) {
        var cs = itemCenters();
        dockItems.forEach(function (it, i) {
          var f = Math.max(0, 1 - Math.abs(e.clientX - cs[i]) / 130);
          it.style.transform = "translateY(" + -8 * f + "px) scale(" + (1 + 0.4 * f) + ")";
        });
      });
      dock.addEventListener("mouseleave", function () {
        dockItems.forEach(function (it) {
          it.style.transform = "";
        });
      });
    }
  }

  // ── real sign-in (Supabase auth) ─────────────────────────
  // logged in  -> the dev-mode access code is remembered until sign-out
  //               (localStorage, keyed to a per-login id, so every fresh
  //               login re-asks); the code itself is verified server-side
  // signed out -> guests fall back to a per-tab unlock (sessionStorage)
  var SUPA_URL = "https://calbklvtnewbroyllamj.supabase.co";
  var SUPA_KEY = "sb_publishable_Sh44o7DVvr9_CjJUCMWL9w_znAyX62u";
  var UNLOCK_LOGIN_KEY = "in-devmode-unlock";
  var authActions = document.querySelector(".masthead__actions");
  var signinEl = null;

  var sb = window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;
  var currentSession = null;

  function authGet() {
    if (!currentSession || !currentSession.user) return null;
    var u = currentSession.user;
    var handle = (u.user_metadata && u.user_metadata.handle) || (u.email || "builder").split("@")[0];
    return {
      handle: handle,
      // stable across reloads within one login; changes on every fresh
      // sign-in, so the dev-mode gate re-asks after sign-out -> sign-in
      loginId: u.id + "." + (Date.parse(u.last_sign_in_at || "") || 0),
    };
  }
  var CLAUDE_KEY_STORE = "in-claude-key";

  window.inAuth = {
    get: authGet,
    signOut: function () {
      try {
        localStorage.removeItem(UNLOCK_LOGIN_KEY); // next login re-asks for the code
        sessionStorage.removeItem(CLAUDE_KEY_STORE); // API key rides the login lifecycle
      } catch (e) { /* storage unavailable */ }
      if (sb) sb.auth.signOut(); // onAuthStateChange re-renders the masthead
      else renderAuth();
    },
    // dev-mode access code check — the code lives server-side, never in this bundle
    verifyDevCode: function (code) {
      if (!sb) return Promise.reject(new Error("auth service unavailable"));
      return sb.rpc("redeem_devmode_code", { input_code: code }).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return res.data === true;
      });
    },
  };

  // ── bring-your-own-key Claude link ──────────────────────
  // The key lives in sessionStorage only (this tab, this login) and is sent
  // nowhere except api.anthropic.com — the site has no backend to leak it to.
  var keyEl = null;

  function claudeKeyGet() {
    try { return sessionStorage.getItem(CLAUDE_KEY_STORE) || ""; } catch (e) { return ""; }
  }
  function keyModalClose() {
    if (keyEl) keyEl.classList.remove("is-open");
  }
  function keyModalOpen() {
    if (!authGet()) return;
    if (!keyEl) {
      keyEl = document.createElement("div");
      keyEl.className = "signin";
      keyEl.setAttribute("role", "dialog");
      keyEl.setAttribute("aria-label", "Connect Claude");
      keyEl.innerHTML =
        '<div class="signin__panel">' +
          '<p class="signin__kicker mono-sm">bring your own key</p>' +
          "<h3>Connect Claude</h3>" +
          '<label class="mono-sm" for="claude-key-input">anthropic api key</label>' +
          '<input id="claude-key-input" class="signin__input" type="password" placeholder="sk-ant-…" spellcheck="false" autocomplete="off" />' +
          '<p class="signin__note mono-sm">kept in this tab only, cleared when you sign out. `claude` in the dev-mode terminal becomes a real agent, billed to your account.</p>' +
          '<button class="btn btn--ink signin__go" type="button">Connect</button>' +
          '<button class="signin__cancel mono-sm" type="button">cancel · esc</button>' +
        "</div>";
      document.body.appendChild(keyEl);

      var keyInput = keyEl.querySelector("#claude-key-input");
      var submit = function () {
        var key = keyInput.value.trim();
        if (!key) { keyInput.focus(); return; }
        try { sessionStorage.setItem(CLAUDE_KEY_STORE, key); } catch (e) { /* storage unavailable */ }
        keyInput.value = "";
        keyModalClose();
        renderAuth();
      };
      keyEl.querySelector(".signin__go").addEventListener("click", submit);
      keyInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submit();
      });
      keyEl.querySelector(".signin__cancel").addEventListener("click", keyModalClose);
      keyEl.addEventListener("mousedown", function (e) {
        if (e.target === keyEl) keyModalClose();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && keyEl.classList.contains("is-open")) keyModalClose();
      });
    }
    keyEl.classList.add("is-open");
    setTimeout(function () { keyEl.querySelector("#claude-key-input").focus(); }, 60);
  }

  window.claudeLink = {
    getKey: function () { return authGet() ? claudeKeyGet() : ""; },
    connect: keyModalOpen,
    disconnect: function () {
      try { sessionStorage.removeItem(CLAUDE_KEY_STORE); } catch (e) { /* storage unavailable */ }
      renderAuth();
    },
  };

  // ── cloud sandbox bridge (Phase 2) ──────────────────────
  // Talks to the separate `inspirenavada-sandbox` Worker, which runs the REAL
  // Claude Code CLI in a per-user Cloudflare Container. We send the Supabase
  // access token (proves who the user is) + the user's own Anthropic key
  // (powers the CLI in their own container). The service URL is set once via
  // `sandbox set <url>` in the terminal and remembered in localStorage; until
  // then `claude` falls back to the in-browser agent, so nothing changes.
  var SANDBOX_URL_STORE = "in-sandbox-url";
  function sandboxUrl() {
    try {
      return String(window.IN_SANDBOX_URL || localStorage.getItem(SANDBOX_URL_STORE) || "").replace(/\/+$/, "");
    } catch (e) { return String(window.IN_SANDBOX_URL || "").replace(/\/+$/, ""); }
  }
  function sandboxHeaders(withKey) {
    var h = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (currentSession ? currentSession.access_token : ""),
    };
    if (withKey) h["X-Anthropic-Key"] = claudeKeyGet();
    return h;
  }
  function sandboxApi(path, body) {
    var url = sandboxUrl();
    if (!url) return Promise.reject(new Error("cloud sandbox not configured"));
    if (!currentSession) return Promise.reject(new Error("sign in first"));
    return fetch(url + path, {
      method: "POST",
      headers: sandboxHeaders(true),
      body: body ? JSON.stringify(body) : "{}",
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error(j.error || ("sandbox error " + res.status));
        return j;
      });
    });
  }
  // Parse the service's SSE stream ({type:'text'|'stderr'|'error'|'done'}).
  function readSandboxSSE(res, handlers) {
    handlers = handlers || {};
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) { if (handlers.onDone) handlers.onDone({}); return; }
        buf += dec.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          var chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          var data = chunk.split("\n")
            .filter(function (l) { return l.indexOf("data:") === 0; })
            .map(function (l) { return l.slice(5).replace(/^ /, ""); })
            .join("");
          if (!data) continue;
          var ev; try { ev = JSON.parse(data); } catch (e) { continue; }
          if (ev.type === "text" && handlers.onText) handlers.onText(ev.text);
          else if (ev.type === "stderr" && handlers.onStderr) handlers.onStderr(ev.text);
          else if (ev.type === "error" && handlers.onError) handlers.onError(new Error(ev.error || "sandbox error"));
          else if (ev.type === "done" && handlers.onDone) handlers.onDone(ev);
        }
        return pump();
      });
    }
    return pump();
  }

  window.sandbox = {
    url: sandboxUrl,
    configured: function () { return !!(authGet() && sandboxUrl()); },
    setUrl: function (u) {
      try {
        if (u) localStorage.setItem(SANDBOX_URL_STORE, String(u).replace(/\/+$/, ""));
        else localStorage.removeItem(SANDBOX_URL_STORE);
      } catch (e) { /* storage unavailable */ }
    },
    health: function () { return sandboxApi("/api/health", null); },
    // Stream a real `claude --print` run. Returns a promise with an .abort().
    exec: function (prompt, model, handlers) {
      var url = sandboxUrl();
      if (!url) return Promise.reject(new Error("cloud sandbox not configured"));
      if (!currentSession) return Promise.reject(new Error("sign in first"));
      if (!claudeKeyGet()) return Promise.reject(new Error("connect your Anthropic key first"));
      var ctrl = new AbortController();
      var p = fetch(url + "/api/exec", {
        method: "POST",
        headers: sandboxHeaders(true),
        body: JSON.stringify({ prompt: prompt, model: model }),
        signal: ctrl.signal,
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (e) {
            throw new Error(e.error || ("sandbox error " + res.status));
          });
        }
        return readSandboxSSE(res, handlers);
      });
      p.abort = function () { ctrl.abort(); };
      return p;
    },
    list: function () { return sandboxApi("/api/fs/list", null); },
    read: function (path) { return sandboxApi("/api/fs/read", { path: path }); },
    write: function (path, content) { return sandboxApi("/api/fs/write", { path: path, content: content }); },
  };

  // ── per-user dev-mode workspace (sandbox FS + git state) ──
  window.inWorkspace = {
    load: function () {
      if (!sb || !currentSession) return Promise.resolve(null);
      return sb.from("workspaces")
        .select("fs, git")
        .eq("user_id", currentSession.user.id)
        .maybeSingle()
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return res.data; // null when the user has no saved workspace yet
        });
    },
    save: function (fs, git) {
      if (!sb || !currentSession) return Promise.resolve(false);
      return sb.from("workspaces")
        .upsert({ user_id: currentSession.user.id, fs: fs, git: git })
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          return true;
        });
    },
  };

  function signinClose() {
    if (signinEl) signinEl.classList.remove("is-open");
  }
  function signinOpen() {
    if (!signinEl) {
      signinEl = document.createElement("div");
      signinEl.className = "signin";
      signinEl.setAttribute("role", "dialog");
      signinEl.setAttribute("aria-label", "Sign in");
      signinEl.innerHTML =
        '<div class="signin__panel">' +
          '<p class="signin__kicker mono-sm">welcome back</p>' +
          "<h3>Sign in to InspireNavada</h3>" +
          '<label class="mono-sm" for="signin-email">email</label>' +
          '<input id="signin-email" class="signin__input" type="email" placeholder="you@example.com" autocomplete="email" spellcheck="false" />' +
          '<label class="mono-sm" for="signin-password">password</label>' +
          '<input id="signin-password" class="signin__input" type="password" placeholder="••••••••" autocomplete="current-password" />' +
          '<label class="mono-sm" for="signin-handle">builder handle <span class="signin__opt">· new accounts only</span></label>' +
          '<input id="signin-handle" class="signin__input" placeholder="@you" maxlength="24" autocomplete="username" spellcheck="false" />' +
          '<p class="signin__status mono-sm"> </p>' +
          '<button class="btn btn--ink signin__go" type="button">Sign in</button>' +
          '<button class="btn btn--ghost signin__signup" type="button">Create account</button>' +
          '<button class="signin__cancel mono-sm" type="button">cancel · esc</button>' +
        "</div>";
      document.body.appendChild(signinEl);

      var emailInput = signinEl.querySelector("#signin-email");
      var passInput = signinEl.querySelector("#signin-password");
      var handleInput = signinEl.querySelector("#signin-handle");
      var statusEl = signinEl.querySelector(".signin__status");
      var busy = false;

      function status(msg, isError) {
        statusEl.textContent = msg || " ";
        statusEl.className = "signin__status mono-sm" + (isError ? " is-bad" : "");
      }

      function creds() {
        var email = emailInput.value.trim();
        var password = passInput.value;
        if (!email || !password) {
          status("email and password are both needed", true);
          return null;
        }
        return { email: email, password: password };
      }

      function submitSignIn() {
        if (busy || !sb) { if (!sb) status("auth service unavailable — try again shortly", true); return; }
        var c = creds();
        if (!c) return;
        busy = true;
        status("signing in…");
        sb.auth.signInWithPassword(c).then(function (res) {
          busy = false;
          if (res.error) { status(res.error.message, true); return; }
          status(" ");
          passInput.value = "";
          signinClose(); // onAuthStateChange re-renders the masthead
        });
      }

      function submitSignUp() {
        if (busy || !sb) { if (!sb) status("auth service unavailable — try again shortly", true); return; }
        var c = creds();
        if (!c) return;
        var handle = handleInput.value.trim().replace(/^@+/, "");
        if (!handle) { status("pick a builder handle for your new account", true); return; }
        busy = true;
        status("creating your account…");
        sb.auth.signUp({
          email: c.email,
          password: c.password,
          options: { data: { handle: handle } },
        }).then(function (res) {
          busy = false;
          if (res.error) { status(res.error.message, true); return; }
          if (res.data && res.data.session) {
            passInput.value = "";
            signinClose(); // signed straight in
          } else {
            status("account created — confirm via the email we sent, then sign in");
          }
        });
      }

      signinEl.querySelector(".signin__go").addEventListener("click", submitSignIn);
      signinEl.querySelector(".signin__signup").addEventListener("click", submitSignUp);
      passInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submitSignIn();
      });
      signinEl.querySelector(".signin__cancel").addEventListener("click", signinClose);
      signinEl.addEventListener("mousedown", function (e) {
        if (e.target === signinEl) signinClose();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && signinEl.classList.contains("is-open")) signinClose();
      });
    }
    signinEl.querySelector(".signin__status").textContent = " ";
    signinEl.classList.add("is-open");
    setTimeout(function () { signinEl.querySelector("#signin-email").focus(); }, 60);
  }

  function renderAuth() {
    if (!authActions) return;
    var user = authGet();
    if (user) {
      authActions.innerHTML =
        '<div class="auth-menu">' +
          '<button class="auth-chip mono-sm" type="button" aria-haspopup="menu" aria-expanded="false">' +
            "@" + String(user.handle).replace(/[&<>"]/g, "") +
            '<span class="auth-chip__caret" aria-hidden="true">▾</span>' +
          "</button>" +
          '<div class="auth-menu__drop" role="menu">' +
            '<button class="auth-menu__item mono-sm" type="button" id="claude-link" role="menuitem">' +
              (claudeKeyGet() ? "Disconnect Claude" : "Connect Claude") +
            "</button>" +
            '<button class="auth-menu__item auth-menu__item--out mono-sm" type="button" id="sign-out" role="menuitem">Sign out</button>' +
          "</div>" +
        "</div>";
      var menu = authActions.querySelector(".auth-menu");
      var chip = menu.querySelector(".auth-chip");
      chip.addEventListener("click", function () {
        var open = menu.classList.toggle("is-open");
        chip.setAttribute("aria-expanded", open ? "true" : "false");
      });
      menu.querySelector("#claude-link").addEventListener("click", function () {
        menu.classList.remove("is-open");
        if (claudeKeyGet()) window.claudeLink.disconnect();
        else keyModalOpen();
      });
      menu.querySelector("#sign-out").addEventListener("click", window.inAuth.signOut);
    } else {
      authActions.innerHTML =
        '<a class="btn btn--ghost" href="#" id="sign-in">Sign in</a>' +
        '<a class="btn btn--ink" href="#join">Join free</a>';
      authActions.querySelector("#sign-in").addEventListener("click", function (e) {
        e.preventDefault();
        signinOpen();
      });
    }
  }
  renderAuth();

  // session restore + live auth state -> masthead
  if (sb) {
    sb.auth.onAuthStateChange(function (event, session) {
      currentSession = session;
      renderAuth();
    });
  }

  // close the account dropdown on outside click or Escape
  document.addEventListener("click", function (e) {
    var open = document.querySelector(".auth-menu.is-open");
    if (open && !open.contains(e.target)) {
      open.classList.remove("is-open");
      open.querySelector(".auth-chip").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var open = document.querySelector(".auth-menu.is-open");
    if (open) {
      open.classList.remove("is-open");
      open.querySelector(".auth-chip").setAttribute("aria-expanded", "false");
    }
  });

  // tab bars (hackathon detail page)
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll(".tabbar button[data-tab]"));
  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabButtons.forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      Array.prototype.slice.call(document.querySelectorAll(".tab-panel")).forEach(function (panel) {
        panel.classList.toggle("is-active", panel.id === "panel-" + btn.getAttribute("data-tab"));
      });
    });
  });
})();
