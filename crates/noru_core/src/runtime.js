var __noru_cache = {};
function __noru_require(id) {
  var cached = __noru_cache[id];
  if (cached !== undefined) return cached.exports;
  var factory = __noru_modules[id];
  if (typeof factory !== "function") {
    var error = new Error("Cannot find module '" + id + "'");
    error.code = "MODULE_NOT_FOUND";
    throw error;
  }
  var module = (__noru_cache[id] = { exports: {} });
  factory.call(module.exports, module, module.exports, __noru_require);
  return module.exports;
}
function __noru_esm(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
}
function __noru_export(exports, getters) {
  for (var name in getters) Object.defineProperty(exports, name, { enumerable: true, get: getters[name] });
}
function __noru_reexport(exports, mod) {
  if (mod == null) return;
  Object.keys(mod).forEach(function (name) {
    if (name !== "default" && !Object.prototype.hasOwnProperty.call(exports, name)) {
      Object.defineProperty(exports, name, { enumerable: true, get: function () { return mod[name]; } });
    }
  });
}
function __noru_toESM(mod) {
  if (mod && mod.__esModule) return mod;
  var isObject = mod !== null && (typeof mod === "object" || typeof mod === "function");
  var ns = isObject ? Object.create(mod) : {};
  Object.defineProperty(ns, "default", { enumerable: true, value: mod });
  return ns;
}
function __noru_import(id) {
  return Promise.resolve().then(function () { return __noru_toESM(__noru_require(id)); });
}
