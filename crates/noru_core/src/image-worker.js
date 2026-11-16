// noru: image worker (production builds of Next.js apps), using the project's `sharp`.
// Started with `node -e <this file> <root> <cache dir>`. Reads one JSON request per line on stdin
// and answers one line per request on stdout, prefixed with a marker.
//   { type: "blur", file }                       -> { blur, width, height } (tiny PNG data URL)
//   { type: "variants", file, outputs: [...] }   -> { ok } at once; encodes in the background
//   { type: "finish" }                           -> { errors } once every variant is written
"use strict";

const fs = require("fs");
const path = require("path");
const util = require("util");
const readline = require("readline");
const { createRequire } = require("module");

const root = process.argv[1];
const cacheDir = process.argv[2];
const MARKER = "\u0000noru-image:";
const requireFromRoot = createRequire(path.join(root, "package.json"));

const writeOut = process.stdout.write.bind(process.stdout);
console.log = console.info = console.debug = function () {
  process.stderr.write(util.format.apply(null, arguments) + "\n");
};

function send(message) {
  writeOut(MARKER + JSON.stringify(message) + "\n");
}

function loadSharp() {
  try {
    return requireFromRoot("sharp");
  } catch (error) {
    // Next.js installs sharp as its own dependency.
    try {
      return createRequire(requireFromRoot.resolve("next/package.json"))("sharp");
    } catch (error2) {
      return null;
    }
  }
}

const sharp = loadSharp();
const pending = [];
const errors = [];

async function encode(file, output) {
  const target = path.join(cacheDir, output.name);
  if (fs.existsSync(target)) return; // cached by an earlier build
  let pipeline = sharp(file, { animated: false }).rotate().resize({ width: output.width, withoutEnlargement: true });
  pipeline = output.format === "avif" ? pipeline.avif({ quality: 50, effort: 4 }) : pipeline.webp({ quality: 75 });
  const temporary = target + "." + process.pid + ".tmp";
  await pipeline.toFile(temporary);
  fs.renameSync(temporary, target);
}

async function handle(request) {
  if (!sharp) return { error: "sharp is not installed" };
  if (request.type === "blur") {
    const { data, info } = await sharp(request.file, { animated: false })
      .rotate()
      .resize(8, 8, { fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { blur: "data:image/png;base64," + data.toString("base64"), width: info.width, height: info.height };
  }
  if (request.type === "variants") {
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const output of request.outputs) {
      pending.push(
        encode(request.file, output).catch(function (error) {
          errors.push(path.basename(request.file) + " (" + output.format + ", " + output.width + "px): " + (error && error.message));
        }),
      );
    }
    return { ok: true };
  }
  if (request.type === "finish") {
    await Promise.all(pending);
    pending.length = 0;
    return { errors: errors.splice(0) };
  }
  return { error: "unknown request" };
}

// Requests are answered in order (the Rust side waits for each answer).
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", function (line) {
  queue = queue.then(async function () {
    try {
      send(await handle(JSON.parse(line)));
    } catch (error) {
      send({ error: String((error && error.message) || error) });
    }
  });
});
