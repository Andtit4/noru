// noru: client-side router for Next.js App Router projects.
//
// noru turns the `app/` directory into a route tree (the generated `noru-next/routes` module);
// this file matches the URL against it and renders layouts, templates, error / loading /
// not-found boundaries and pages the way Next.js nests them, entirely in the browser.
import * as React from "react";
import { createRoot } from "react-dom/client";

const h = React.createElement;

// ------------------------------------------------------------------------------------------
// Location store (used by next/navigation hooks through useSyncExternalStore)

// The middleware rewrote the first page to another path (the URL in the address bar stays).
if (window.__NORU_REWRITE__) {
  history.replaceState(Object.assign({}, history.state, { __noruRewrite: window.__NORU_REWRITE__ }), "");
}

let navigations = 0;
let snapshot = readLocation(0);
const listeners = new Set();

function readLocation(key) {
  const state = history.state;
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    key: key,
    // Path actually rendered when the middleware rewrote this URL.
    rewrite: (state && state.__noruRewrite) || null,
  };
}

function emit() {
  snapshot = readLocation(++navigations);
  pruneAsyncCache();
  listeners.forEach(function (listener) {
    listener();
  });
}

export function subscribe(listener) {
  listeners.add(listener);
  return function () {
    listeners.delete(listener);
  };
}

export function getSnapshot() {
  return snapshot;
}

export function navigate(href, options) {
  const opts = options || {};
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) {
    if (opts.replace) location.replace(url.href);
    else location.assign(url.href);
    return;
  }
  if (!window.__NORU_MIDDLEWARE__) {
    commit(url, opts, null);
    return;
  }
  // Like Next.js, the middleware also runs for client-side navigations.
  const depth = opts.depth || 0;
  fetch("/@noru/middleware?url=" + encodeURIComponent(url.pathname + url.search), { credentials: "same-origin" })
    .then(function (response) {
      return response.json();
    })
    .then(function (result) {
      if (result.action === "redirect" && result.location && depth < 5) {
        const target = new URL(result.location, location.href);
        if (target.origin !== location.origin) location.assign(target.href);
        else navigate(target.href, Object.assign({}, opts, { depth: depth + 1 }));
      } else if (result.action === "response") {
        // The middleware answers this URL itself: let the browser show its response.
        location.assign(url.href);
      } else {
        commit(url, opts, result.rewrite || null);
      }
    })
    .catch(function () {
      commit(url, opts, null);
    });
}

function commit(url, opts, rewrite) {
  const state = rewrite ? { __noruRewrite: rewrite } : null;
  if (opts.replace) history.replaceState(state, "", url.href);
  else history.pushState(state, "", url.href);
  emit();
  if (opts.scroll !== false) {
    if (url.hash) {
      const id = decodeURIComponent(url.hash.slice(1));
      requestAnimationFrame(function () {
        const target = document.getElementById(id) || document.getElementsByName(id)[0];
        if (target) target.scrollIntoView();
      });
    } else {
      window.scrollTo(0, 0);
    }
  }
}

export function refresh() {
  asyncCache.clear();
  emit();
}

window.addEventListener("popstate", function () {
  emit();
});

// ------------------------------------------------------------------------------------------
// Async (server) components: React cannot render async components in the browser, so they
// are wrapped in a component that suspends until the promise they return is settled.

const AsyncFunction = async function () {}.constructor;
const asyncCache = new Map();
const asyncWrappers = new WeakMap();
const typeIds = new WeakMap();
let typeCount = 0;

function pruneAsyncCache() {
  const prefix = snapshot.key + "|";
  asyncCache.forEach(function (_, key) {
    if (key.indexOf(prefix) !== 0) asyncCache.delete(key);
  });
}

export function clearAsyncCache() {
  asyncCache.clear();
}

