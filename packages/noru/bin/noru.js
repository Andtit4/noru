#!/usr/bin/env node
'use strict'

const path = require('node:path')

const HELP = `
  noru — a fast bundler for React + TypeScript and Next.js App Router apps, written in Rust

  Usage
    $ noru dev [root]        Start the dev server (instant reloads, no per-page compilation)
    $ noru build [root]      Build for production into dist/
    $ noru start [root]      Serve the production build (uses $PORT when set)
    $ noru preview [root]    Same as start, on localhost:4173
    $ noru play-server       Multiplayer rooms server for noru-play games (uses $PORT when set)

  Dev options
    --port, -p <port>        Port (default: 3000)
    --host <host>            Host (default: 127.0.0.1, use 0.0.0.0 to expose on the network)
    --base <path>            Public base path (default: /)
    --mode <mode>            Mode, exposed as import.meta.env.MODE (default: development)

  Build options
    --out-dir <dir>          Output directory, relative to root (default: dist)
    --base <path>            Public base path (default: /)
    --mode <mode>            Mode, exposed as import.meta.env.MODE (default: production)
    --no-minify              Disable minification
    --no-treeshake           Keep unused modules and exports (disable tree-shaking)
    --no-split               One JavaScript file instead of one chunk per page
    --no-offline             Do not generate a service worker (offline mode)
    --no-prerender           Do not render Next.js pages to HTML at build time
    --budget <kB>            Fail when a page needs more than this many kB of JS + CSS (Brotli)
    --report                 Write noru-report.html: page weights, what the bundle is made of

  Start / preview options
    --out-dir <dir>          Directory to serve (default: dist)
    --port, -p <port>        Port (default: $PORT or 3000 for start, 4173 for preview)
    --host <host>            Host (default: 0.0.0.0 for start, 127.0.0.1 for preview)

  Play server options
    --port, -p <port>        Port (default: $PORT or 4040)
    --host <host>            Host (default: 0.0.0.0)
    --max-players <n>        Players per room (default: 16)
    --allow-origin <url>     Only this website may connect, e.g. https://example.com
                             (comma-separated list; default: any)

  Other
    -v, --version            Print version
    -h, --help               Print this help
`

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--no-minify') args.minify = false
    else if (arg === '--no-treeshake') args.treeshake = false
    else if (arg === '--no-split') args.split = false
    else if (arg === '--no-offline') args.offline = false
    else if (arg === '--no-prerender') args.prerender = false
    else if (arg === '--report') args.report = true
    else if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '-v' || arg === '--version') args.version = true
    else if (arg === '-p') {
      args.port = argv[++i]
      if (args.port === undefined) fail('missing value for -p')
    } else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=')
      const value = inline !== undefined ? inline : argv[++i]
      if (value === undefined) fail(`missing value for --${key}`)
      args[key.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value
    } else args._.push(arg)
  }
  return args
}

