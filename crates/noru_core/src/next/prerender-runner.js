// noru: renders the pages of a Next.js app to HTML at build time (`noru build`).
// Started with `node -e <this file> <bundle file>`; reads { origin, routes: ["/", "/about"] } on
// stdin and prints one JSON line per route: { route, html, title, description, htmlAttrs,
// bodyAttrs } or { route, error }.
//
// The bundle is the browser code of the app (React, the noru router, the pages) plus
// react-dom/server, run with a minimal browser-like environment.
"use strict";

const fs = require("fs");
const util = require("util");

const bundleFile = process.argv[1];
const writeOut = process.stdout.write.bind(process.stdout);
const MARKER = "\u0000noru-prerender:";
// What the app prints goes to stderr, only shown when asked (NORU_DEBUG_PRERENDER=1).
const debug = process.env.NORU_DEBUG_PRERENDER;
console.log = console.info = console.debug = console.warn = console.error = function () {
  if (debug) process.stderr.write(util.format.apply(null, arguments) + "\n");
};

function send(message) {
  writeOut(MARKER + JSON.stringify(message) + "\n");
}

function noop() {}

function element(tag) {
  return {
    tagName: String(tag || "div").toUpperCase(),
    style: {},
    dataset: {},
    childNodes: [],
    children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    removeAttribute: noop,
    hasAttribute: () => false,
    appendChild: (child) => child,
    removeChild: (child) => child,
    insertBefore: (child) => child,
    remove: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    hasChildNodes: () => false,
    contains: () => false,
    focus: noop,
    blur: noop,
  };
}

let currentUrl = new URL("http://localhost/");
const locationObject = {
  assign: noop,
  replace: noop,
  reload: noop,
  toString: () => currentUrl.href,
};
for (const key of ["href", "origin", "protocol", "host", "hostname", "port", "pathname", "search", "hash"]) {
  Object.defineProperty(locationObject, key, { get: () => currentUrl[key], enumerable: true });
}

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function storage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const ssr = { html: null, body: null };
const documentObject = Object.assign(element("#document"), {
  title: "",
  cookie: "",
  referrer: "",
  readyState: "loading",
  visibilityState: "visible",
  hidden: false,
  head: element("head"),
  body: element("body"),
  documentElement: element("html"),
  createElement: element,
  createElementNS: (ns, tag) => element(tag),
  createTextNode: () => element("#text"),
  createComment: () => element("#comment"),
  getElementById: () => null,
  getElementsByName: () => [],
  fonts: { ready: Promise.resolve(), add: noop, check: () => true, load: () => Promise.resolve([]) },
});
Object.defineProperty(documentObject, "baseURI", { get: () => currentUrl.href });

const browserGlobals = {
  window: globalThis,
  self: globalThis,
  document: documentObject,
  location: locationObject,
  history: { state: null, length: 1, scrollRestoration: "auto", pushState: noop, replaceState: noop, back: noop, forward: noop, go: noop },
  localStorage: storage(),
  sessionStorage: storage(),
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
  scrollTo: noop,
  scroll: noop,
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => true,
  matchMedia: (query) => ({ matches: false, media: query, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
  requestIdleCallback: (fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 0 }), 1),
  cancelIdleCallback: (id) => clearTimeout(id),
  IntersectionObserver: Observer,
  ResizeObserver: Observer,
  MutationObserver: Observer,
  __NORU_SSR__: ssr,
};
for (const [key, value] of Object.entries(browserGlobals)) {
  try {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  } catch (error) {}
}

function attributes(props) {
  if (!props) return {};
  const out = {};
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "suppressHydrationWarning" || value == null || value === false) continue;
    if (typeof value === "function") continue;
    if (name === "style" && typeof value === "object") {
      out.style = Object.entries(value)
        .map(([k, v]) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + ":" + v)
        .join(";");
    } else {
      out[name === "className" ? "class" : name === "htmlFor" ? "for" : name] = value === true ? "" : String(value);
    }
  }
  return out;
}

function withTimeout(promise, ms, controller) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("rendering took more than " + ms / 1000 + " s"));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function renderRoute(api, origin, route) {
  currentUrl = new URL(route, origin);
  ssr.html = null;
  ssr.body = null;
  const app = api.render(currentUrl.href);
  if (!app.found) return { route, error: "no page matches" };
  const errors = [];
  const controller = new AbortController();
  const html = await withTimeout(
    (async () => {
      const stream = await api.server.renderToReadableStream(app.element, {
        signal: controller.signal,
        onError(error) {
          errors.push(error);
        },
      });
      await stream.allReady;
      return new Response(stream).text();
    })(),
    10000,
    controller,
  );
  if (errors.length) {
    const error = errors[0];
    const message = (error && (error.digest || error.message)) || String(error);
    // redirect() / notFound(): the page is left to the browser.
    return { route, error: message.split("\n")[0] };
  }
  const metadata = await app.metadata();
  return {
    route,
    html,
    title: metadata.title == null ? null : String(metadata.title),
    description: metadata.description == null ? null : String(metadata.description),
    htmlAttrs: attributes(ssr.html),
    bodyAttrs: attributes(ssr.body),
  };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { origin, routes } = JSON.parse(input);
  currentUrl = new URL("/", origin);
  try {
    (0, eval)(fs.readFileSync(bundleFile, "utf8"));
  } catch (error) {
    for (const route of routes) send({ route, error: "the app cannot run in Node.js: " + ((error && error.message) || error) });
    return;
  }
  const api = globalThis.__noru_prerender;
  for (const route of routes) {
    try {
      send(await renderRoute(api, origin, route));
    } catch (error) {
      send({ route, error: String((error && error.message) || error).split("\n")[0] });
    }
  }
}

process.on("unhandledRejection", noop);
main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(String((error && error.stack) || error) + "\n");
    process.exit(1);
  },
);
