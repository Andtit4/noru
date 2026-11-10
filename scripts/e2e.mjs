#!/usr/bin/env node
// End-to-end tests: build every fixture with noru, serve the output, load it in a headless
// browser (Chrome or Edge) and check what actually rendered.
//
// Usage: node scripts/e2e.mjs [path/to/noru-binary]
// Env:   NORU_BIN (binary), BROWSER (path to chrome/edge)

import { spawnSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs'
import { join, extname, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? '.exe' : ''
const noru = process.argv[2] || process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)

function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return candidates.find((p) => existsSync(p))
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.txt': 'text/plain',
}

function serve(dir) {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let path = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
      if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html')
      if (!existsSync(path)) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' })
      res.end(readFileSync(path))
    })
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

function dumpDom(browser, url) {
  const profile = mkdtempSync(join(tmpdir(), 'noru-e2e-'))
  return new Promise((resolveDom, reject) => {
    const child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000',
      '--dump-dom',
      url,
    ])
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('browser timed out'))
    }, 60000)
    child.on('close', () => {
      clearTimeout(timer)
      resolveDom(out)
    })
  })
}

function readBundle(dist) {
  const assets = join(dist, 'assets')
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n')
}

const fixtures = [
  {
    name: 'react-ts',
    check(dom) {
      const errors = []
      if (!dom.includes('<h1>Vite + React</h1>')) errors.push('React did not render the <h1>')
      if (!dom.includes('count is 0')) errors.push('counter button missing')
      if (!/src="\/assets\/react-[0-9a-f]{8}\.svg"/.test(dom)) errors.push('hashed asset URL missing')
      return errors
    },
  },
  {
    name: 'features',
    check(dom, bundle) {
      const errors = []
      if (!dom.includes('<title>PASS</title>')) {
        const match = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/)
        errors.push(`self-checks failed: ${match ? match[1].trim() : 'no results (page crashed?)'}`)
      }
      if (bundle.includes('DEV_ONLY_MARKER')) errors.push('dead code (import.meta.env.DEV branch) was not removed')
      if (bundle.includes('do-not-leak')) errors.push('non-public env variable leaked into the bundle')
      return errors
    },
  },
  {
    name: 'treeshake',
    check(dom, bundle, css, variant) {
      const errors = []
      if (!dom.includes('<title>PASS</title>')) {
        const match = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/)
        errors.push(`self-checks failed: ${match ? match[1].trim() : 'no results (page crashed?)'}`)
      }
      if (variant.treeshake) {
        const left = [...new Set(bundle.match(/UNUSED_MARKER_[A-Z_]+/g) || [])]
        if (left.length) errors.push(`unused code left in the bundle: ${left.join(', ')}`)
        if (css.includes('unused-component-marker')) errors.push('CSS of an unused component was kept')
        // Without tree-shaking the bundle contains all of lodash-es and every lucide icon (> 1 MB).
        if (bundle.length > 400_000 && variant.minify) errors.push(`bundle too big: ${bundle.length} bytes`)
      }
      return errors
    },
  },
]

function readCss(dist) {
  const assets = join(dist, 'assets')
  return readdirSync(assets)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n')
}

const variants = [
  { label: '', args: [], minify: true, treeshake: true },
  { label: ' (no minify)', args: ['--no-minify'], minify: false, treeshake: true },
  { label: ' (no tree-shaking)', args: ['--no-treeshake'], minify: true, treeshake: false },
]

async function main() {
  if (!existsSync(noru)) {
    console.error(`noru binary not found at ${noru} — run \`cargo build --release\` first`)
    process.exit(1)
  }
  const browser = findBrowser()
  if (!browser) {
    console.error('no Chrome/Edge found — set BROWSER=/path/to/chrome')
    process.exit(1)
  }
  let failures = 0
  for (const variant of variants) {
    for (const fixture of fixtures) {
      const label = `${fixture.name}${variant.label}`
      const dir = join(root, 'fixtures', fixture.name)
      if (!existsSync(join(dir, 'node_modules'))) {
        spawnSync('npm install --no-audit --no-fund', { cwd: dir, stdio: 'inherit', shell: true })
      }
      const args = ['build', dir, ...variant.args]
      const build = spawnSync(noru, args, { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
      if (build.status !== 0) {
        console.log(`✗ ${label}: build failed\n${build.stdout}\n${build.stderr}`)
        failures++
        continue
      }
      const dist = join(dir, 'dist')
      const server = await serve(dist)
      const { port } = server.address()
      try {
        const dom = await dumpDom(browser, `http://127.0.0.1:${port}/`)
        const errors = fixture.check(dom, readBundle(dist), readCss(dist), variant)
        if (errors.length) {
          failures++
          console.log(`✗ ${label}\n  - ${errors.join('\n  - ')}`)
        } else {
          console.log(`✓ ${label}`)
        }
      } finally {
        server.close()
      }
    }
  }
  if (failures) {
    console.log(`\n${failures} fixture(s) failed`)
    process.exit(1)
  }
  console.log('\nall end-to-end tests passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
