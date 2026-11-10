#!/usr/bin/env node
// Compares noru with other bundlers on the generated large app (run scripts/gen-large.mjs first,
// then install the tools in bench/large-app, see the README "Benchmark" section).
//
// For each tool, in the same conditions (caches cleared, fresh browser profile):
// - production build: wall time (median of N runs) and JS size (raw + gzip);
// - dev: time from launching the command until the page is displayed in a real browser,
//   page reload time, and hot update time (edit a component until the change is visible,
//   checking whether the page kept its state or reloaded).
//
// Usage: node scripts/bench-all.mjs [--tools noru,vite,rsbuild,webpack,parcel,esbuild,next]
//                                   [--runs 3] [--skip-build] [--skip-dev]

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { launchBrowser, killTree, sleep } from './lib/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'bench', 'large-app')
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const RUNS = Number(opt('runs', 3))
const SKIP_BUILD = argv.includes('--skip-build')
const SKIP_DEV = argv.includes('--skip-dev')
const exe = process.platform === 'win32' ? '.exe' : ''
const noruBin = process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)
const node = process.execPath
const nm = (p) => join(app, 'node_modules', p)
const version = (pkg) => {
  try {
    return JSON.parse(readFileSync(nm(`${pkg}/package.json`), 'utf8')).version
  } catch {
    return '?'
  }
}
const write = (rel, content) => {
  mkdirSync(dirname(join(app, rel)), { recursive: true })
  writeFileSync(join(app, rel), content)
}
const remove = (rel) => rmSync(join(app, rel), { recursive: true, force: true })
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

// ---- tool configurations -------------------------------------------------------------------

function writeConfigs() {
  // HTML template without the entry script (for tools that inject it themselves).
  write(
    'bench-template.html',
    '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <title>bench</title>\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n',
  )
  write(
    'vite.config.js',
    `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
`,
  )
  write(
    'rsbuild.config.mjs',
    `import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './src/main.tsx' } },
  html: { template: './bench-template.html' },
  output: { distPath: { root: 'dist-rsbuild' } },
})
`,
  )
  write(
    'webpack.config.cjs',
    `const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const ReactRefreshPlugin = require('@pmmmwh/react-refresh-webpack-plugin')

module.exports = (env, argv) => {
  const dev = argv.mode !== 'production'
  return {
    mode: dev ? 'development' : 'production',
    entry: './src/main.tsx',
    output: { path: path.resolve(__dirname, 'dist-webpack'), filename: '[name].[contenthash].js', clean: true },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'] },
    module: {
      rules: [
        {
          test: /\\.[jt]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                target: 'es2020',
                parser: { syntax: 'typescript', tsx: true },
                transform: { react: { runtime: 'automatic', development: dev, refresh: dev } },
              },
            },
          },
        },
        {
          test: /\\.css$/,
          use: [
            dev ? 'style-loader' : MiniCssExtractPlugin.loader,
            { loader: 'css-loader', options: { modules: { auto: true, namedExport: false, exportLocalsConvention: 'as-is' } } },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './bench-template.html' }),
      !dev && new MiniCssExtractPlugin({ filename: '[name].[contenthash].css' }),
      dev && new ReactRefreshPlugin({ overlay: false }),
    ].filter(Boolean),
    devServer: { hot: true, historyApiFallback: true, client: { overlay: false } },
    infrastructureLogging: { level: 'warn' },
  }
}
`,
  )
  write(
    'esbuild.bench.mjs',
    `import { build } from 'esbuild'
await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  minify: true,
  format: 'esm',
  outdir: 'dist-esbuild',
  jsx: 'automatic',
  loader: { '.svg': 'file' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})
`,
  )
}

