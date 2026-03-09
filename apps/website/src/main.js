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

// Play video in panel, pause all others; restart from beginning
function playVideoInPanel(panel) {
  panels.forEach((p) => {
    const v = p.querySelector("video");
    if (v) v.pause();
  });
  const video = panel.querySelector("video");
  if (video) {
    video.currentTime = 0;
    video.play();
  }
}

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
    }, 2000);
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