function propsKey(props) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(props, function (key, value) {
      if (key === "children" || typeof value === "function") return undefined;
      if (value && typeof value === "object") {
        if (value.$$typeof) return "[element]";
        if (seen.has(value)) return "[circular]";
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    return "?";
  }
}

export function asyncSafe(type) {
  if (typeof type !== "function" || !(type instanceof AsyncFunction)) return type;
  let wrapper = asyncWrappers.get(type);
  if (wrapper) return wrapper;
  if (!typeIds.has(type)) typeIds.set(type, ++typeCount);
  const id = typeIds.get(type);
  wrapper = function AsyncServerComponent(props) {
    const key = snapshot.key + "|" + id + "|" + propsKey(props);
    let entry = asyncCache.get(key);
    if (!entry) {
      entry = { status: "pending", value: undefined, promise: null };
      const current = entry;
      current.promise = Promise.resolve()
        .then(function () {
          return type(props);
        })
        .then(
          function (value) {
            current.status = "fulfilled";
            current.value = value;
          },
          function (error) {
            current.status = "rejected";
            current.value = error;
          },
        );
      asyncCache.set(key, entry);
    }
    if (entry.status === "fulfilled") return entry.value;
    if (entry.status === "rejected") throw entry.value;
    throw entry.promise;
  };
  wrapper.displayName = type.displayName || type.name || "AsyncComponent";
  asyncWrappers.set(type, wrapper);
  return wrapper;
}

// ------------------------------------------------------------------------------------------
// redirect() / notFound()

export function redirectError(url, replace) {
  const error = new Error("NEXT_REDIRECT");
  error.digest = "NEXT_REDIRECT;" + (replace ? "replace" : "push") + ";" + url;
  error.__noruRedirect = { url: url, replace: replace };
  return error;
}

export function notFoundError() {
  const error = new Error("NEXT_NOT_FOUND");
  error.digest = "NEXT_NOT_FOUND";
  error.__noruNotFound = true;
  return error;
}

function isRedirect(error) {
  return !!(error && error.__noruRedirect);
}

function isNotFound(error) {
  return !!(error && error.__noruNotFound);
}

export function isNavigationError(error) {
  return isRedirect(error) || isNotFound(error);
}

function followRedirect(error) {
  const target = error.__noruRedirect;
  setTimeout(function () {
    navigate(target.url, { replace: target.replace });
  }, 0);
}

// redirect() called in an event handler or a promise: not caught by React.
window.addEventListener("error", function (event) {
  if (isRedirect(event.error)) {
    event.preventDefault();
    followRedirect(event.error);
  }
});
window.addEventListener("unhandledrejection", function (event) {
  if (isRedirect(event.reason)) {
    event.preventDefault();
    followRedirect(event.reason);
  }
});

// ------------------------------------------------------------------------------------------
// Boundaries

/** error.tsx / global-error.tsx */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, error: null, resetKey: props.resetKey };
    this.reset = () => {
      clearAsyncCache();
      this.setState({ failed: false, error: null });
    };
  }
  static getDerivedStateFromError(error) {
    return { failed: true, error: error };
  }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { failed: false, error: null, resetKey: props.resetKey } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (isNavigationError(this.state.error)) throw this.state.error;
    return h(RouteFile, { load: this.props.load, file: this.props.file, props: { error: this.state.error, reset: this.reset } });
  }
}

/** not-found.tsx of a segment: catches notFound() thrown below it. */
class NotFoundBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, error: null, resetKey: props.resetKey };
  }
  static getDerivedStateFromError(error) {
    return { failed: true, error: error };
  }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { failed: false, error: null, resetKey: props.resetKey } : null;
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (isNotFound(this.state.error)) return this.props.fallback;
    throw this.state.error;
  }
}

/** Top level: follows redirects and shows the root not-found page. */
class RootBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, error: null, resetKey: props.resetKey };
  }
  static getDerivedStateFromError(error) {
    return { failed: true, error: error };
  }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { failed: false, error: null, resetKey: props.resetKey } : null;
  }
  componentDidCatch(error) {
    if (isRedirect(error)) followRedirect(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (isRedirect(this.state.error)) return null;
    if (isNotFound(this.state.error)) return this.props.notFound;
    return h(ApplicationError, { error: this.state.error });
  }
}

/** An error that no error.tsx caught (Next.js shows "Application error" too). */
function ApplicationError(props) {
  const error = props.error;
  const details = process.env.NODE_ENV === "production" ? null : String((error && (error.stack || error.message)) || error);
  return h(
    "div",
    {
      "data-noru-app-error": "",
      style: { fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "60rem", margin: "0 auto", color: "#111" },
    },
    h("h2", { style: { fontSize: "1.25rem" } }, "Application error: a client-side exception has occurred."),
    details
      ? h("pre", { style: { whiteSpace: "pre-wrap", background: "#fff1f0", color: "#a8071a", padding: "1rem", borderRadius: 6, fontSize: 13 } }, details)
      : null,
  );
}

// ------------------------------------------------------------------------------------------
// Matching

export const ParamsContext = React.createContext({});
export const SegmentsContext = React.createContext([]);

const ORDER = { static: 0, group: 1, dynamic: 2, catchall: 3, optional: 4 };

function kindOf(segment) {
  let m;
  if (/^\(.*\)$/.test(segment)) return { type: "group" };
  if ((m = /^\[\[\.\.\.(.+)\]\]$/.exec(segment))) return { type: "optional", name: m[1] };
  if ((m = /^\[\.\.\.(.+)\]$/.exec(segment))) return { type: "catchall", name: m[1] };
  if ((m = /^\[(.+)\]$/.exec(segment))) return { type: "dynamic", name: m[1] };
  return { type: "static", name: segment };
}

