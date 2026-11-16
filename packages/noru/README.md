# noru

**A fast, zero-config bundler for React + TypeScript apps — and Next.js App Router apps — written in Rust.**

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

> **Status: 1.1.** noru builds the standard Vite React + TypeScript template and Next.js App Router
> apps, and passes a suite of real-browser tests, but it is a young project: expect rough edges and
> read [what is not supported yet](#not-supported-yet).

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

**Next.js apps** — a generated App Router app with 50 pages and 3,000 client components using
Tailwind CSS v4 ([`scripts/gen-next.mjs`](scripts/gen-next.mjs), measured by
[`scripts/bench-next.mjs`](scripts/bench-next.mjs)):

|                                           | noru 0.2     | Next.js 16.4 (Turbopack) |
| ----------------------------------------- | ------------ | ------------------------ |
| Dev: command → first page displayed       | **6.6 s**    | 17.9 s                   |
| Dev: opening another page the first time  | **0.1 s**    | 1.1 – 3.6 s              |
| Dev: link click to a page never opened    | **0.06 s**   | 1.0 s                    |
| Dev: hot update                           | **0.15 s**   | 3.1 s                    |
| Production build                          | **5.3 s**    | 54 – 71 s                |
| JavaScript downloaded for a page (gzip)   | **80 kB** ²  | 141 kB                   |

² noru 1.1, with code splitting (229 kB with noru 0.2, which sent the whole app at once).

On a real Next.js 16 project (35 pages, Tailwind v4): first page in dev **2.9 s** vs 22 s, other
pages **0.2–0.3 s** vs 1.7–6.1 s, production build **1.4 s** vs 150 s.

Most of noru's time on these apps is Tailwind itself (the same app without Tailwind builds in
0.8 s). With the [production features](#production-builds) of noru 1.1 (code splitting,
pre-rendering, Brotli, service worker), the generated app builds in about 6–8 s. `next build` also
type-checks the code, which noru does not do.

**Tree-shaking** on a React app importing `lodash-es` and `lucide-react` (2,211 modules,
[`fixtures/treeshake`](fixtures/treeshake)):

|                     | noru, no tree-shaking | noru     | Vite 8.3 |
| ------------------- | --------------------- | -------- | -------- |
| Modules in bundle   | 2,211                 | 52       | —        |
| JS bundle           | 1,134 kB              | 231 kB   | 225 kB   |
| JS bundle (gzip)    | 258 kB                | 71.6 kB  | 70.3 kB  |

## Next.js apps

noru runs **Next.js App Router projects** (an `app/` directory). Pages are bundled up-front and run
in the browser, so opening a page never waits for a compilation; the **middleware** and the **route
handlers** (API routes) run in a Node.js process next to it. Replace the scripts, nothing else
changes:

```jsonc
"scripts": {
  "dev": "noru dev",      // instead of next dev
  "build": "noru build",  // instead of next build
  "start": "noru start"   // instead of next start
}
```

**Pages:** `app/` routing (layouts, nested layouts, route groups `(group)`, dynamic segments
`[id]`, catch-all `[...slug]` and `[[...slug]]`, `loading`, `error`, `global-error`, `not-found`,
`template`), `metadata` / `generateMetadata` (title, description), `next/link`, `next/navigation`
(`useRouter`, `usePathname`, `useSearchParams`, `useParams`, `useSelectedLayoutSegment(s)`,
`redirect`, `notFound`), `next/image`, `next/font/google`, `next/dynamic`, `next/script`,
`next/head`, `params` / `searchParams` (plain objects and promises), **async server components**
(they run in the browser), `NEXT_PUBLIC_*` variables, Tailwind CSS v3 / v4, `app/favicon.ico`, and
the browser versions of Node.js modules that Next.js provides (`buffer`, `https`, `url`...).
In `noru dev`, a broken import only breaks the page that uses it, like `next dev`.

