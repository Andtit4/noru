// noru: browser versions of the small `next/*` modules.
// This file is split in several virtual modules by noru (see next/mod.rs): each section below
// becomes its own module. Sections start with `// @module <name>`.

// @module dynamic.js
import * as React from "react";

export default function dynamic(loader, options) {
  let opts = options || {};
  if (loader && typeof loader === "object" && typeof loader.then !== "function") {
    opts = loader;
    loader = opts.loader;
  }
  const Loading = opts.loading;
  const Lazy = React.lazy(function () {
    return Promise.resolve(typeof loader === "function" ? loader() : loader).then(function (mod) {
      // `() => import("./X")` gives a module, `() => import("./X").then((m) => m.X)` a component
      // (a function, or an object with $$typeof for memo / forwardRef components).
      const isModule = mod && typeof mod === "object" && !mod.$$typeof && "default" in mod;
      return { default: isModule ? mod.default : mod };
    });
  });
  function DynamicComponent(props) {
    const fallback = Loading ? React.createElement(Loading, { isLoading: true, pastDelay: true, error: null }) : null;
    return React.createElement(React.Suspense, { fallback: fallback }, React.createElement(Lazy, props));
  }
  DynamicComponent.displayName = "DynamicComponent";
  return DynamicComponent;
}

// @module head.js
import * as React from "react";
import { createPortal } from "react-dom";

export default function Head(props) {
  return props.children == null ? null : createPortal(props.children, document.head);
}

// @module script.js
import * as React from "react";

const loadedScripts = new Set();

export default function Script(props) {
  const { src, id, strategy, onLoad, onReady, onError, children, dangerouslySetInnerHTML, ...rest } = props;
  React.useEffect(
    function () {
      const key = id || src;
      if (key && loadedScripts.has(key)) {
        if (onReady) onReady();
        return;
      }
      if (key) loadedScripts.add(key);
      const script = document.createElement("script");
      Object.keys(rest).forEach(function (name) {
        const value = rest[name];
        if (value == null || value === false || typeof value === "function") return;
        script.setAttribute(name === "className" ? "class" : name, value === true ? "" : String(value));
      });
      if (id) script.id = id;
      if (src) {
        script.src = src;
        script.async = true;
        script.onload = function (event) {
          if (onLoad) onLoad(event);
          if (onReady) onReady();
        };
        if (onError) script.onerror = onError;
      } else {
        script.text =
          dangerouslySetInnerHTML && dangerouslySetInnerHTML.__html != null
            ? dangerouslySetInnerHTML.__html
            : typeof children === "string"
              ? children
              : "";
      }
      document.body.appendChild(script);
      if (!src && onReady) onReady();
    },
    [src, id],
  );
  return null;
}

// @module headers.js
function settled(value) {
  const promise = Promise.resolve(value);
  return Object.assign(promise, value);
}

function readCookies() {
  const out = new Map();
  if (!document.cookie) return out;
  document.cookie.split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index === -1) return;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (error) {}
    out.set(name, { name: name, value: value });
  });
  return out;
}

export function cookies() {
  const store = {
    get: function (name) {
      return readCookies().get(typeof name === "object" ? name.name : name);
    },
    getAll: function (name) {
      const all = Array.from(readCookies().values());
      return name ? all.filter((c) => c.name === name) : all;
    },
    has: function (name) {
      return readCookies().has(name);
    },
    set: function (name, value) {
      document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + "; path=/";
    },
    delete: function (name) {
      document.cookie = encodeURIComponent(name) + "=; path=/; max-age=0";
    },
    toString: function () {
      return document.cookie;
    },
  };
  Object.defineProperty(store, "size", {
    get: function () {
      return readCookies().size;
    },
  });
  return settled(store);
}

export function headers() {
  const result = new Headers({ "user-agent": navigator.userAgent });
  const promise = Promise.resolve(result);
  ["get", "has", "forEach", "entries", "keys", "values"].forEach(function (name) {
    promise[name] = result[name].bind(result);
  });
  return promise;
}

export function draftMode() {
  return settled({ isEnabled: false, enable: function () {}, disable: function () {} });
}

