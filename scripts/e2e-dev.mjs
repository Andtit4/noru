#!/usr/bin/env node
// End-to-end test of `noru dev` in a real browser (driven through the Chrome DevTools Protocol):
// hot updates keep React state, CSS is swapped live, errors show an overlay, entry/HTML changes reload.
//
// Usage: node scripts/e2e-dev.mjs [path/to/noru-binary]

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { findBrowser, killTree, launchBrowser, sleep } from './lib/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? '.exe' : ''
const noru = process.argv[2] || process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)

async function main() {
  const browserPath = findBrowser()
  if (!existsSync(noru) || !browserPath) {
    console.error(!browserPath ? 'no Chrome/Edge found' : `noru binary not found at ${noru}`)
    process.exit(1)
  }
  const fixture = join(root, 'fixtures', 'react-ts')
  if (!existsSync(join(fixture, 'node_modules'))) {
    spawnSync('npm install --no-audit --no-fund', { cwd: fixture, stdio: 'inherit', shell: true })
  }
  const project = mkdtempSync(join(tmpdir(), 'noru-dev-'))
  cpSync(fixture, project, { recursive: true, filter: (src) => !src.includes('dist') })
  const file = (rel) => join(project, ...rel.split('/'))
  const edit = (rel, change) => writeFileSync(file(rel), change(readFileSync(file(rel), 'utf8')))

  const port = 3500 + Math.floor(Math.random() * 400)
  const server = spawn(noru, ['dev', project, '--port', String(port)], { env: { ...process.env, NO_COLOR: '1' } })
  let logs = ''
  server.stdout.on('data', (d) => (logs += d))
  server.stderr.on('data', (d) => (logs += d))

  const failures = []
  const check = (name, condition, details = '') => {
    console.log(`${condition ? '✓' : '✗'} ${name}${condition || !details ? '' : `  (${details})`}`)
    if (!condition) failures.push(name)
  }
  const h1 = `document.querySelector('h1')?.textContent`
  const button = `document.querySelector('.card button')?.textContent`
  const noReload = `window.__noruMarker === 'kept'`

  let page
  try {
    for (let i = 0; i < 100 && !logs.includes('Local:'); i++) await sleep(100)
    check('dev server starts', logs.includes('dev server ready'), logs)
    const base = `http://127.0.0.1:${port}`

    const route = await fetch(`${base}/some/client/route`)
    check('SPA fallback', route.status === 200 && (await route.text()).includes('@noru/client.js'))
    check('public files served', (await fetch(`${base}/vite.svg`)).status === 200)

    page = await launchBrowser(browserPath)
    await page.navigate(`${base}/`)
    check('page renders', await page.waitFor(`${h1} === 'Vite + React' && ${button} === 'count is 0'`))

    // Give the component some state, and mark the page to detect reloads.
    await page.evaluate(`document.querySelector('.card button').click(); document.querySelector('.card button').click()`)
    check('state: counter clicked twice', await page.waitFor(`${button} === 'count is 2'`))
    await page.evaluate(`window.__noruMarker = 'kept'`)

    // 1. Edit a component: hot update, state kept.
    edit('src/App.tsx', (s) => s.replace('<h1>Vite + React</h1>', '<h1>Hello noru</h1>'))
    check('component edit is applied', await page.waitFor(`${h1} === 'Hello noru'`), logs.split('\n').slice(-3).join(' | '))
    check('  … without reloading the page', await page.evaluate(noReload))
    check('  … and the React state is kept', (await page.evaluate(button)) === 'count is 2', await page.evaluate(button))
    const hot = [...logs.matchAll(/rebuilt in (\d+) ms \((\d+)\/(\d+) modules\) → hot update/g)].pop()
    check('  … only the changed module was re-processed', hot && hot[2] === '1', hot?.[0])
    if (hot) console.log(`    rebuild + hot update: ${hot[1]} ms`)

    // 2. Edit CSS: styles swapped live.
    edit('src/App.css', (s) => s + '\n.read-the-docs { color: rgb(255, 0, 0); }\n')
    const color = `getComputedStyle(document.querySelector('.read-the-docs')).color === 'rgb(255, 0, 0)'`
    check('CSS edit is applied', await page.waitFor(color))
    check('  … without reloading the page', await page.evaluate(noReload))

    // 3. Add a new component file and import it: still a hot update.
    writeFileSync(file('src/Badge.tsx'), `export function Badge() {\n  return <span id="badge">new badge</span>\n}\n`)
    edit('src/App.tsx', (s) =>
      s.replace("import './App.css'", "import './App.css'\nimport { Badge } from './Badge'").replace('<h1>Hello noru</h1>', '<h1>Hello noru</h1>\n      <Badge />'),
    )
    check('new component file is picked up', await page.waitFor(`document.querySelector('#badge')?.textContent === 'new badge'`))
    check('  … without reloading the page', await page.evaluate(noReload))
    check('  … and the React state is kept', (await page.evaluate(button)) === 'count is 2')

    // 4. Edit the new component itself.
    edit('src/Badge.tsx', (s) => s.replace('new badge', 'edited badge'))
    check('editing a child component works', await page.waitFor(`document.querySelector('#badge')?.textContent === 'edited badge'`))
    check('  … state still kept', (await page.evaluate(button)) === 'count is 2' && (await page.evaluate(noReload)))

    // 5. Syntax error: overlay, then fixed with a hot update.
    const good = readFileSync(file('src/App.tsx'), 'utf8')
    writeFileSync(file('src/App.tsx'), good.replace('return (', 'return ((('))
    check('syntax error shows an overlay', await page.waitFor(`!!document.querySelector('[data-noru-overlay]')`))
    writeFileSync(file('src/App.tsx'), good.replace('<h1>Hello noru</h1>', '<h1>Fixed</h1>'))
    check('fixing it removes the overlay', await page.waitFor(`!document.querySelector('[data-noru-overlay]') && ${h1} === 'Fixed'`))
    check('  … and keeps the state', (await page.evaluate(button)) === 'count is 2' && (await page.evaluate(noReload)))

    // 6. The entry point is not a component: full reload.
    edit('src/main.tsx', (s) => s + '\nconsole.log("entry edited")\n')
    check('editing the entry point reloads the page', await page.waitFor(`window.__noruMarker === undefined && ${h1} === 'Fixed'`))

    // 7. index.html: full reload with the new HTML.
    await page.evaluate(`window.__noruMarker = 'kept'`)
    edit('index.html', (s) => s.replace('<title>Vite + React + TS</title>', '<title>noru hot</title>'))
    check('editing index.html reloads with the new HTML', await page.waitFor(`document.title === 'noru hot' && window.__noruMarker === undefined`))
  } finally {
    page?.close()
    killTree(server)
    await sleep(300)
    rmSync(project, { recursive: true, force: true })
  }

  if (failures.length) {
    console.log(`\n${failures.length} dev server check(s) failed\n--- server logs ---\n${logs}`)
    process.exit(1)
  }
  console.log('\nall dev server tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
