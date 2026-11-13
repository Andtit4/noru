// noru: server runtime for Next.js apps. Runs the middleware (middleware.ts / proxy.ts) and the route
// handlers (route.ts) of the app in Node.js, with server versions of next/server, next/headers...
// Used by `noru dev` / `noru start` (through server-worker.js) and by the npm package's server.
"use strict";

function createNoruServerRuntime(options) {
  const fs = require("fs");
  const path = require("path");
  const Module = require("module");
  const { AsyncLocalStorage } = require("async_hooks");

  const root = options.root;
  const mode = options.mode || "development";
  const nodeRequire = Module.createRequire(path.join(root, "package.json"));
  loadEnv(root, mode);

  const requestStore = new AsyncLocalStorage();
  const shims = createShims(requestStore);
  installRequireHook(shims);

  let app = null;
  let routes = [];

  /** Loads (or reloads) the server bundle made by noru. */
  function load(code) {
    const module = { exports: {} };
    const factory = new Function("__noru_node_require", "module", "exports", "require", code);
    factory(nodeRequire, module, module.exports, nodeRequire);
    app = module.exports;
    routes = (app.routes || []).map((route) => ({ pattern: route.pattern, load: route.load, segments: parsePattern(route.pattern) }));
  }

  // ----------------------------------------------------------------------------------------------
  // Requests

  function makeRequest(input) {
    const headers = new Headers();
    for (const [name, value] of input.headers || []) {
      try {
        headers.append(name, value);
      } catch (error) {}
    }
    const init = { method: input.method || "GET", headers };
    if (input.body && init.method !== "GET" && init.method !== "HEAD") {
      init.body = Buffer.from(input.body, "base64");
      init.duplex = "half";
    }
    return new shims["next/server"].NextRequest(input.url, init);
  }

  function newStore(request) {
    return {
      headers: request.headers,
      cookies: request.cookies,
      responseCookies: new shims["next/server"].ResponseCookies(new Headers()),
    };
  }

  /** Middleware, then route handler: what to do with a request (`next` = noru serves the page). */
  async function handle(input) {
    const request = makeRequest(input);
    const store = newStore(request);
    return requestStore.run(store, async () => {
      const url = new URL(input.url);
      const decision = await runMiddleware(request, url, input);
      if (decision.action === "redirect" || decision.action === "response") return finish(decision, store);
      let target = url;
      if (decision.action === "rewrite") target = new URL(decision.rewrite, url);
      const found = matchRoute(target.pathname);
      if (found) {
        const routeRequest = target.href === url.href ? request : makeRequest(Object.assign({}, input, { url: target.href }));
        const response = await runRoute(found.route, routeRequest, found.params);
        const answer = await toAnswer(response, "response");
        answer.headers = decision.headers.concat(answer.headers);
        return finish(answer, store);
      }
      return finish(
        { action: "next", rewrite: decision.action === "rewrite" ? target.pathname + target.search : undefined, headers: decision.headers },
        store,
      );
    });
  }

  /** Only the middleware, for client-side navigations (the browser asks before changing page). */
  async function middlewareOnly(input) {
    const request = makeRequest(input);
    const store = newStore(request);
    return requestStore.run(store, async () => finish(await runMiddleware(request, new URL(input.url), input), store));
  }

  function finish(answer, store) {
    const cookies = store.responseCookies.headers.getSetCookie();
    if (cookies.length) answer.headers = (answer.headers || []).concat(cookies.map((c) => ["set-cookie", c]));
    answer.headers = answer.headers || [];
    return answer;
  }

  // ----------------------------------------------------------------------------------------------
  // Middleware

  let middlewareCache = null;

  function middlewareModule() {
    if (!app || typeof app.middleware !== "function") return null;
    const mod = app.middleware();
    if (middlewareCache && middlewareCache.mod === mod) return middlewareCache;
    const fn = mod.middleware || mod.proxy || mod.default;
    if (typeof fn !== "function") throw new Error("noru: the middleware file has no `middleware` (or default) export");
    middlewareCache = { mod: mod, fn: fn, matchers: compileMatchers(mod.config) };
    return middlewareCache;
  }

  async function runMiddleware(request, url, input) {
    const middleware = middlewareModule();
    if (!middleware || !matches(middleware.matchers, url, request)) return { action: "next", headers: [] };
    const event = {
      sourcePage: url.pathname,
      waitUntil: function (promise) {
        Promise.resolve(promise).catch(function () {});
      },
      passThroughOnException: function () {},
    };
    const response = await middleware.fn(request, event);
    if (!response) return { action: "next", headers: [] };
    const headers = forwardedHeaders(response);
    const rewrite = response.headers.get("x-middleware-rewrite");
    if (rewrite) {
      const target = new URL(rewrite, url);
      if (target.origin !== url.origin) {
        // Rewrite to another server: proxy the request.
        const proxied = await fetch(target, { method: input.method, headers: request.headers, body: request.body, duplex: "half", redirect: "manual" });
        const answer = await toAnswer(proxied, "response");
        answer.headers = headers.concat(answer.headers);
        return answer;
      }
      return { action: "rewrite", rewrite: target.pathname + target.search, headers: headers };
    }
    if (response.headers.get("x-middleware-next")) return { action: "next", headers: headers };
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      return { action: "redirect", status: response.status, location: new URL(location, url).href, headers: headers };
    }
    return toAnswer(response, "response");
  }

  /** Headers of a middleware response that go on the final response (cookies, custom headers). */
  function forwardedHeaders(response) {
    const out = [];
    response.headers.forEach(function (value, name) {
      if (/^(x-middleware-|location$|content-length$|content-type$|set-cookie$)/.test(name)) return;
      out.push([name, value]);
    });
    for (const cookie of response.headers.getSetCookie()) out.push(["set-cookie", cookie]);
    return out;
  }

  function compileMatchers(config) {
    const raw = config && config.matcher;
    if (!raw) return null;
    return [].concat(raw).map(function (entry) {
      const source = typeof entry === "string" ? entry : entry.source;
      return { regex: matcherRegex(source), has: entry.has, missing: entry.missing };
    });
  }

  function matches(matchers, url, request) {
    if (!matchers) return true;
    return matchers.some(function (m) {
      return m.regex.test(url.pathname) && conditions(m.has, url, request, true) && conditions(m.missing, url, request, false);
    });
  }

  function conditions(list, url, request, expected) {
    if (!list) return true;
    return list.every(function (c) {
      let value;
      if (c.type === "header") value = request.headers.get(c.key);
      else if (c.type === "cookie") value = request.cookies.get(c.key) && request.cookies.get(c.key).value;
      else if (c.type === "query") value = url.searchParams.get(c.key);
      else if (c.type === "host") value = url.hostname;
      const present = value != null && (c.value == null || new RegExp("^" + c.value + "$").test(value));
      return present === expected;
    });
  }

  // ----------------------------------------------------------------------------------------------
  // Route handlers

  function parsePattern(pattern) {
    return pattern
      .split("/")
      .filter(Boolean)
      .map(function (segment) {
        let m;
        if ((m = /^\[\[\.\.\.(.+)\]\]$/.exec(segment))) return { type: "optional", name: m[1] };
        if ((m = /^\[\.\.\.(.+)\]$/.exec(segment))) return { type: "catchall", name: m[1] };
        if ((m = /^\[(.+)\]$/.exec(segment))) return { type: "dynamic", name: m[1] };
        return { type: "static", name: segment };
      });
  }

  function matchSegments(segments, parts) {
    const params = {};
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment.type === "catchall" || segment.type === "optional") {
        if (segment.type === "catchall" && i >= parts.length) return null;
        if (i < parts.length) params[segment.name] = parts.slice(i);
        return params;
      }
      if (i >= parts.length) return null;
      if (segment.type === "static" && segment.name !== parts[i]) return null;
      if (segment.type === "dynamic") params[segment.name] = parts[i];
    }
    return segments.length === parts.length ? params : null;
  }

  const ORDER = { static: 0, dynamic: 1, catchall: 2, optional: 3 };

  function specificity(route) {
    return route.segments.map(function (s) {
      return ORDER[s.type];
    });
  }

  function matchRoute(pathname) {
    const parts = pathname
      .split("/")
      .filter(Boolean)
      .map(function (part) {
        try {
          return decodeURIComponent(part);
        } catch (error) {
          return part;
        }
      });
    let best = null;
    for (const route of routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      if (!best || compare(specificity(route), specificity(best.route)) < 0) best = { route: route, params: params };
    }
    return best;
  }

  function compare(a, b) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return b.length - a.length;
  }

  const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

  async function runRoute(route, request, params) {
    const mod = route.load();
    const method = request.method.toUpperCase();
    let handler = mod[method];
    if (!handler && method === "HEAD") handler = mod.GET;
    const allow = METHODS.filter(function (m) {
      return typeof mod[m] === "function";
    }).join(", ");
    if (!handler && method === "OPTIONS") return new Response(null, { status: 204, headers: { allow: allow } });
    if (typeof handler !== "function") return new Response(null, { status: 405, headers: { allow: allow } });
    const paramsValue = Object.assign(Promise.resolve(params), params);
    try {
      const response = await handler(request, { params: paramsValue });
      if (response instanceof Response) return response;
      throw new Error("noru: the " + method + " handler of " + route.pattern + " did not return a Response");
    } catch (error) {
      if (error && error.__noruRedirect) {
        return new Response(null, { status: error.__noruRedirect.status, headers: { location: error.__noruRedirect.url } });
      }
      if (error && error.__noruNotFound) return new Response("Not Found", { status: 404 });
      throw error;
    }
  }

  async function toAnswer(response, action) {
    const headers = [];
    response.headers.forEach(function (value, name) {
      if (name !== "set-cookie") headers.push([name, value]);
    });
    for (const cookie of response.headers.getSetCookie()) headers.push(["set-cookie", cookie]);
    const body = response.body ? Buffer.from(await response.arrayBuffer()).toString("base64") : "";
    return { action: action, status: response.status, headers: headers, body: body };
  }

  return {
    load: load,
    handle: handle,
    middlewareOnly: middlewareOnly,
    hasMiddleware: function () {
      return !!(app && app.middleware);
    },
  };
}

