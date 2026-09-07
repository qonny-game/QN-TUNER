// ============================================================
// QN series header navigation
// The PLAYER/TUNER/TEMPO icons shown top-right of the header
// (inside the hamburger menu on mobile widths).
// Only the link to the app currently open gets disabled;
// the other two remain clickable.
// This HTML/CSS/JS is shared verbatim across all three apps —
// "which app is this" is defined in exactly one place, below.
// ============================================================
(function () {
  const CURRENT_QN_APP = "tuner"; // player / tuner / tempo — change only this per app

  document.querySelectorAll(".qn-nav-btn").forEach(btn => {
    if (btn.dataset.qnApp === CURRENT_QN_APP) {
      btn.classList.add("current");
      btn.removeAttribute("href");
      btn.setAttribute("aria-disabled", "true");
      btn.addEventListener("click", e => e.preventDefault());
    }
  });
})();