// @module pages-router.js
import * as React from "react";
import { subscribe, getSnapshot, navigate } from "noru-next/router";

function query() {
  const out = {};
  new URLSearchParams(getSnapshot().search).forEach(function (value, key) {
    out[key] = key in out ? [].concat(out[key], value) : value;
  });
  return out;
}

function makeRouter() {
  const snap = getSnapshot();
  return {
    pathname: snap.pathname,
    route: snap.pathname,
    asPath: snap.pathname + snap.search + snap.hash,
    query: query(),
    isReady: true,
    isFallback: false,
    basePath: "",
    push: function (url) {
      navigate(typeof url === "string" ? url : url.pathname || "/");
      return Promise.resolve(true);
    },
    replace: function (url) {
      navigate(typeof url === "string" ? url : url.pathname || "/", { replace: true });
      return Promise.resolve(true);
    },
    back: function () {
      history.back();
    },
    reload: function () {
      location.reload();
    },
    prefetch: function () {
      return Promise.resolve();
    },
    events: { on: function () {}, off: function () {}, emit: function () {} },
  };
}

export function useRouter() {
  React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return makeRouter();
}

export function withRouter(Component) {
  return function WithRouter(props) {
    return React.createElement(Component, Object.assign({}, props, { router: useRouter() }));
  };
}

const Router = {
  get router() {
    return makeRouter();
  },
  push: function (url) {
    return makeRouter().push(url);
  },
  replace: function (url) {
    return makeRouter().replace(url);
  },
  back: function () {
    history.back();
  },
  events: { on: function () {}, off: function () {}, emit: function () {} },
};

export default Router;

// @module server.js
function unsupported(name) {
  return function () {
    throw new Error("noru: next/server " + name + " needs a server (route handlers and middleware are not supported yet)");
  };
}

export class NextResponse extends Response {
  static json(body, init) {
    return new Response(JSON.stringify(body), Object.assign({ headers: { "content-type": "application/json" } }, init));
  }
}
NextResponse.next = unsupported("NextResponse.next");
NextResponse.redirect = unsupported("NextResponse.redirect");
NextResponse.rewrite = unsupported("NextResponse.rewrite");

export class NextRequest extends Request {}

export function userAgent() {
  return { ua: navigator.userAgent, isBot: false, browser: {}, device: {}, engine: {}, os: {}, cpu: {} };
}

export const after = function (task) {
  if (typeof task === "function") Promise.resolve().then(task);
};

export const connection = function () {
  return Promise.resolve();
};

// @module cache.js
export function revalidatePath() {}
export function revalidateTag() {}
export function updateTag() {}
export function refresh() {}
export function unstable_noStore() {}
export function unstable_cache(fn) {
  return fn;
}
export function unstable_cacheLife() {}
export function unstable_cacheTag() {}
export function cacheLife() {}
export function cacheTag() {}

// @module config.js
export default function getConfig() {
  return { publicRuntimeConfig: {}, serverRuntimeConfig: {} };
}

// @module form.js
import * as React from "react";
import { navigate } from "noru-next/router";

export default function Form(props) {
  const { action, replace, scroll, onSubmit, ...rest } = props;
  return React.createElement(
    "form",
    Object.assign({}, rest, {
      action: typeof action === "string" ? action : undefined,
      onSubmit: function (event) {
        if (onSubmit) onSubmit(event);
        if (event.defaultPrevented) return;
        if (typeof action === "function") {
          event.preventDefault();
          action(new FormData(event.currentTarget));
          return;
        }
        if (typeof action !== "string") return;
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach(function (value, key) {
          if (typeof value === "string") params.append(key, value);
        });
        navigate(action + (action.indexOf("?") === -1 ? "?" : "&") + params.toString(), {
          replace: !!replace,
          scroll: scroll !== false,
        });
      },
    }),
  );
}

// @module font-local.js
let warned = false;

export default function localFont(options) {
  if (!warned) {
    warned = true;
    console.warn("noru: next/font/local is not supported yet, the fallback font is used");
  }
  const fallback = (options && options.fallback ? options.fallback : ["sans-serif"]).join(", ");
  return { className: "", style: { fontFamily: fallback }, variable: undefined };
}

// @module empty.js
export {};
