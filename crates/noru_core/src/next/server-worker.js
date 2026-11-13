// noru: Node.js process that runs the server parts of a Next.js app for the Rust server
// (`noru dev` / `noru start`). Started as `node -e <server-runtime.js + this file> <root> <mode>`.
// One JSON message per line on stdin, one answer per line on stdout (prefixed with a marker, so
// that anything the app prints cannot be mistaken for an answer). Requests run concurrently.
"use strict";

(function () {
  const util = require("util");
  const readline = require("readline");
  const MARKER = "\u0000noru-server:";
  const writeOut = process.stdout.write.bind(process.stdout);
  // The app's console.log goes to the terminal (stderr), stdout is for answers.
  console.log = console.info = console.debug = function () {
    process.stderr.write(util.format.apply(null, arguments) + "\n");
  };

  const runtime = createNoruServerRuntime({ root: process.argv[1], mode: process.argv[2] || "development" });

  function send(message) {
    writeOut(MARKER + JSON.stringify(message) + "\n");
  }

  async function handle(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      return;
    }
    try {
      let result;
      if (message.type === "load") {
        runtime.load(message.code);
        result = { ok: true };
      } else if (message.type === "request") {
        result = await runtime.handle(message.request);
      } else if (message.type === "middleware") {
        result = await runtime.middlewareOnly(message.request);
      } else {
        throw new Error("unknown message " + message.type);
      }
      send({ id: message.id, result: result });
    } catch (error) {
      const text = error && error.stack ? error.stack : String(error);
      process.stderr.write("[noru server] " + text + "\n");
      send({ id: message.id, error: text });
    }
  }

  const input = readline.createInterface({ input: process.stdin });
  input.on("line", handle);
  input.on("close", function () {
    process.exit(0);
  });
})();
