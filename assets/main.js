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

  // ── demo sign-in: powers the per-login dev mode unlock ──
  // logged in  -> the access code is remembered until sign-out (localStorage,
  //               keyed to a per-login id, so every fresh login re-asks)
  // signed out -> guests fall back to a per-tab unlock (sessionStorage)
  var AUTH_KEY = "in-auth";
  var UNLOCK_LOGIN_KEY = "in-devmode-unlock";
  var authActions = document.querySelector(".masthead__actions");
  var signinEl = null;

  function authGet() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  window.inAuth = {
    get: authGet,
    signOut: function () {
      try {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(UNLOCK_LOGIN_KEY); // next login re-asks for the code
      } catch (e) { /* storage unavailable */ }
      renderAuth();
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
          '<label class="mono-sm" for="signin-handle">builder handle</label>' +
          '<input id="signin-handle" class="signin__input" placeholder="@you" maxlength="24" autocomplete="username" spellcheck="false" />' +
          '<button class="btn btn--ink signin__go" type="button">Sign in</button>' +
          '<button class="signin__cancel mono-sm" type="button">cancel · esc</button>' +
        "</div>";
      document.body.appendChild(signinEl);

      var handleInput = signinEl.querySelector("#signin-handle");
      var submit = function () {
        var handle = handleInput.value.trim().replace(/^@+/, "");
        if (!handle) { handleInput.focus(); return; }
        try {
          localStorage.setItem(AUTH_KEY, JSON.stringify({
            handle: handle,
            loginId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            ts: Date.now(),
          }));
        } catch (e) { /* storage unavailable */ }
        signinClose();
        renderAuth();
      };
      signinEl.querySelector(".signin__go").addEventListener("click", submit);
      handleInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") submit();
      });
      signinEl.querySelector(".signin__cancel").addEventListener("click", signinClose);
      signinEl.addEventListener("mousedown", function (e) {
        if (e.target === signinEl) signinClose();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && signinEl.classList.contains("is-open")) signinClose();
      });
    }
    signinEl.querySelector("#signin-handle").value = "";
    signinEl.classList.add("is-open");
    setTimeout(function () { signinEl.querySelector("#signin-handle").focus(); }, 60);
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
            '<button class="auth-menu__item auth-menu__item--out mono-sm" type="button" id="sign-out" role="menuitem">Sign out</button>' +
          "</div>" +
        "</div>";
      var menu = authActions.querySelector(".auth-menu");
      var chip = menu.querySelector(".auth-chip");
      chip.addEventListener("click", function () {
        var open = menu.classList.toggle("is-open");
        chip.setAttribute("aria-expanded", open ? "true" : "false");
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