// --------------------------------------------------------------------------------------------------
// next.config-style matcher (path-to-regexp syntax) -> RegExp

function matcherRegex(source) {
  let re = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ":") {
      const m = /^:([A-Za-z0-9_]+)(\((?:[^()\\]|\\.)*\))?([*+?])?/.exec(source.slice(i));
      if (!m) {
        re += "\\:";
        i++;
        continue;
      }
      const pattern = m[2] ? m[2].slice(1, -1) : "[^/]+";
      const modifier = m[3];
      if ((modifier === "*" || modifier === "?") && re.endsWith("/")) {
        re = re.slice(0, -1) + (modifier === "*" ? "(?:/" + pattern + ")*" : "(?:/" + pattern + ")?");
      } else if (modifier === "+") {
        re += pattern + "(?:/" + pattern + ")*";
      } else if (modifier) {
        re += "(?:" + pattern + ")" + modifier;
      } else {
        re += "(" + pattern + ")";
      }
      i += m[0].length;
    } else if (ch === "(") {
      let depth = 0;
      let j = i;
      for (; j < source.length; j++) {
        if (source[j] === "\\") {
          j++;
          continue;
        }
        if (source[j] === "(") depth++;
        else if (source[j] === ")" && --depth === 0) break;
      }
      re += source.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "*") {
      re += ".*";
      i++;
    } else {
      re += /[.+?^${}|[\]\\]/.test(ch) ? "\\" + ch : ch;
      i++;
    }
  }
  return new RegExp("^" + re + "(?:/)?$");
}

