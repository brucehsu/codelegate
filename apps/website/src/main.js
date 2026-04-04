// ── Language toggle ──
const STORAGE_KEY = "codelegate-blog-lang";
const DEFAULT_LANG = "en";

function getStoredLang() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
}

function setLang(lang) {
  document.body.dataset.lang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.querySelectorAll(".blog-lang-btn[data-lang]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  // Notify carousel to re-render
  window.dispatchEvent(new CustomEvent("lang-change", { detail: lang }));
}

// Init language from storage
setLang(getStoredLang());

// Bind all toggle buttons on the page
document.querySelectorAll(".blog-lang-btn[data-lang]").forEach((btn) => {
  btn.addEventListener("click", () => setLang(btn.dataset.lang));
});

import "./blog-carousel.js";

// Scroll fade-in
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

document.querySelectorAll(".fade-up").forEach((el) => observer.observe(el));

// Product Viewer - tab switching with keyboard shortcuts
const pvNav = document.querySelector(".pv-nav");
const navItems = document.querySelectorAll(".pv-nav-item");
const panels = new Map();
let activeTour = "overview";
let isAnimating = false;

// Build shortcut -> tour key map (keyed by KeyCode e.g. "KeyG")
const shortcutMap = {};
navItems.forEach((btn) => {
  const key = btn.dataset.tour;
  panels.set(key, document.querySelector(`[data-tour-panel="${key}"]`));
  if (btn.dataset.shortcut) {
    shortcutMap["Key" + btn.dataset.shortcut.toUpperCase()] = key;
  }
});

// Play video in panel, pause all others; lazy-load src on first access
function playVideoInPanel(panel) {
  panels.forEach((p) => {
    const v = p.querySelector("video");
    if (v) v.pause();
  });
  const video = panel.querySelector("video");
  if (video) {
    // Lazy-load: move data-src to src on first play
    if (!video.src && video.dataset.src) {
      video.src = video.dataset.src;
    }
    video.currentTime = 0;
    video.play();
  }
}

// After overview finishes loading, prefetch the other videos in background
const overviewVideo = panels.get("overview").querySelector("video");
overviewVideo.addEventListener("canplaythrough", () => {
  panels.forEach((panel, key) => {
    if (key === "overview") return;
    const v = panel.querySelector("video");
    if (v && !v.src && v.dataset.src) {
      v.preload = "auto";
      v.src = v.dataset.src;
    }
  });
}, { once: true });

// 2-second delay before looping: pause at end, then restart after 2s
document.querySelectorAll(".pv-video").forEach((video) => {
  video.loop = false; // we handle looping manually
  video.addEventListener("ended", () => {
    setTimeout(() => {
      // Only restart if this panel is still active
      if (video.closest(".pv-tour.active")) {
        video.currentTime = 0;
        video.play();
      }
    }, 3000);
  });
});

function switchTour(key) {
  if (key === activeTour || isAnimating) return;
  isAnimating = true;

  const oldNav = document.querySelector(`.pv-nav-item[data-tour="${activeTour}"]`);
  const newNav = document.querySelector(`.pv-nav-item[data-tour="${key}"]`);
  const oldPanel = panels.get(activeTour);
  const newPanel = panels.get(key);

  // Update nav
  oldNav.classList.remove("active");
  newNav.classList.add("active");

  // Fade out old
  oldPanel.classList.remove("active");
  oldPanel.style.opacity = "0";
  oldPanel.style.transform = "translateY(-16px)";

  // Prep new off-screen
  newPanel.style.transition = "none";
  newPanel.style.opacity = "0";
  newPanel.style.transform = "translateY(16px)";
  newPanel.offsetHeight;
  newPanel.style.transition = "";

  // Activate new
  newPanel.classList.add("active");
  playVideoInPanel(newPanel);

  requestAnimationFrame(() => {
    newPanel.style.opacity = "";
    newPanel.style.transform = "";

    setTimeout(() => {
      oldPanel.style.opacity = "";
      oldPanel.style.transform = "";
      isAnimating = false;
    }, 400);
  });

  activeTour = key;
}

// Click handlers
navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTour(btn.dataset.tour);
  });
});

// Ctrl+Shift held = show shortcut badges and allow navigation
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey) {
    pvNav.classList.add("show-shortcuts");

    const tour = shortcutMap[e.code];
    if (tour) {
      e.preventDefault();
      switchTour(tour);
    }
  }
});

document.addEventListener("keyup", (e) => {
  // Only hide when both Ctrl and Shift are released
  if (!e.ctrlKey || !e.shiftKey) {
    pvNav.classList.remove("show-shortcuts");
  }
});
