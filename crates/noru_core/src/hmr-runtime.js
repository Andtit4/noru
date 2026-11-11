// noru hot module replacement (dev only) + React Fast Refresh.
//
// When files change, the dev server sends the new factory functions of the changed modules.
// They replace the old ones, then the changed modules and their importers are executed again,
// up to the closest "refresh boundaries": modules whose exports are all React components.
// React Fast Refresh then re-renders those components while keeping their state.
// If a change reaches an entry point without crossing a boundary, the page reloads.
var __noru_refresh = (function () {
  var exports = {};
  var process = { env: { NODE_ENV: "development" } };
  __NORU_REACT_REFRESH_RUNTIME__
  return exports;
})();
__noru_refresh.injectIntoGlobalHook(window);

// Next.js route segment exports (metadata, config...) that may sit next to the page component.
var __noru_route_exports = {
  metadata: 1,
  generateMetadata: 1,
  viewport: 1,
  generateViewport: 1,
  generateStaticParams: 1,
  dynamic: 1,
  dynamicParams: 1,
  revalidate: 1,
  fetchCache: 1,
  runtime: 1,
  preferredRegion: 1,
  maxDuration: 1,
  experimental_ppr: 1,
};

function __noru_is_boundary(id) {
  var cached = __noru_cache[id];
  if (!cached) return false;
  var exports = cached.exports;
  if (exports == null || (typeof exports !== "object" && typeof exports !== "function")) return false;
  var names = Object.keys(exports).filter(function (name) {
    return !__noru_route_exports[name];
  });
  if (names.length === 0) return false;
  for (var i = 0; i < names.length; i++) {
    var value;
    try {
      value = exports[names[i]];
    } catch (error) {
      return false;
    }
    if (!__noru_refresh.isLikelyComponentType(value)) return false;
  }
  return true;
}

window.__noru_hmr = {
  // Passed to update scripts, which run outside of this module's scope.
  helpers: [__noru_esm, __noru_export, __noru_reexport, __noru_toESM, __noru_import, __noru_refresh],
  apply: function (factories, deps) {
    var changed = Object.keys(factories).map(Number);
    for (var i = 0; i < changed.length; i++) __noru_modules[changed[i]] = factories[changed[i]];
    for (var key in deps) __noru_deps[key] = deps[key];

    var parents = {};
    for (var parent in __noru_deps) {
      var list = __noru_deps[parent];
      for (var j = 0; j < list.length; j++) (parents[list[j]] = parents[list[j]] || []).push(Number(parent));
    }

    // Walk up from the changed modules to the closest refresh boundaries.
    var stale = new Set();
    var boundaries = new Set();
    var queue = changed.slice();
    while (queue.length) {
      var id = queue.pop();
      if (stale.has(id)) continue;
      stale.add(id);
      // Never executed (e.g. a lazy import not loaded yet): the new factory is enough.
      if (!__noru_cache[id]) continue;
      if (__noru_is_boundary(id)) {
        boundaries.add(id);
        continue;
      }
      var importers = (parents[id] || []).filter(function (p) {
        return __noru_cache[p];
      });
      if (importers.length === 0) {
        console.log("[noru] change reached an entry point, reloading");
        location.reload();
        return;
      }
      for (var k = 0; k < importers.length; k++) queue.push(importers[k]);
    }

    stale.forEach(function (id) {
      delete __noru_cache[id];
    });
    try {
      boundaries.forEach(function (id) {
        __noru_require(id);
      });
    } catch (error) {
      console.error("[noru] hot update failed, reloading", error);
      location.reload();
      return;
    }
    // A module that stopped exporting only components cannot be hot updated.
    var stillBoundaries = true;
    boundaries.forEach(function (id) {
      if (!__noru_is_boundary(id)) stillBoundaries = false;
    });
    if (!stillBoundaries) {
      location.reload();
      return;
    }
    __noru_refresh.performReactRefresh();
    console.debug("[noru] hot updated " + changed.length + " module(s)");
  },
};
