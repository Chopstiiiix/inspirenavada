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
        if (swInput.checked) {
          var r = iswitch.getBoundingClientRect();
          var housing = iswitch.querySelector(".iswitch__housing").getBoundingClientRect();
          var dx = window.innerWidth - r.right - 28;
          iswitch.style.transform = "translateX(" + dx + "px) scale(0.45)";
          // dock sits ~1cm below the switch's horizontal line
          dock.style.top = housing.top + housing.height / 2 + 38 + "px";
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

      devLayer.querySelector("[data-exit]").addEventListener("click", function () {
        swInput.checked = false;
        syncDevMode();
      });

      // dock magnification: tiles grow in LAYOUT (width+height), so the
      // bar expands horizontally and icons can never touch or overlap
      var TILE = 44;
      var GROW = 22;
      var itemCenters = function () {
        var dr = dock.getBoundingClientRect();
        return dockItems.map(function (it) {
          return dr.left + it.offsetLeft + it.offsetWidth / 2;
        });
      };
      dock.addEventListener("mousemove", function (e) {
        var cs = itemCenters();
        dockItems.forEach(function (it, i) {
          var f = Math.max(0, 1 - Math.abs(e.clientX - cs[i]) / 140);
          var size = TILE + GROW * f;
          it.style.width = size + "px";
          it.style.height = size + "px";
          it.style.transform = "translateY(" + -7 * f + "px)";
        });
      });
      dock.addEventListener("mouseleave", function () {
        dockItems.forEach(function (it) {
          it.style.width = "";
          it.style.height = "";
          it.style.transform = "";
        });
      });
    }
  }

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