**Server:** `middleware.ts` / `proxy.ts` (redirects, rewrites, responses, cookies and headers,
`config.matcher`; it also runs before client-side navigations, like Next.js) and route handlers
(`route.ts`: `GET` / `POST` / ... with `params`), with `next/server` (`NextRequest`,
`NextResponse`), `next/headers` (`cookies()`, `headers()`) and every `.env` variable (server side
only, `${VAR}` references are expanded). npm packages such as `next-auth` are loaded by Node.js from
`node_modules`. `noru build` writes this server code to `dist/server/` (never sent to browsers) and
`noru start` runs it, so the server needs the project's `node_modules` and `.env` files.

**Not supported yet:** server actions (`'use server'`), rendering pages on the server for each
request (static pages are [pre-rendered at build time](#production-builds), the others render in
the browser), ISR, `next/font/local`, parallel and intercepting routes,
the Pages Router (`pages/`), `next.config` options, ESM-only packages that import `next/*` in
server code. Async server components run in the browser: the APIs they call must be reachable from
the browser, and server-only secrets are not available to them.

## Production builds

`noru build` prepares the app for real users, including people on a slow or unreliable connection.
Everything is on by default; each feature has a flag to turn it off.

- **Code splitting.** Each page downloads only its own code: the JavaScript is split at `import()`
  points (one chunk per Next.js page, layout and `next/dynamic` component), code shared by several
  pages goes to shared chunks, and the chunks of the requested page start downloading together with
  the entry file (no waterfall). `--no-split` for a single file.
- **Precompressed files.** Every text file is written next to a Brotli (`.br`) and a gzip (`.gz`)
  version, compressed at a high level once at build time. `noru start` sends them as-is; most
  hosts and CDNs can too.
- **Pre-rendered pages (Next.js).** Static pages are rendered to HTML at build time
  (`dist/about/index.html`...), with their title, description and `<html>` / `<body>` attributes:
  the content shows up before the JavaScript has downloaded, and search engines see it. The app
  then takes over. Pages that cannot be rendered at build time (dynamic segments, `redirect()`,
  calls to relative URLs...) keep the empty app shell and are listed in the build output.
  `--no-prerender` to disable.
- **Offline and instant repeat visits.** A service worker (`sw.js`) keeps the app shell and the
  hashed files in the browser: later visits do not download them again, visited pages open without
  a network connection, and on a good connection the rest of the app is downloaded in the
  background. Data saver and 2G connections skip that. `--no-offline` to disable; a `public/sw.js`
  of your own is kept and nothing is generated.
- **Network-aware prefetching (Next.js).** `next/link` downloads pages before the click: links on
  screen on a good connection, only the hovered or touched link on 3G, nothing with the data saver
  or on 2G.
- **Optimized images (Next.js).** `import photo from "./photo.jpg"` gives `next/image` the width and
  height of the image (no layout shift). When `sharp` is installed (Next.js installs it), noru also
  generates a blurred preview (`placeholder="blur"`) and AVIF / WebP versions in several widths: the
  browser downloads the smallest file that fits the screen. Encoded images are cached in
  `node_modules/.noru-cache/`, so later builds are fast.
- **Self-hosted Google fonts (Next.js).** `next/font/google` fonts are downloaded at build time and
  served with the app, like Next.js: no request to Google, the main font files are preloaded.
  (In `noru dev`, the browser loads them from Google.)
- **Page weights and budget.** The build prints what each page downloads on a first visit
  (JavaScript + CSS, Brotli) and an estimate on slow 3G and 4G. `--budget 150` (or
  `"noru": { "budget": 150 }` in `package.json`) makes the build fail when a page needs more than
  150 kB; `--report` writes `noru-report.html`, which shows what the bundle is made of.

For static hosting, serve `dist/`: pages that have their own `index.html` are served as-is, and
other URLs should fall back to `shell.html` (the empty app shell, also used offline).

## noru play: games in your website

[`noru-play`](packages/noru-play) embeds web games in a website (Next.js, React or plain HTML): a
tiny SDK for the game (≈2 kB compressed) and a `<Playable>` component for the page, which handles
the loading screen, pauses the game when it cannot be seen, turns the sound on and off, and passes
saves and scores between the game and the site.

```tsx
// In the game
import { play } from 'noru-play'
play.gameReady()
play.onPause(() => game.pause())
await play.save({ best: 1200 })
await play.sendScore(1200)

// In a Next.js page
import { Playable } from 'noru-play/react'
<Playable src="/games/cloud-acres/" player={{ name: user.name, avatar: user.image }} onScore={(score) => saveScore(score)} />
```

Build a game with `noru build my-game --base /games/my-game/ --no-offline` and copy its `dist/` to
`public/games/my-game/` in the site (a `noru play build` command that does both is planned).
[`examples/play/cloud-acres`](examples/play/cloud-acres) is a complete farm game made this way
(no image files): fields planted and harvested with a swipe, animals, workshops, villagers' orders,
levels, a farmer to customize, the website user's picture, a shop (land, tractor, delivery truck,
sprinklers, silos, decorations), and a farm that keeps working while the game is closed.

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
  --no-split             One JavaScript file instead of one chunk per page
  --no-prerender         Do not render Next.js pages to HTML at build time
  --no-offline           Do not generate a service worker
  --budget <kB>          Fail when a page needs more than this many kB of JS + CSS (Brotli)
  --report               Write noru-report.html (page weights, what the bundle is made of)

