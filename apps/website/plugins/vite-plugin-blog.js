import fs from "fs";
import path from "path";
import { marked } from "marked";
import matter from "gray-matter";

const CONTENT_DIR = "content/blog";
const TEMPLATE_PATH = "src/blog-template.html";
const BLOG_OUT_DIR = "blog";
const BLOG_DATA_ID = "virtual:blog-data";
const RESOLVED_BLOG_DATA_ID = "\0" + BLOG_DATA_ID;
const SITE_URL = "https://codelegate.dev";
const SUPPORTED_LANGS = ["en", "zh-tw"];
const DEFAULT_LANG = "en";

/** Parse "2026-04-04-slug.en.md" -> { base: "2026-04-04-slug", lang: "en" } */
function parseFilename(filename) {
  const noExt = filename.replace(/\.md$/, "");
  for (const lang of SUPPORTED_LANGS) {
    if (noExt.endsWith(`.${lang}`)) {
      return { base: noExt.slice(0, -(lang.length + 1)), lang };
    }
  }
  // No language suffix -- treat as default language
  return { base: noExt, lang: DEFAULT_LANG };
}

function extractDate(raw) {
  return raw instanceof Date
    ? raw.toISOString().slice(0, 10)
    : String(raw).slice(0, 10);
}

function buildNavArrow(direction, article, lang) {
  const isNext = direction === "next";
  const points = isNext ? "9 6 15 12 9 18" : "15 18 9 12 15 6";
  const cls = isNext ? "blog-nav-arrow-next" : "blog-nav-arrow-prev";
  const svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"></polyline></svg>`;

  if (!article) {
    return `<span class="blog-nav-arrow ${cls} disabled">${svg}</span>`;
  }

  // Use the matching language title, fall back to any available
  const title = article.langs[lang]?.title || Object.values(article.langs)[0].title;
  return `<a class="blog-nav-arrow ${cls}" href="/blog/${article.slug}.html" data-title-en="${article.langs.en?.title || title}" data-title-zh-tw="${article.langs["zh-tw"]?.title || title}">${svg}</a>`;
}

/**
 * Scan markdown files and group by base slug.
 * Returns array of { slug, date, tag, langs: { en: { title, summary, html }, ... } }
 */
function scanArticles(root) {
  const contentDir = path.resolve(root, CONTENT_DIR);
  if (!fs.existsSync(contentDir)) return [];

  const files = fs
    .readdirSync(contentDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const groups = new Map();

  for (const file of files) {
    const { base, lang } = parseFilename(file);
    const raw = fs.readFileSync(path.join(contentDir, file), "utf-8");
    const { data, content } = matter(raw);

    if (!groups.has(base)) {
      groups.set(base, {
        slug: base,
        date: extractDate(data.date),
        tag: data.tag || "",
        langs: {},
      });
    }

    const group = groups.get(base);
    group.langs[lang] = {
      title: data.title || base,
      summary: data.summary || "",
      html: marked.parse(content),
    };

    // Keep most recent date/tag across languages
    const d = extractDate(data.date);
    if (d > group.date) group.date = d;
    if (data.tag) group.tag = data.tag;
  }

  return Array.from(groups.values());
}

function generateBlogPages(root, articles) {
  const templatePath = path.resolve(root, TEMPLATE_PATH);
  const template = fs.readFileSync(templatePath, "utf-8");
  const outDir = path.resolve(root, BLOG_OUT_DIR);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sorted = [...articles].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sorted.length; i++) {
    const article = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : null;
    const next = i < sorted.length - 1 ? sorted[i + 1] : null;
    const availLangs = Object.keys(article.langs);
    const primaryLang = availLangs.includes(DEFAULT_LANG)
      ? DEFAULT_LANG
      : availLangs[0];
    const primary = article.langs[primaryLang];

    // Build content blocks for each language
    const contentBlocks = availLangs
      .map(
        (lang) =>
          `<div class="blog-post-content" data-lang="${lang}">${article.langs[lang].html}</div>`
      )
      .join("\n        ");

    // Build language toggle (only if multiple languages)
    let langToggle = "";
    if (availLangs.length > 1) {
      const buttons = availLangs
        .map((lang) => {
          const label = lang === "en" ? "EN" : "中文";
          return `<button class="blog-lang-btn" data-lang="${lang}">${label}</button>`;
        })
        .join("");
      langToggle = `<div class="blog-lang-toggle">${buttons}</div>`;
    }

    // Build prev/next with both language titles
    const prevHtml = buildNavArrow("prev", prev, primaryLang);
    const nextHtml = buildNavArrow("next", next, primaryLang);

    const html = template
      .replace("{{title}}", primary.title)
      .replace("{{summary}}", primary.summary)
      .replace("{{lang-toggle}}", langToggle)
      .replace("{{content-blocks}}", contentBlocks)
      .replace("{{prev}}", prevHtml)
      .replace("{{next}}", nextHtml);

    fs.writeFileSync(path.join(outDir, `${article.slug}.html`), html);
  }
}

function generateSitemap(articles) {
  const urls = [
    `  <url><loc>${SITE_URL}/</loc></url>`,
    ...articles.map(
      (a) => `  <url><loc>${SITE_URL}/blog/${a.slug}.html</loc></url>`
    ),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;
}

export default function blogPlugin() {
  let root = process.cwd();
  let articles = [];

  return {
    name: "blog",

    config(config) {
      root = config.root ? path.resolve(config.root) : process.cwd();
      articles = scanArticles(root);
      generateBlogPages(root, articles);

      const blogInputs = {};
      for (const article of articles) {
        blogInputs[`blog/${article.slug}`] = path.resolve(
          root,
          BLOG_OUT_DIR,
          `${article.slug}.html`
        );
      }

      return {
        build: {
          rollupOptions: {
            input: {
              main: path.resolve(root, "index.html"),
              ...blogInputs,
            },
          },
        },
      };
    },

    resolveId(id) {
      if (id === BLOG_DATA_ID) return RESOLVED_BLOG_DATA_ID;
    },

    load(id) {
      if (id === RESOLVED_BLOG_DATA_ID) {
        const data = articles
          .map(({ slug, date, tag, langs }) => ({
            slug,
            date,
            tag,
            langs: Object.fromEntries(
              Object.entries(langs).map(([lang, { title, summary }]) => [
                lang,
                { title, summary },
              ])
            ),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
        return `export const articles = ${JSON.stringify(data)};`;
      }
    },

    configureServer(server) {
      const contentDir = path.resolve(root, CONTENT_DIR);

      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/blog\/(.+)\.html$/);
        if (match) {
          const filePath = path.resolve(
            root,
            BLOG_OUT_DIR,
            `${match[1]}.html`
          );
          if (fs.existsSync(filePath)) {
            let html = fs.readFileSync(filePath, "utf-8");
            html = await server.transformIndexHtml(req.url, html);
            res.setHeader("Content-Type", "text/html");
            res.end(html);
            return;
          }
        }

        if (req.url === "/sitemap.xml") {
          res.setHeader("Content-Type", "application/xml");
          res.end(generateSitemap(articles));
          return;
        }

        next();
      });

      server.watcher.add(contentDir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(contentDir)) {
          articles = scanArticles(root);
          generateBlogPages(root, articles);

          const mod = server.moduleGraph.getModuleById(RESOLVED_BLOG_DATA_ID);
          if (mod) server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: "full-reload" });
        }
      });
    },

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: generateSitemap(articles),
      });
    },
  };
}
