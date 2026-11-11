# noru

**A fast, zero-config bundler for React + TypeScript apps, written in Rust.**

```bash
npm install -D noru-bundler
```

The npm package is `noru-bundler` (npm does not allow the name `noru`); the command is `noru`:

```jsonc
// package.json
{
  "scripts": {
    "dev": "noru dev",       // dev server on http://localhost:3000
    "build": "noru build",   // production build into dist/
    "start": "noru start"    // serve dist/ (uses $PORT when set)
  }
}
```

Then `npm run dev`, `npm run build`, `npm start`.

> **Status: experimental (0.x).** noru builds the standard Vite React + TypeScript template and
> passes a suite of real-browser tests, but it is young: expect rough edges and read
> [what is not supported yet](#not-supported-yet).

## Why noru?

**No waiting when you open a page in dev.** Many dev servers compile each page (or each module)
the first time the browser asks for it. On big apps this means waiting seconds — sometimes tens of
seconds — every time you open a page. noru takes the opposite approach:

1. **The whole app is bundled up-front**, in parallel on every CPU core, in memory.
2. **Every processed module is cached.** When you save a file, only that file is processed again.
3. **Hot updates with React Fast Refresh**: edited components are swapped in the running page
   **without losing their state**; CSS is swapped live; new files and imports are picked up too.
   Only changes to the entry point or `index.html` reload the page.
4. **Pages load as one file**, instead of thousands of separate module requests.

### Benchmark

A generated React + TypeScript app with **5,000 components** (5,631 modules, 500 CSS modules,
[`scripts/gen-large.mjs`](scripts/gen-large.mjs)), every tool measured the same way by
[`scripts/bench-all.mjs`](scripts/bench-all.mjs): caches cleared, builds = median of 3 runs,
dev = from launching the command until the page is **actually displayed** in a real browser.

| Tool                       | Production build | JS (gzip) | Dev: command → page displayed | Reload    | Hot update          |
| -------------------------- | ---------------- | --------- | ----------------------------- | --------- | ------------------- |
| **noru 0.1**               | **1.1 s**        | 178 kB    | **1.3 s**                     | **0.2 s** | **0.2–0.5 s**, state kept |
| esbuild 0.28               | 1.2 s            | 333 kB    | — (no HMR dev server)         | —         | —                   |
| Vite 8.3 (Rolldown)        | 3.1 s            | **157 kB**| 24.6 s                        | 26.1 s    | 0.7 s, state kept   |
| Rsbuild 2.3 (Rspack)       | 3.2 s            | 158 kB    | 5.7 s                         | 0.3 s     | 0.6 s, state kept   |
| Parcel 2.16                | 14.0 s           | 176 kB    | 17.3 s                        | 0.2 s     | 0.9 s, state kept   |
| Next.js 16.4 (Turbopack)   | 23.0 s           | 271 kB¹   | 32.9 s                        | 0.3 s     | 1.7 s, page reloaded |
| webpack 5.112 + SWC        | 29.5 s           | 163 kB    | 13.9 s                        | 0.8 s     | 1.1 s, state kept   |

¹ Includes the Next.js router/runtime; `next build` also pre-renders the page on the server.

What "ready" hides: Vite prints *ready in 1.1 s*, but the browser then requests the 5,600 modules
one by one, so the page appears after ~25 s. Next.js compiles the page on the first visit (~33 s).
noru bundles everything up-front, in parallel, so the page is there in about a second.

Measured on a Windows 11 laptop with headless Edge; numbers vary between machines, the scripts are
in the repo to reproduce them. In this synthetic app every line of code is used, so noru's larger
bundle comes from wrapping each module in a function (Vite/Rolldown and Rspack hoist them into one
scope) — the next optimization on the roadmap.

**Tree-shaking** on a React app importing `lodash-es` and `lucide-react` (2,211 modules,
[`fixtures/treeshake`](fixtures/treeshake)):

|                     | noru, no tree-shaking | noru     | Vite 8.3 |
| ------------------- | --------------------- | -------- | -------- |
| Modules in bundle   | 2,211                 | 52       | —        |
| JS bundle           | 1,134 kB              | 231 kB   | 225 kB   |
| JS bundle (gzip)    | 258 kB                | 71.6 kB  | 70.3 kB  |

## Commands

```
noru dev [root]        Start the dev server
  --port, -p <port>      Port (default: 3000)
  --host <host>          Host (default: 127.0.0.1, use 0.0.0.0 to expose on the network)
  --base <path>          Public base path (default: /)
  --mode <mode>          import.meta.env.MODE (default: development)

noru build [root]      Build for production into dist/
  --out-dir <dir>        Output directory (default: dist)
  --base <path>          Public base path (default: /)
  --mode <mode>          import.meta.env.MODE (default: production)
  --no-minify            Disable minification
  --no-treeshake         Keep unused modules and exports

noru start [root]      Serve the production build (gzip, long-term caching, SPA fallback)
  --port, -p <port>      Port (default: $PORT or 3000)
  --host <host>          Host (default: 0.0.0.0)

noru preview [root]    Same as start, on localhost:4173
```

## Project layout

noru follows the Vite conventions, so most Vite React apps work as-is:

- `index.html` at the project root, with `<script type="module" src="/src/main.tsx"></script>`
- `public/` is copied as-is to `dist/` (and served at `/` in dev)
- `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`: variables prefixed with `VITE_` or
  `NORU_` are exposed as `import.meta.env.*`

## Supported

- TypeScript (`.ts`, `.tsx`, enums, parameter properties, `import type`...) and JSX (automatic runtime)
- npm packages: ESM, CommonJS and UMD, `package.json` `exports` / `browser` fields, `__esModule` interop
- `tsconfig.json` `paths` aliases
- CSS imports, `@import`, `url()` assets, **CSS Modules** (`*.module.css`), minification (Lightning CSS)
- Assets (images, fonts, media): hashed file names, small files inlined as data URLs
- `import data from './data.json'`, `?raw`, `?url`, `?inline` imports, `import logo from '/logo.svg'` (public/)
- `import.meta.env.*`, `process.env.NODE_ENV` and dead-code removal of `if (import.meta.env.DEV) {...}`
- Dynamic `import()` (bundled in the same file for now)
- Circular imports and live bindings
- **Tree-shaking**: unused modules, exports and top-level code are removed, `export *` barrels
  are resolved statically, `package.json` `"sideEffects"` is honored, `/* @__PURE__ */` annotations
  are respected, and the CSS / assets of removed modules are dropped too (`--no-treeshake` to disable)
- JS minification (Oxc)

## Not supported yet

- Vue, Svelte, Astro single-file components
- Sass / Less / Stylus
- Code splitting (dynamic imports are bundled in the main file), scope hoisting, source maps
- An `import.meta.hot` API for non-React code (non-component modules propagate the update to
  their importers, up to the closest React component)
- Plugins and a config file
- Server-side rendering (noru builds client-side apps, not Next.js apps)

## JavaScript API

```js
const { build, startDevServer, preview } = require('noru-bundler')

const result = await build({ root: './my-app', outDir: 'dist', minify: true })
console.log(result.files, `${result.durationMs} ms`)

const dev = startDevServer({ root: './my-app', port: 3000 })
console.log(dev.url)
dev.close()
```

TypeScript types are included.

## How it works

noru is written in Rust on top of [Oxc](https://oxc.rs) (parsing, TypeScript/JSX transform,
minification), [oxc_resolver](https://github.com/oxc-project/oxc-resolver) (module resolution) and
[Lightning CSS](https://lightningcss.dev). Each module is analyzed and rewritten into a small
module registry (like webpack's runtime); modules are processed in parallel with Rayon. The npm
package ships a native Node.js addon built with [napi-rs](https://napi.rs) for Windows, macOS and
Linux (x64 and arm64).

## Development

```bash
cargo build --release                        # build the Rust CLI (target/release/noru)
cargo test --workspace                       # unit tests
node scripts/e2e.mjs                         # build the fixtures and check them in a real browser
node scripts/e2e-dev.mjs                     # dev server: hot updates keep React state, CSS, overlay
node scripts/gen-large.mjs && node scripts/bench-all.mjs   # benchmark vs other tools (install them in bench/large-app)
cd packages/noru && npm run build && npm test  # native Node addon + npm package smoke test
```

## License

MIT. noru embeds the React Refresh runtime (`react-refresh`, MIT, © Meta Platforms, Inc. and
affiliates) in development bundles, see
[`crates/noru_core/src/vendor/LICENSE-react-refresh`](crates/noru_core/src/vendor/LICENSE-react-refresh).
