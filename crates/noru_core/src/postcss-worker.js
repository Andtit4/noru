// noru: PostCSS worker (Tailwind CSS, autoprefixer...). Started with `node -e <this file> <root> <config>`.
// Reads one JSON request per line on stdin ({ file, css }) and answers one line per request on
// stdout, prefixed with a marker so that anything plugins print cannot be mistaken for an answer.
"use strict";

const fs = require("fs");
const path = require("path");
const util = require("util");
const readline = require("readline");
const { createRequire } = require("module");
const { pathToFileURL } = require("url");

const root = process.argv[1];
const configPath = process.argv[2];
const MARKER = "\u0000noru-postcss:";
const requireFromRoot = createRequire(path.join(root, "package.json"));

const writeOut = process.stdout.write.bind(process.stdout);
console.log = console.info = console.debug = function () {
  process.stderr.write(util.format.apply(null, arguments) + "\n");
};

function send(message) {
  writeOut(MARKER + JSON.stringify(message) + "\n");
}

async function loadConfig() {
  let config;
  const name = path.basename(configPath);
  if (name === ".postcssrc" || name.endsWith(".json")) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } else {
    try {
      config = require(configPath);
    } catch (error) {
      const text = String(error && error.code) + " " + String(error && error.message);
      if (!/ERR_REQUIRE_ESM|ERR_REQUIRE_ASYNC_MODULE|Cannot use import statement|Unexpected token 'export'|import\.meta/.test(text)) {
        throw error;
      }
      config = await import(pathToFileURL(configPath).href);
    }
  }
  if (config && typeof config === "object" && "default" in config && !config.plugins) config = config.default;
  if (typeof config === "function") config = config({ env: process.env.NODE_ENV || "development", cwd: root });
  return config || {};
}

function loadPlugin(name, options) {
  let plugin = requireFromRoot(name);
  if (plugin && typeof plugin !== "function" && plugin.default) plugin = plugin.default;
  return typeof plugin === "function" ? plugin(options) : plugin;
}

function pluginNames(config) {
  const list = config.plugins || [];
  if (Array.isArray(list)) {
    return list.map((p) => (typeof p === "string" ? p : Array.isArray(p) ? p[0] : null)).filter(Boolean);
  }
  return Object.keys(list);
}

function loadPlugins(config) {
  const list = config.plugins || [];
  const plugins = [];
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry) continue;
      if (typeof entry === "string") plugins.push(loadPlugin(entry, {}));
      else if (Array.isArray(entry)) plugins.push(loadPlugin(entry[0], entry[1] || {}));
      else plugins.push(entry);
    }
  } else {
    for (const name of Object.keys(list)) {
      const options = list[name];
      if (options === false) continue;
      plugins.push(loadPlugin(name, options === true || options == null ? {} : options));
    }
  }
  return plugins;
}

// postcss itself: from the project, or from the plugins (Tailwind depends on it).
function loadPostcss(config) {
  const attempts = [() => requireFromRoot("postcss")];
  for (const name of pluginNames(config)) {
    attempts.push(() => createRequire(requireFromRoot.resolve(name))("postcss"));
  }
  attempts.push(() => requireFromRoot("next/dist/compiled/postcss"));
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {}
  }
  throw new Error("cannot find the `postcss` package: run `npm install -D postcss`");
}

let processor = null;
function getProcessor() {
  if (!processor) {
    processor = (async () => {
      const config = await loadConfig();
      const postcss = loadPostcss(config);
      return postcss(loadPlugins(config));
    })();
    processor.catch(() => {
      processor = null;
    });
  }
  return processor;
}

async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch (error) {
    send({ error: "invalid request" });
    return;
  }
  try {
    const result = await (await getProcessor()).process(request.css, { from: request.file, to: request.file, map: false });
    send({ css: result.css, warnings: result.warnings().map((w) => w.toString()) });
  } catch (error) {
    let message = error && error.message ? error.message : String(error);
    if (error && typeof error.showSourceCode === "function") {
      try {
        message += "\n" + error.showSourceCode(false);
      } catch (e) {}
    }
    send({ error: message });
  }
}

let queue = Promise.resolve();
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  queue = queue.then(() => handle(line));
});
input.on("close", () => {
  queue.then(() => process.exit(0));
});