// --------------------------------------------------------------------------------------------------
// .env files: on the server, every variable is available (not only NEXT_PUBLIC_*)

function loadEnv(root, mode) {
  const fs = require("fs");
  const path = require("path");
  const fromFiles = {};
  for (const file of [".env", ".env." + mode, ".env.local", ".env." + mode + ".local"]) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
      if (!m) continue;
      let value = (m[2] || "").trim();
      const quote = value[0];
      if ((quote === '"' || quote === "'" || quote === "`") && value.endsWith(quote) && value.length >= 2) {
        value = value.slice(1, -1);
        if (quote === '"') value = value.replace(/\\n/g, "\n");
      } else {
        const hash = value.indexOf(" #");
        if (hash !== -1) value = value.slice(0, hash).trim();
      }
      fromFiles[m[1]] = value;
    }
  }
  // `${VAR}` / `$VAR` refer to other variables, like Next.js (dotenv-expand).
  const lookup = function (name) {
    if (process.env[name] !== undefined) return process.env[name];
    return fromFiles[name] !== undefined ? fromFiles[name] : "";
  };
  for (const key of Object.keys(fromFiles)) {
    if (process.env[key] !== undefined) continue;
    process.env[key] = fromFiles[key].replace(/\\\$|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, function (all, braced, bare) {
      return braced || bare ? lookup(braced || bare) : "$";
    });
  }
  if (!process.env.NODE_ENV) process.env.NODE_ENV = mode === "production" ? "production" : "development";
}