function prepare(node, isRoot) {
  node.kind = isRoot ? { type: "root" } : kindOf(node.s);
  node.children.forEach(function (child) {
    prepare(child, false);
  });
  node.children.sort(function (a, b) {
    return ORDER[a.kind.type] - ORDER[b.kind.type];
  });
}

function withParam(params, name, value) {
  const next = Object.assign({}, params);
  next[name] = value;
  return next;
}

function match(node, parts, i, params, chain) {
  if (i === parts.length && node.page) return { chain: chain, params: params };
  for (let c = 0; c < node.children.length; c++) {
    const child = node.children[c];
    const kind = child.kind;
    const next = chain.concat(child);
    let found = null;
    if (kind.type === "static") {
      if (i < parts.length && parts[i] === kind.name) found = match(child, parts, i + 1, params, next);
    } else if (kind.type === "group") {
      found = match(child, parts, i, params, next);
    } else if (kind.type === "dynamic") {
      if (i < parts.length) found = match(child, parts, i + 1, withParam(params, kind.name, parts[i]), next);
    } else if (kind.type === "catchall") {
      if (i < parts.length && child.page) found = { chain: next, params: withParam(params, kind.name, parts.slice(i)) };
    } else if (kind.type === "optional") {
      if (child.page) {
        found = { chain: next, params: i < parts.length ? withParam(params, kind.name, parts.slice(i)) : params };
      }
    }
    if (found) return found;
  }
  return null;
}

function splitPath(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map(function (part) {
      try {
        return decodeURIComponent(part);
      } catch (error) {
        return part;
      }
    });
}

function segmentValue(node, params) {
  const kind = node.kind;
  if (kind.type === "dynamic") return params[kind.name];
  if (kind.type === "catchall" || kind.type === "optional") return (params[kind.name] || []).join("/");
  return node.s;
}

// ------------------------------------------------------------------------------------------
// Rendering

/** params / searchParams: plain objects (Next.js 14) that are also promises (Next.js 15+). */
function thenable(value) {
  const promise = Promise.resolve(value);
  Object.assign(promise, value);
  // Lets React's use() read the value synchronously.
  if (!("status" in value)) Object.defineProperty(promise, "status", { value: "fulfilled" });
  if (!("value" in value)) Object.defineProperty(promise, "value", { value: value });
  return promise;
}

function searchObject(search) {
  const out = {};
  new URLSearchParams(search).forEach(function (value, key) {
    if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = [].concat(out[key], value);
    else out[key] = value;
  });
  return out;
}

/**
 * Renders the default export of a route file (page, layout, loading...). The file is loaded here,
 * when it is rendered: if it fails, the closest error boundary shows the error.
 */
function RouteFile(props) {
  const mod = props.load();
  const type = mod && mod.default;
  if (typeof type !== "function" && (typeof type !== "object" || type === null)) {
    throw new Error("noru: this " + props.file + " file has no default export (a React component is expected).");
  }
  return h(asyncSafe(type), props.props, props.children);
}

function routeFile(load, file, props, key, children) {
  return h(RouteFile, { key: key, load: load, file: file, props: props }, children);
}

function tryLoad(load) {
  try {
    return load ? load() : null;
  } catch (error) {
    return null;
  }
}

