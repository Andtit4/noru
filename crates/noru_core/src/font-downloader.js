// noru: downloads Google Fonts for self-hosting (production builds of Next.js apps).
// Started with `node -e <this file> <cache dir>`; reads the requests (JSON) on stdin:
//   [{ url, fallback, subsets: ["latin"], preload: true }]
// and prints { fonts: [{ url, fallback, css, files, preload }] } where the CSS points to
// `__NORU_FONT__/<file>` (files saved in the cache dir), or { error }.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const cacheDir = process.argv[1];
// A recent browser user agent: Google Fonts then answers with WOFF2 files.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const hash = (text) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

async function download(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // A blocked network must not hang the build: 10 s per attempt at most.
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10000) });
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw new Error("cannot reach " + new URL(url).host + " (" + ((lastError && lastError.cause && lastError.cause.code) || lastError) + ")");
}

async function stylesheet(request) {
  const cached = path.join(cacheDir, "css-" + hash(request.url) + ".css");
  if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf8");
  let response = await download(request.url);
  // A weight the font does not have: Google Fonts answers 400, retry without weights.
  if (!response.ok && request.fallback) response = await download(request.fallback);
  if (!response.ok) throw new Error(request.url + " answered " + response.status);
  const css = await response.text();
  fs.writeFileSync(cached, css);
  return css;
}

async function fontFile(url) {
  const name = hash(url) + ".woff2";
  const file = path.join(cacheDir, name);
  if (!fs.existsSync(file)) {
    const response = await download(url);
    if (!response.ok) throw new Error(url + " answered " + response.status);
    const temporary = file + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(temporary, file);
  }
  return name;
}

async function selfHost(request) {
  const css = await stylesheet(request);
  // Google lists one @font-face per subset, each after a /* subset */ comment.
  const blocks = [];
  const pattern = /(?:\/\*\s*([\w-]+)\s*\*\/\s*)?(@font-face\s*\{[^}]*\})/g;
  let match;
  while ((match = pattern.exec(css))) blocks.push({ subset: match[1] || null, rule: match[2] });
  const wanted = request.subsets && request.subsets.length ? request.subsets : null;
  const kept = blocks.filter((block) => !wanted || !block.subset || wanted.includes(block.subset));
  const preloadSubset = wanted ? wanted[0] : "latin";
  const files = [];
  const preload = [];
  let out = "";
  for (const block of kept) {
    let rule = block.rule;
    const urls = [...rule.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ""));
    for (const url of urls) {
      const name = await fontFile(url);
      rule = rule.split(url).join("__NORU_FONT__/" + name);
      if (!files.includes(name)) files.push(name);
      if (request.preload && (block.subset === preloadSubset || !block.subset) && !preload.includes(name)) preload.push(name);
    }
    out += (block.subset ? "/* " + block.subset + " */\n" : "") + rule + "\n";
  }
  return { url: request.url, fallback: request.fallback, css: out, files, preload };
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const requests = JSON.parse(input);
  fs.mkdirSync(cacheDir, { recursive: true });
  const fonts = await Promise.all(requests.map(selfHost));
  process.stdout.write(JSON.stringify({ fonts }));
}

main().catch(function (error) {
  process.stdout.write(JSON.stringify({ error: String((error && error.message) || error) }));
});
