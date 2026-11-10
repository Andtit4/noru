#!/usr/bin/env node
'use strict'

const path = require('node:path')

const HELP = `
  noru — a fast bundler for React + TypeScript apps, written in Rust

  Usage
    $ noru dev [root]        Start the dev server (instant reloads, no per-page compilation)
    $ noru build [root]      Build for production into dist/
    $ noru start [root]      Serve the production build (uses $PORT when set)
    $ noru preview [root]    Same as start, on localhost:4173

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

  Start / preview options
    --out-dir <dir>          Directory to serve (default: dist)
    --port, -p <port>        Port (default: $PORT or 3000 for start, 4173 for preview)
    --host <host>            Host (default: 0.0.0.0 for start, 127.0.0.1 for preview)

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
  const names = result.files.map((f) => `${out}/${f.fileName}`)
  const width = Math.max(...names.map((n) => n.length))
  const sizeWidth = Math.max(...result.files.map((f) => kb(f.size).length))
  result.files.forEach((file, i) => {
    const name = names[i]
    const color = name.endsWith('.js') ? '36' : name.endsWith('.css') ? '35' : name.endsWith('.html') ? '32' : '2'
    console.log(
      `${c(color, name)}${' '.repeat(width - name.length)}  ${kb(file.size).padStart(sizeWidth)} │ gzip: ${kb(file.gzipSize).padStart(8)}`,
    )
  })
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
  } else {
    fail(`unknown command "${command}" — run \`noru --help\``)
  }
}

main()