// --------------------------------------------------------------------------------------------------
// next/* modules on the server

function installRequireHook(shims) {
  const Module = require("module");
  if (Module.__noruHook) {
    Module.__noruHook.shims = shims;
    return;
  }
  const original = Module._load;
  const hook = { shims: shims };
  Module.__noruHook = hook;
  Module._load = function (request, parent, isMain) {
    const name = request.replace(/\.js$/, "");
    if (Object.prototype.hasOwnProperty.call(hook.shims, name)) return hook.shims[name];
    return original.call(this, request, parent, isMain);
  };
}

function createShims(requestStore) {
  function parseCookies(header) {
    const map = new Map();
    if (!header) return map;
    for (const part of header.split(/;\s*/)) {
      const index = part.indexOf("=");
      if (index <= 0) continue;
      const name = part.slice(0, index).trim();
      let value = part.slice(index + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch (error) {}
      if (!map.has(name)) map.set(name, value);
    }
    return map;
  }

  function serializeCookie(name, value, options) {
    const o = options || {};
    let text = name + "=" + encodeURIComponent(value == null ? "" : String(value));
    if (o.maxAge != null) text += "; Max-Age=" + Math.floor(o.maxAge);
    if (o.expires != null) text += "; Expires=" + new Date(o.expires).toUTCString();
    text += "; Path=" + (o.path || "/");
    if (o.domain) text += "; Domain=" + o.domain;
    if (o.secure) text += "; Secure";
    if (o.httpOnly) text += "; HttpOnly";
    if (o.sameSite) {
      const sameSite = o.sameSite === true ? "strict" : String(o.sameSite).toLowerCase();
      text += "; SameSite=" + sameSite.charAt(0).toUpperCase() + sameSite.slice(1);
    }
    if (o.priority) text += "; Priority=" + o.priority;
    if (o.partitioned) text += "; Partitioned";
    return text;
  }

  function cookieArgs(args) {
    return typeof args[0] === "object" && args[0] !== null ? [args[0].name, args[0].value, args[0]] : [args[0], args[1], args[2]];
  }

  class RequestCookies {
    constructor(headers) {
      this._headers = headers;
      this._map = parseCookies(headers.get("cookie"));
    }
    get(name) {
      const key = typeof name === "object" && name !== null ? name.name : name;
      return this._map.has(key) ? { name: key, value: this._map.get(key) } : undefined;
    }
    getAll(name) {
      const all = Array.from(this._map, function (entry) {
        return { name: entry[0], value: entry[1] };
      });
      if (!name) return all;
      const key = typeof name === "object" ? name.name : name;
      return all.filter(function (c) {
        return c.name === key;
      });
    }
    has(name) {
      return this._map.has(name);
    }
    set() {
      const [name, value] = cookieArgs(arguments);
      this._map.set(name, String(value));
      this._sync();
      return this;
    }
    delete(names) {
      const self = this;
      const result = [].concat(names).map(function (n) {
        return self._map.delete(n);
      });
      this._sync();
      return Array.isArray(names) ? result : result[0];
    }
    clear() {
      this._map.clear();
      this._sync();
      return this;
    }
    get size() {
      return this._map.size;
    }
    [Symbol.iterator]() {
      return Array.from(this._map, function (entry) {
        return [entry[0], { name: entry[0], value: entry[1] }];
      })[Symbol.iterator]();
    }
    toString() {
      return Array.from(this._map, function (entry) {
        return entry[0] + "=" + encodeURIComponent(entry[1]);
      }).join("; ");
    }
    _sync() {
      try {
        this._headers.set("cookie", this.toString());
      } catch (error) {}
    }
  }

  class ResponseCookies {
    constructor(headers) {
      this.headers = headers;
      this._map = new Map();
    }
    set() {
      const [name, value, options] = cookieArgs(arguments);
      this._map.set(name, Object.assign({ name: name, value: String(value) }, options || {}));
      this.headers.append("set-cookie", serializeCookie(name, value, options));
      return this;
    }
    get(name) {
      return this._map.get(typeof name === "object" && name !== null ? name.name : name);
    }
    getAll(name) {
      const all = Array.from(this._map.values());
      return name ? all.filter((c) => c.name === name) : all;
    }
    has(name) {
      return this._map.has(name);
    }
    delete(name) {
      const key = typeof name === "object" && name !== null ? name.name : name;
      return this.set(key, "", { maxAge: 0, expires: new Date(0), path: (typeof name === "object" && name.path) || "/" });
    }
    toString() {
      return this.headers.getSetCookie().join(", ");
    }
  }

  class NextURL extends URL {
    clone() {
      return new NextURL(this.href);
    }
    get basePath() {
      return "";
    }
    get locale() {
      return "";
    }
    get defaultLocale() {
      return undefined;
    }
    get buildId() {
      return undefined;
    }
  }

  class NextRequest extends Request {
    constructor(input, init) {
      super(input, init);
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      this._nextUrl = new NextURL(url);
      this._cookies = new RequestCookies(this.headers);
    }
    get nextUrl() {
      return this._nextUrl;
    }
    get cookies() {
      return this._cookies;
    }
    get geo() {
      return {};
    }
    get ip() {
      return this.headers.get("x-forwarded-for") || undefined;
    }
    get page() {
      return undefined;
    }
  }

  class NextResponse extends Response {
    constructor(body, init) {
      super(body, init);
      this._cookies = new ResponseCookies(this.headers);
    }
    get cookies() {
      return this._cookies;
    }
    static json(body, init) {
      const headers = new Headers(init && init.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new NextResponse(JSON.stringify(body), Object.assign({}, init, { headers: headers }));
    }
    static redirect(url, init) {
      const status = typeof init === "number" ? init : (init && init.status) || 307;
      const headers = new Headers(typeof init === "object" && init ? init.headers : undefined);
      headers.set("location", String(url));
      return new NextResponse(null, { status: status, headers: headers });
    }
    static rewrite(destination, init) {
      const response = new NextResponse(null, init);
      response.headers.set("x-middleware-rewrite", String(destination));
      return response;
    }
    static next(init) {
      const response = new NextResponse(null, init);
      response.headers.set("x-middleware-next", "1");
      return response;
    }
  }

  class NextFetchEvent {
    constructor(params) {
      this.sourcePage = params && params.page;
    }
    waitUntil(promise) {
      Promise.resolve(promise).catch(function () {});
    }
    passThroughOnException() {}
  }

  function userAgentFromString(ua) {
    const text = ua || "";
    return {
      ua: text,
      isBot: /bot|crawl|spider|slurp/i.test(text),
      browser: {},
      device: { type: /mobile/i.test(text) ? "mobile" : undefined },
      engine: {},
      os: {},
      cpu: {},
    };
  }

  const nextServer = {
    NextRequest: NextRequest,
    NextResponse: NextResponse,
    NextFetchEvent: NextFetchEvent,
    RequestCookies: RequestCookies,
    ResponseCookies: ResponseCookies,
    userAgentFromString: userAgentFromString,
    userAgent: function (request) {
      return userAgentFromString(request.headers.get("user-agent"));
    },
    after: function (task) {
      Promise.resolve()
        .then(typeof task === "function" ? task : function () {
          return task;
        })
        .catch(function () {});
    },
    connection: function () {
      return Promise.resolve();
    },
    URLPattern: globalThis.URLPattern,
  };
  nextServer.unstable_after = nextServer.after;

  // next/headers: per-request values (AsyncLocalStorage), usable directly (Next.js 14) or awaited (15+).
  function settled(value, methods) {
    const promise = Promise.resolve(value);
    for (const name of methods) {
      if (typeof value[name] === "function") promise[name] = value[name].bind(value);
    }
    if (typeof value[Symbol.iterator] === "function") promise[Symbol.iterator] = value[Symbol.iterator].bind(value);
    return promise;
  }

  function store() {
    return requestStore.getStore();
  }

  const nextHeaders = {
    headers: function () {
      const s = store();
      return settled(s ? s.headers : new Headers(), ["get", "has", "forEach", "entries", "keys", "values", "getSetCookie"]);
    },
    cookies: function () {
      const s = store();
      const jar = s ? s.cookies : new RequestCookies(new Headers());
      const api = {
        get: (name) => jar.get(name),
        getAll: (name) => jar.getAll(name),
        has: (name) => jar.has(name),
        set: function () {
          const [name, value, options] = cookieArgs(arguments);
          if (s) s.responseCookies.set(name, value, options);
          jar.set(name, value);
          return api;
        },
        delete: function (name) {
          const key = typeof name === "object" && name !== null ? name.name : name;
          if (s) s.responseCookies.delete(name);
          jar.delete(key);
          return api;
        },
        toString: () => jar.toString(),
        [Symbol.iterator]: () => jar[Symbol.iterator](),
      };
      const promise = settled(api, ["get", "getAll", "has", "set", "delete", "toString"]);
      Object.defineProperty(promise, "size", {
        get: function () {
          return jar.size;
        },
      });
      return promise;
    },
    draftMode: function () {
      return settled({ isEnabled: false, enable: function () {}, disable: function () {} }, ["enable", "disable"]);
    },
  };

  function redirectError(url, status) {
    const error = new Error("NEXT_REDIRECT");
    error.digest = "NEXT_REDIRECT;replace;" + url + ";" + status;
    error.__noruRedirect = { url: url, status: status };
    return error;
  }

  function notFoundError() {
    const error = new Error("NEXT_NOT_FOUND");
    error.digest = "NEXT_NOT_FOUND";
    error.__noruNotFound = true;
    return error;
  }

  const serverOnly = function (name) {
    return function () {
      throw new Error("noru: " + name + "() can only be used in the browser");
    };
  };

  const nextNavigation = {
    redirect: function (url) {
      throw redirectError(url, 307);
    },
    permanentRedirect: function (url) {
      throw redirectError(url, 308);
    },
    notFound: function () {
      throw notFoundError();
    },
    forbidden: function () {
      throw notFoundError();
    },
    unauthorized: function () {
      throw notFoundError();
    },
    RedirectType: { push: "push", replace: "replace" },
    useRouter: serverOnly("useRouter"),
    usePathname: serverOnly("usePathname"),
    useSearchParams: serverOnly("useSearchParams"),
    useParams: serverOnly("useParams"),
  };

  const noop = function () {};
  const nextCache = {
    revalidatePath: noop,
    revalidateTag: noop,
    updateTag: noop,
    refresh: noop,
    unstable_noStore: noop,
    unstable_cache: function (fn) {
      return fn;
    },
    unstable_cacheLife: noop,
    unstable_cacheTag: noop,
    cacheLife: noop,
    cacheTag: noop,
  };

  return {
    "next/server": nextServer,
    "next/headers": nextHeaders,
    "next/navigation": nextNavigation,
    "next/cache": nextCache,
    "server-only": {},
    "client-only": {},
  };
}

if (typeof module !== "undefined" && module.exports) module.exports = { createNoruServerRuntime: createNoruServerRuntime };