noru start [root]      Serve the production build (Brotli / gzip, long-term caching, SPA fallback)
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
- **Tailwind CSS** and other PostCSS plugins, when the project has a `postcss.config.*` file (run by
  a long-lived Node.js process, so Tailwind regenerates the CSS in milliseconds after an edit)
- **Next.js App Router apps** (see [Next.js apps](#nextjs-apps))
- Assets (images, fonts, media): hashed file names, small files inlined as data URLs
- `import data from './data.json'`, `?raw`, `?url`, `?inline` imports, `import logo from '/logo.svg'` (public/)
- `import.meta.env.*`, `process.env.NODE_ENV` and dead-code removal of `if (import.meta.env.DEV) {...}`
- Dynamic `import()`: split into chunks loaded on demand in production builds
- Circular imports and live bindings
- **Tree-shaking**: unused modules, exports and top-level code are removed, `export *` barrels
  are resolved statically, `package.json` `"sideEffects"` is honored, `/* @__PURE__ */` annotations
  are respected, and the CSS / assets of removed modules are dropped too (`--no-treeshake` to disable)
- JS minification (Oxc)

## Not supported yet

- Vue, Svelte, Astro single-file components
- Sass / Less / Stylus
- Scope hoisting (each module stays wrapped in a function), source maps
- An `import.meta.hot` API for non-React code (non-component modules propagate the update to
  their importers, up to the closest React component)
- Plugins and a config file
- Rendering pages on the server for each request, and server actions (static Next.js pages are
  pre-rendered at build time; middleware and route handlers are supported, see
  [Next.js apps](#nextjs-apps))

## JavaScript API

```js
const { build, startDevServer, preview } = require('noru-bundler')

const result = await build({ root: './my-app', outDir: 'dist', budget: 150, report: true })
console.log(result.files, result.pages, `${result.durationMs} ms`)

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
node scripts/e2e-next.mjs                    # Next.js app: routing, server components, Tailwind, hot updates
node scripts/e2e-play.mjs                    # noru play: a game in <Playable> in a Next.js page
node scripts/gen-large.mjs && node scripts/bench-all.mjs   # benchmark vs other tools (install them in bench/large-app)
node scripts/gen-next.mjs && node scripts/bench-next.mjs   # benchmark vs Next.js on a Next.js app
cd packages/noru && npm run build && npm test  # native Node addon + npm package smoke test
```

## License

MIT. noru embeds the React Refresh runtime (`react-refresh`, MIT, © Meta Platforms, Inc. and
affiliates) in development bundles, see
[`crates/noru_core/src/vendor/LICENSE-react-refresh`](crates/noru_core/src/vendor/LICENSE-react-refresh).