const hadTsconfig = existsSync(join(app, 'tsconfig.json'))
function setupNext() {
  write('next.config.mjs', 'export default { typescript: { ignoreBuildErrors: true } }\n')
  write(
    'app/layout.tsx',
    `export default function RootLayout({ children }: any) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
  )
  write(
    'app/page.tsx',
    `'use client'
import App from '../src/App'

export default function Page() {
  return <App />
}
`,
  )
}
function cleanupNext() {
  for (const p of ['app', 'next.config.mjs', 'next-env.d.ts', '.next']) remove(p)
  if (!hadTsconfig) remove('tsconfig.json')
}

const tools = [
  {
    id: 'noru',
    label: 'noru',
    version: '0.1.0',
    lang: 'Rust',
    build: { cmd: noruBin, args: ['build', app, '--out-dir', 'dist-noru'], out: 'dist-noru', clean: ['dist-noru'] },
    dev: { cmd: noruBin, args: (port) => ['dev', app, '--port', port], ready: /dev server ready/ },
  },
  {
    id: 'vite',
    label: 'Vite',
    version: version('vite'),
    lang: 'Rust (Rolldown) + JS',
    build: {
      args: [nm('vite/bin/vite.js'), 'build', '--outDir', 'dist-vite', '--logLevel', 'warn'],
      out: 'dist-vite',
      clean: ['dist-vite', 'node_modules/.vite'],
    },
    dev: { args: (port) => [nm('vite/bin/vite.js'), '--port', port, '--strictPort'], ready: /ready in/, clean: ['node_modules/.vite'] },
  },
  {
    id: 'rsbuild',
    label: 'Rsbuild (Rspack)',
    version: version('@rsbuild/core'),
    lang: 'Rust + JS',
    build: { args: [nm('@rsbuild/core/bin/rsbuild.js'), 'build'], out: 'dist-rsbuild', clean: ['dist-rsbuild', 'node_modules/.cache'] },
    dev: { args: (port) => [nm('@rsbuild/core/bin/rsbuild.js'), 'dev', '--port', port], ready: /Local:|ready/ },
  },
  {
    id: 'webpack',
    label: 'webpack + SWC',
    version: version('webpack'),
    lang: 'JS (+ SWC en Rust)',
    build: {
      args: [nm('webpack-cli/bin/cli.js'), '--mode', 'production', '--config', 'webpack.config.cjs'],
      out: 'dist-webpack',
      clean: ['dist-webpack', 'node_modules/.cache'],
    },
    dev: {
      args: (port) => [nm('webpack-cli/bin/cli.js'), 'serve', '--mode', 'development', '--config', 'webpack.config.cjs', '--port', port],
      ready: /compiled successfully|compiled with|Project is running/,
    },
  },
  {
    id: 'parcel',
    label: 'Parcel',
    version: version('parcel'),
    lang: 'Rust + JS',
    build: {
      args: [nm('parcel/lib/bin.js'), 'build', 'index.html', '--dist-dir', 'dist-parcel', '--no-cache', '--no-source-maps'],
      out: 'dist-parcel',
      clean: ['dist-parcel', '.parcel-cache'],
    },
    dev: {
      args: (port) => [nm('parcel/lib/bin.js'), 'serve', 'index.html', '--port', port, '--no-cache', '--dist-dir', 'dist-parcel-dev'],
      ready: /Server running|Built in/,
      clean: ['.parcel-cache', 'dist-parcel-dev'],
    },
  },
  {
    id: 'esbuild',
    label: 'esbuild',
    version: version('esbuild'),
    lang: 'Go',
    build: { args: ['esbuild.bench.mjs'], out: 'dist-esbuild', clean: ['dist-esbuild'] },
    dev: null,
  },
  {
    id: 'next',
    label: 'Next.js (Turbopack)',
    version: version('next'),
    lang: 'Rust (Turbopack) + JS',
    setup: setupNext,
    cleanup: cleanupNext,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
    build: { args: [nm('next/dist/bin/next'), 'build', '--turbopack'], out: '.next/static', clean: ['.next'] },
    dev: { args: (port) => [nm('next/dist/bin/next'), 'dev', '--turbopack', '--port', port], ready: /Ready in/, clean: ['.next'] },
  },
]

// ---- measurements ----------------------------------------------------------------------------

function jsSize(dir) {
  let raw = 0
  let gzip = 0
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.js')) {
        const bytes = readFileSync(p)
        raw += bytes.length
        gzip += gzipSync(bytes).length
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return { raw, gzip }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function benchBuild(tool) {
  const times = []
  for (let run = 0; run < RUNS; run++) {
    for (const p of tool.build.clean) remove(p)
    const cmd = tool.build.cmd || node
    const start = performance.now()
    const res = spawnSync(cmd, tool.build.args, {
      cwd: app,
      env: { ...process.env, ...tool.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' },
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    const ms = performance.now() - start
    if (res.status !== 0) {
      return { error: stripAnsi(`${res.stdout}\n${res.stderr}`).trim().split('\n').slice(-15).join('\n') }
    }
    times.push(ms)
    process.stdout.write(`    build run ${run + 1}: ${(ms / 1000).toFixed(2)} s\n`)
  }
  return { ms: median(times), size: jsSize(join(app, tool.build.out)) }
}

const COMPONENT = join(app, 'src', 'components', 'Component3.tsx')
const rendered = `document.querySelectorAll('[data-index]').length >= 50`

async function benchDev(tool, port) {
  for (const p of tool.dev.clean || []) remove(p)
  const cmd = tool.dev.cmd || node
  const original = readFileSync(COMPONENT, 'utf8')
  // The browser is started first: its own startup time must not count.
  const page = await launchBrowser()
  const start = performance.now()
  const child = spawn(cmd, tool.dev.args(String(port)), {
    cwd: app,
    env: { ...process.env, ...tool.env, NO_COLOR: '1', FORCE_COLOR: '0', BROWSER: 'none', PORT: String(port) },
    detached: process.platform !== 'win32',
  })
  let logs = ''
  child.stdout.on('data', (d) => (logs += d))
  child.stderr.on('data', (d) => (logs += d))
  const result = {}
  try {
    while (!tool.dev.ready.test(stripAnsi(logs))) {
      if (performance.now() - start > 300000 || child.exitCode !== null) {
        throw new Error(`server did not start:\n${stripAnsi(logs).split('\n').slice(-15).join('\n')}`)
      }
      await sleep(20)
    }
    result.readyMs = performance.now() - start
    await page.navigate(`http://localhost:${port}/`)
    if (!(await page.waitFor(rendered, 300000))) throw new Error('page never rendered')
    result.firstPageMs = performance.now() - start

    const reloadStart = performance.now()
    await page.navigate(`http://localhost:${port}/`)
    await sleep(50)
    if (await page.waitFor(rendered, 300000)) result.reloadMs = performance.now() - reloadStart

    // Hot update: edit a visible component, wait until the change shows up.
    await sleep(1500)
    await page.evaluate(`window.__benchMarker = 'kept'`)
    const hmr = []
    let kept = true
    for (const n of [1, 2, 3]) {
      const editStart = performance.now()
      writeFileSync(COMPONENT, original.replace(/title = 'Component 3'/, `title = 'Component 3 v${n}'`))
      const ok = await page.waitFor(`document.querySelector('[data-index="3"] h3')?.textContent === 'Component 3 v${n}'`, 60000)
      if (!ok) break
      hmr.push(performance.now() - editStart)
      kept = kept && (await page.evaluate(`window.__benchMarker === 'kept'`))
      await sleep(800)
    }
    if (hmr.length) {
      result.hmrMs = median(hmr)
      result.hmrKeepsState = kept
    }
  } catch (error) {
    result.error = error.message
  } finally {
    writeFileSync(COMPONENT, original)
    page.close()
    killTree(child)
    await sleep(1000)
  }
  return result
}