function DefaultNotFound() {
  return h(
    "div",
    {
      style: {
        fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
        height: "100vh",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    h(
      "div",
      null,
      h(
        "h1",
        {
          style: {
            display: "inline-block",
            margin: "0 20px 0 0",
            padding: "0 23px 0 0",
            fontSize: 24,
            fontWeight: 500,
            verticalAlign: "top",
            lineHeight: "49px",
            borderRight: "1px solid rgba(128,128,128,.3)",
          },
        },
        "404",
      ),
      h(
        "div",
        { style: { display: "inline-block" } },
        h("h2", { style: { fontSize: 14, fontWeight: 400, lineHeight: "49px", margin: 0 } }, "This page could not be found."),
      ),
    ),
  );
}

function renderNotFound(tree) {
  let el = tree.notFound ? routeFile(tree.notFound, "not-found") : h(DefaultNotFound);
  if (tree.layout) el = routeFile(tree.layout, "layout", { params: thenable({}) }, undefined, el);
  return el;
}

function renderMatch(found, loc, paramsProp, searchProp) {
  const chain = found.chain;
  const leaf = chain[chain.length - 1];
  let el = routeFile(leaf.page, "page", { params: paramsProp, searchParams: searchProp }, loc.pathname);
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (node.notFound) {
      el = h(NotFoundBoundary, { resetKey: loc.pathname, fallback: routeFile(node.notFound, "not-found") }, el);
    }
    if (node.loading) el = h(React.Suspense, { fallback: routeFile(node.loading, "loading") }, el);
    if (node.error) el = h(ErrorBoundary, { resetKey: loc.pathname, load: node.error, file: "error" }, el);
    if (node.template) el = routeFile(node.template, "template", {}, loc.pathname, el);
    if (node.layout) {
      const key = node.s + ":" + segmentValue(node, found.params);
      el = routeFile(node.layout, "layout", { params: paramsProp }, key, el);
    }
    const below = chain.slice(i + 1).map(function (n) {
      return segmentValue(n, found.params);
    });
    el = h(SegmentsContext.Provider, { value: below }, el);
  }
  return el;
}

// ------------------------------------------------------------------------------------------
// Metadata (export const metadata / generateMetadata) -> document.title, <meta name="description">

function setMeta(name, content) {
  let meta = document.head.querySelector('meta[name="' + name + '"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", name);
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", String(content));
}

async function applyMetadata(found, paramsProp, searchProp, key) {
  if (!found) {
    document.title = "404: This page could not be found.";
    return;
  }
  const mods = [];
  found.chain.forEach(function (node) {
    const layout = tryLoad(node.layout);
    if (layout) mods.push(layout);
  });
  const page = tryLoad(found.chain[found.chain.length - 1].page);
  if (page) mods.push(page);

  let template = null;
  let title;
  let description;
  for (let i = 0; i < mods.length; i++) {
    const mod = mods[i];
    let md = mod.metadata;
    if (!md && typeof mod.generateMetadata === "function") {
      try {
        md = await mod.generateMetadata({ params: paramsProp, searchParams: searchProp }, Promise.resolve({}));
      } catch (error) {
        md = null;
      }
    }
    if (!md) continue;
    const t = md.title;
    if (typeof t === "string") {
      title = template ? template.replace("%s", t) : t;
    } else if (t && typeof t === "object") {
      if (t.absolute) title = t.absolute;
      else if (t.default) title = t.default;
      if (t.template) template = t.template;
    }
    if (md.description != null) description = md.description;
  }
  if (key !== snapshot.key) return; // navigated in the meantime
  if (title != null) document.title = String(title);
  if (description != null) setMeta("description", description);
}

// ------------------------------------------------------------------------------------------
// App

function App(props) {
  const routes = props.routes;
  const loc = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A path rewritten by the middleware renders another page under the same URL.
  const renderedPath = loc.rewrite ? loc.rewrite.split("?")[0] : loc.pathname;
  const found = React.useMemo(
    function () {
      return match(routes.tree, splitPath(renderedPath), 0, {}, [routes.tree]);
    },
    [routes.tree, renderedPath],
  );
  const paramsProp = React.useMemo(
    function () {
      return thenable(found ? found.params : {});
    },
    [found],
  );
  const searchProp = React.useMemo(
    function () {
      return thenable(searchObject(loc.search));
    },
    [loc.search],
  );
  React.useEffect(
    function () {
      applyMetadata(found, paramsProp, searchProp, loc.key);
    },
    [found, paramsProp, searchProp, loc.key],
  );

  const notFound = renderNotFound(routes.tree);
  let el = found ? renderMatch(found, loc, paramsProp, searchProp) : notFound;
  el = h(ParamsContext.Provider, { value: found ? found.params : {} }, el);
  el = h(RootBoundary, { resetKey: loc.pathname + loc.search, notFound: notFound }, el);
  if (routes.globalError) {
    el = h(ErrorBoundary, { resetKey: loc.pathname, load: routes.globalError, file: "global-error" }, el);
  }
  return el;
}

export function start(routes) {
  prepare(routes.tree, true);
  (routes.icons || []).forEach(function (icon) {
    const link = document.createElement("link");
    link.rel = icon.rel;
    link.href = icon.href && typeof icon.href === "object" ? icon.href.src : icon.href;
    document.head.appendChild(link);
  });
  const app = h(App, { routes: routes });
  const root = createRoot(document.getElementById("__next"), {
    // redirect() / notFound() are thrown on purpose: do not report them like errors (React 19+).
    onCaughtError: function (error, info) {
      if (isNavigationError(error)) return;
      console.error(error);
      if (process.env.NODE_ENV !== "production" && info && info.componentStack) {
        console.error("The above error occurred in this component tree:" + info.componentStack);
      }
    },
  });
  root.render(process.env.NODE_ENV === "production" ? app : h(React.StrictMode, null, app));
}
