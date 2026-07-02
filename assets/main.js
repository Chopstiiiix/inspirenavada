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
