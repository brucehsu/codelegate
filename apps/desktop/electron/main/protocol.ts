/**
 * The `app://codelegate/` scheme that serves the built renderer in production.
 *
 * `file://` is deliberately not used: a privileged custom scheme gives the page
 * a real origin (so it is a secure context, `localStorage` works, and a CSP can
 * be sent as a response header) and enables Chromium's V8 code cache for the
 * bundle, which is worth tens of milliseconds on every cold start.
 *
 * Dev mode never comes through here; it loads `ELECTRON_RENDERER_URL` from the
 * electron-vite dev server, and gets no CSP so React Refresh keeps working.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { net, protocol } from "electron";

export const APP_SCHEME = "app";
export const APP_HOST = "codelegate";
export const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * `'unsafe-inline'` for styles is forced by xterm's DOM renderer and the
 * `@pierre/trees` shadow CSS; everything else is locked to the app origin.
 *
 * `'wasm-unsafe-eval'` is required by `@xterm/addon-image`, whose sixel decoder
 * is a WebAssembly module inlined in the bundle. Without it every
 * `WebAssembly.instantiate` throws a `CompileError` and terminal image output
 * silently stops working. It permits WebAssembly compilation only; plain
 * `eval()` and `new Function()` stay blocked, which `'unsafe-eval'` would not.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join("; ");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);
}

/** `out/main/index.js` -> `out/renderer`, inside the asar as well as out of it. */
export function rendererRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../renderer");
}

/**
 * Map a request URL onto a file inside `root`, or null if it escapes.
 * Exported for the unit suite; keep it free of I/O.
 */
export function resolveRendererPath(root: string, requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.hostname !== APP_HOST) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  if (pathname === "" || pathname === "/") pathname = "/index.html";

  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, `.${path.posix.normalize(pathname)}`);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) return null;
  return target;
}

async function isFile(target: string): Promise<boolean> {
  try {
    const stats = await fsp.stat(target);
    return stats.isFile();
  } catch {
    return false;
  }
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export function registerAppProtocol(root: string = rendererRoot()): void {
  const normalizedRoot = path.resolve(root);
  const indexFile = path.join(normalizedRoot, "index.html");

  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveRendererPath(normalizedRoot, request.url);
    if (!resolved) return notFound();

    let target = resolved;
    if (!(await isFile(target))) {
      // Real assets 404; extensionless paths fall back to the SPA entry.
      if (path.extname(target)) return notFound();
      target = indexFile;
      if (!(await isFile(target))) return notFound();
    }

    try {
      const response = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Type", contentTypeFor(target));
      if (target === indexFile || path.extname(target).toLowerCase() === ".html") {
        headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(`[protocol] failed to serve ${request.url}`, error);
      return notFound();
    }
  });
}
