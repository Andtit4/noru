// noru: browser version of `next/font/google`.
//
// `import { Inter, Geist_Mono } from "next/font/google"` gives a loader for any font name: it
// adds the Google Fonts stylesheet to the page and returns { className, style, variable } like
// Next.js does (Next.js downloads the fonts at build time; noru lets the browser load them).
"use strict";

var loaded = {};

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function addStylesheet(href, fallbackHref) {
  if (loaded[href]) return;
  loaded[href] = true;
  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  if (fallbackHref) {
    // A weight the font does not have makes Google Fonts answer 400: retry without weights.
    link.onerror = function () {
      link.href = fallbackHref;
      link.onerror = null;
    };
  }
  document.head.appendChild(link);
}

function addStyle(id, css) {
  if (document.getElementById(id)) return;
  var style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

function load(fontName, options) {
  options = options || {};
  var family = fontName.replace(/_/g, " ");
  var weights = toArray(options.weight).filter(function (w) {
    return w !== "variable";
  });
  var italic = toArray(options.style).indexOf("italic") !== -1;
  var axes;
  if (weights.length) {
    weights.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    axes = italic
      ? ":ital,wght@" +
        weights
          .map(function (w) {
            return "0," + w;
          })
          .concat(
            weights.map(function (w) {
              return "1," + w;
            }),
          )
          .join(";")
      : ":wght@" + weights.join(";");
  } else {
    // No weight: Next.js only allows that for variable fonts.
    axes = italic ? ":ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700" : ":wght@400;500;600;700";
  }
  var display = options.display || "swap";
  var familyParam = encodeURIComponent(family).replace(/%20/g, "+");
  var base = "https://fonts.googleapis.com/css2?family=" + familyParam;
  addStylesheet(base + axes + "&display=" + display, base + "&display=" + display);

  var fallback = (options.fallback && options.fallback.length ? options.fallback : ["sans-serif"]).join(", ");
  var fontFamily = "'" + family + "', " + fallback;
  var id = slug(family);
  var className = "__noru_font_" + id;
  var css = "." + className + "{font-family:" + fontFamily + ";" + (weights.length === 1 ? "font-weight:" + weights[0] + ";" : "") + "}";
  var variable;
  if (options.variable) {
    variable = "__noru_font_var_" + id + "_" + slug(options.variable);
    css += "." + variable + "{" + options.variable + ":" + fontFamily + "}";
  }
  addStyle("__noru_font_" + id + (variable ? "_" + slug(options.variable) : ""), css);

  var style = { fontFamily: fontFamily };
  if (weights.length === 1) style.fontWeight = Number(weights[0]);
  if (toArray(options.style).length === 1) style.fontStyle = toArray(options.style)[0];
  return { className: className, style: style, variable: variable };
}

module.exports = new Proxy(
  {},
  {
    get: function (target, name) {
      if (typeof name !== "string" || name === "__esModule" || name === "then" || name === "default" || name === "toJSON") {
        return undefined;
      }
      return function (options) {
        return load(name, options);
      };
    },
  },
);