// ---- main ----------------------------------------------------------------------------------

const fmtS = (ms) => (ms === undefined ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)
const fmtKb = (bytes) => (bytes ? `${(bytes / 1000).toFixed(0)} kB` : '—')

async function main() {
  if (!existsSync(join(app, 'src', 'App.tsx'))) {
    console.error('run `node scripts/gen-large.mjs` first')
    process.exit(1)
  }
  const selected = opt('tools', tools.map((t) => t.id).join(',')).split(',')
  writeConfigs()
  const results = []
  let port = 4100
  for (const tool of tools.filter((t) => selected.includes(t.id))) {
    console.log(`\n== ${tool.label} ${tool.version}`)
    tool.setup?.()
    const entry = { id: tool.id, label: tool.label, version: tool.version, lang: tool.lang }
    try {
      if (!SKIP_BUILD) {
        entry.build = benchBuild(tool)
        console.log(entry.build.error ? `  build FAILED:\n${entry.build.error}` : `  build: ${fmtS(entry.build.ms)}, JS ${fmtKb(entry.build.size.raw)} (gzip ${fmtKb(entry.build.size.gzip)})`)
      }
      if (!SKIP_DEV && tool.dev) {
        entry.dev = await benchDev(tool, port++)
        const d = entry.dev
        console.log(
          d.error
            ? `  dev FAILED: ${d.error}`
            : `  dev: server ready ${fmtS(d.readyMs)}, page displayed ${fmtS(d.firstPageMs)}, reload ${fmtS(d.reloadMs)}, hot update ${fmtS(d.hmrMs)} (${d.hmrKeepsState ? 'state kept' : 'page reloaded'})`,
        )
      }
    } finally {
      tool.cleanup?.()
    }
    results.push(entry)
  }

  writeFileSync(join(root, 'bench', 'results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2))
  console.log('\n| Tool | Build | JS (gzip) | Dev: page displayed | Reload | Hot update |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const b = r.build && !r.build.error ? r.build : null
    const d = r.dev && !r.dev.error ? r.dev : null
    const hot = d?.hmrMs !== undefined ? `${fmtS(d.hmrMs)}${d.hmrKeepsState ? '' : ' (reload)'}` : '—'
    console.log(
      `| ${r.label} ${r.version} | ${b ? fmtS(b.ms) : r.build ? 'failed' : '—'} | ${b ? fmtKb(b.size.gzip) : '—'} | ${d ? fmtS(d.firstPageMs) : r.dev ? 'failed' : 'n/a'} | ${d ? fmtS(d.reloadMs) : '—'} | ${hot} |`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
