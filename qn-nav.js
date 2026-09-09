// ============================================================
// QN series header navigation
// Links to PLAYER / PITCH / PHRASE / TEMPO / TUNER, shown inside
// the hamburger menu next to the logo.
// Only the link to the app currently open gets disabled;
// the other four remain clickable.
// This HTML/CSS/JS is shared verbatim across all five apps —
// "which app is this" is defined in exactly one place, below.
// ============================================================
(function () {
  const CURRENT_QN_APP = "tuner"; // player / pitch / phrase / tempo / tuner — change only this per app

  document.querySelectorAll(".qn-nav-btn").forEach(btn => {
    if (btn.dataset.qnApp === CURRENT_QN_APP) {
      btn.classList.add("current");
      btn.removeAttribute("href");
      btn.setAttribute("aria-disabled", "true");
      btn.addEventListener("click", e => e.preventDefault());
    }
  });
})();
