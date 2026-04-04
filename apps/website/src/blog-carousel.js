import { articles } from "virtual:blog-data";

var STORAGE_KEY = "codelegate-blog-lang";
var DEFAULT_LANG = "en";

function getLang() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
}

function getLocalized(article) {
  var lang = getLang();
  return article.langs[lang] || article.langs[DEFAULT_LANG] || Object.values(article.langs)[0];
}

function formatDate(dateStr) {
  var d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderCards(container) {
  container.innerHTML = articles
    .map(function (a) {
      var l = getLocalized(a);
      var langs = Object.keys(a.langs).map(function (k) { return k === "en" ? "EN" : "中文"; }).join(" / ");
      return '\
    <a href="/blog/' + a.slug + '.html" class="blog-card" role="listitem">\
      <div class="blog-card-badges">\
        ' + (a.tag ? '<span class="blog-card-tag">' + a.tag + '</span>' : '') + '\
        <span class="blog-card-lang">' + langs + '</span>\
      </div>\
      <h3 class="blog-card-title">' + l.title + '</h3>\
      <p class="blog-card-summary">' + l.summary + '</p>\
      <span class="blog-card-date">' + formatDate(a.date) + '</span>\
    </a>';
    })
    .join("");
}

function initCarousel() {
  var carousel = document.querySelector(".blog-carousel");
  if (!carousel) return;

  renderCards(carousel);

  var prevBtn = document.querySelector(".blog-arrow-prev");
  var nextBtn = document.querySelector(".blog-arrow-next");
  var scrollAmount = 440;

  function updateArrows() {
    var sl = carousel.scrollLeft;
    var sw = carousel.scrollWidth;
    var cw = carousel.clientWidth;
    prevBtn.disabled = sl <= 0;
    nextBtn.disabled = sl + cw >= sw - 1;
  }

  prevBtn.addEventListener("click", function () {
    carousel.scrollBy({ left: -scrollAmount });
  });

  nextBtn.addEventListener("click", function () {
    carousel.scrollBy({ left: scrollAmount });
  });

  carousel.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", updateArrows, { passive: true });

  // Re-render on language change
  window.addEventListener("lang-change", function () {
    renderCards(carousel);
    updateArrows();
  });

  updateArrows();
}

initCarousel();