function fail(message) {
  console.error(`${c('31;1', 'x')} ${message}`)
  process.exit(1)
}

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`

function printResult(result) {
  for (const warning of result.warnings) console.log(`${c('33;1', 'warning:')} ${warning}`)
  const removed = result.removedModules > 0 ? ` (${result.removedModules} unused removed by tree-shaking)` : ''
  console.log(`${c('32', '✓')} ${result.moduleCount} modules transformed${removed}.`)
  const out = path.basename(result.outDir)
  // AVIF / WebP versions of images: one summary line instead of one line each.
  const isVariant = (f) => /-\d+w-[0-9a-f]{8}\.(avif|webp)$/.test(f.fileName)
  const variants = result.files.filter(isVariant)
  result = { ...result, files: result.files.filter((f) => !isVariant(f)) }
  const names = result.files.map((f) => `${out}/${f.fileName}`)
  const width = Math.max(...names.map((n) => n.length))
  const sizeWidth = Math.max(...result.files.map((f) => kb(f.size).length))
  result.files.forEach((file, i) => {
    const name = names[i]
    const color = name.endsWith('.js') ? '36' : name.endsWith('.css') ? '35' : name.endsWith('.html') ? '32' : '2'
    const brotli = file.brotliSize > 0 ? ` │ brotli: ${kb(file.brotliSize).padStart(8)}` : ''
    console.log(
      `${c(color, name)}${' '.repeat(width - name.length)}  ${kb(file.size).padStart(sizeWidth)} │ gzip: ${kb(file.gzipSize).padStart(8)}${brotli}`,
    )
  })
  if (variants.length) {
    const total = variants.reduce((sum, f) => sum + f.size, 0)
    console.log(c('2', `+ ${variants.length} responsive image versions (AVIF / WebP), ${kb(total)}`))
  }
  const pages = [...(result.pages || [])].sort((a, b) => b.bytes - a.bytes)
  if (pages.length > 1 || pages.some((p) => p.files.length > 2)) {
    const w = Math.max(4, ...pages.map((p) => p.route.length))
    console.log('\n' + c('2', `${'page'.padEnd(w)}  first visit (JS + CSS)   slow 3G      4G`))
    for (const p of pages.slice(0, 30)) {
      console.log(`${p.route.padEnd(w)}  ${kb(p.bytes).padStart(22)}   ${((p.slow3gMs / 1000).toFixed(1) + ' s').padStart(7)}   ${((p.fast4gMs / 1000).toFixed(1) + ' s').padStart(5)}`)
    }
    if (pages.length > 30) console.log(c('2', `... and ${pages.length - 30} more pages`))
  }
  if (result.report) console.log(`${c('32', '✓')} report written to ${result.report}`)
  console.log(`${c('32', '✓')} built in ${Math.round(result.durationMs)}ms`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pkg = require('../package.json')
  if (args.version) {
    console.log(`noru v${pkg.version}`)
    return
  }
  const [command = 'help', root = '.'] = args._
  if (args.help || command === 'help') {
    console.log(HELP)
    return
  }

  const noru = require('..')
  if (command === 'build') {
    const mode = args.mode || 'production'
    console.log(`${c('36;1', 'noru')} ${c('2', `v${pkg.version}`)} building for ${mode}...`)
    try {
      const result = await noru.build({
        root,
        outDir: args.outDir,
        base: args.base,
        mode,
        minify: args.minify,
        treeshake: args.treeshake,
        split: args.split,
        offline: args.offline,
        prerender: args.prerender,
        budget: args.budget !== undefined ? Number(args.budget) : undefined,
        report: args.report,
      })
      printResult(result)
    } catch (error) {
      console.error(`${c('31;1', 'x')} build failed\n\n${error.message}`)
      process.exit(1)
    }
  } else if (command === 'dev') {
    let server
    try {
      server = noru.startDevServer({
        root,
        port: args.port !== undefined ? Number(args.port) : undefined,
        host: args.host,
        base: args.base,
        mode: args.mode,
      })
    } catch (error) {
      fail(error.message)
    }
    // The server runs on native threads: keep the Node process alive until Ctrl+C.
    const keepAlive = setInterval(() => {}, 1 << 30)
    const stop = () => {
      clearInterval(keepAlive)
      server.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } else if (command === 'start' || command === 'preview') {
    const isStart = command === 'start'
    const port = args.port ?? (isStart ? process.env.PORT || 3000 : 4173)
    const host = args.host || (isStart ? '0.0.0.0' : '127.0.0.1')
    try {
      const server = await noru.preview({ root, outDir: args.outDir, port: Number(port), host })
      const shown = server.url.replace('0.0.0.0', 'localhost').replace('127.0.0.1', 'localhost')
      console.log(`\n  ${c('36;1', 'noru')} serving ${path.resolve(root, args.outDir || 'dist')}\n`)
      console.log(`  ${c('32', '➜')}  Local:   ${c('36', shown)}\n`)
    } catch (error) {
      fail(error.message)
    }
  } else if (command === 'play-server') {
    const port = Number(args.port ?? process.env.PORT ?? 4040)
    const host = args.host || '0.0.0.0'
    let server
    try {
      server = noru.startPlayServer({
        port,
        host,
        maxPlayers: args.maxPlayers !== undefined ? Number(args.maxPlayers) : undefined,
        allowedOrigins: args.allowOrigin ? String(args.allowOrigin).split(',').map((o) => o.trim()).filter(Boolean) : undefined,
      })
    } catch (error) {
      fail(error.message)
    }
    const shown = host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host
    console.log(`\n  ${c('36;1', 'noru play')} multiplayer rooms server\n`)
    console.log(`  ${c('32', '➜')}  Local:   ${c('36', `ws://${shown}:${server.port}/`)}\n`)
    const keepAlive = setInterval(() => {}, 1 << 30)
    const stop = () => {
      clearInterval(keepAlive)
      server.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } else {
    fail(`unknown command "${command}" — run \`noru --help\``)
  }
}

main()
