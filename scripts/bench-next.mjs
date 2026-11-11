#!/usr/bin/env node
// Benchmark: `next` vs `noru` on a Next.js App Router project (default: bench/next-app, made by
// scripts/gen-next.mjs). Measures, in a real browser:
//   - dev: command -> first page displayed, opening other pages for the first time, hot update
//   - production build time, and the JavaScript downloaded to display a page
//
// Usage: node scripts/bench-next.mjs [projectDir=bench/next-app] [buildRuns=2]

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser, killTree, launchBrowser, sleep } from './lib/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = resolve(root, process.argv[2] || 'bench/next-app')
const buildRuns = Number(process.argv[3] || 2)
const exe = process.platform === 'win32' ? '.exe' : ''
const noruBin = process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)
const nextBin = join(project, 'node_modules', 'next', 'dist', 'bin', 'next')
const browserPath = findBrowser()

const pageMarker = (p) => `!!document.getElementById('marker-page-${p}')`
const otherPages = [10, 25, 40, 49]
const hmrPage = 5

const tools = {
  next: {
    label: `Next.js ${JSON.parse(readFileSync(join(project, 'node_modules', 'next', 'package.json'), 'utf8')).version} (Turbopack)`,
    dev: (port) => [process.execPath, [nextBin, 'dev', '--port', String(port)]],
    ready: /Ready in/,
    build: () => [process.execPath, [nextBin, 'build']],
    start: (port) => [process.execPath, [nextBin, 'start', '--port', String(port)]],
    clean: () => rmSync(join(project, '.next'), { recursive: true, force: true }),
  },
  noru: {
    label: 'noru 0.2',
    dev: (port) => [noruBin, ['dev', project, '--port', String(port)]],
    ready: /dev server ready/,
    build: () => [noruBin, ['build', project]],
    start: (port) => [noruBin, ['preview', project, '--port', String(port)]],
    clean: () => rmSync(join(project, 'dist'), { recursive: true, force: true }),
  },
}

const now = () => performance.now()
const seconds = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`)

function start([cmd, args]) {
  const child = spawn(cmd, args, { cwd: project, env: { ...process.env, NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1', PORT: '' } })
  const state = { child, logs: '' }
  child.stdout.on('data', (d) => (state.logs += d))
  child.stderr.on('data', (d) => (state.logs += d))
  return state
}

async function waitForLog(state, regex, timeout = 120000) {
  const t = now()
  while (now() - t < timeout) {
    if (regex.test(state.logs)) return true
    await sleep(20)
  }
  return false
}

function edit(file, from, to) {
  const path = join(project, file)
  writeFileSync(path, readFileSync(path, 'utf8').replace(from, to))
}

async function benchDev(name) {
  const tool = tools[name]
  tool.clean()
  const page = await launchBrowser(browserPath) // started before the server: not part of the timing
  const port = 5100 + Math.floor(Math.random() * 500)
  const result = { pages: {} }
  const t0 = now()
  const server = start(tool.dev(port))
  try {
    if (!(await waitForLog(server, tool.ready))) throw new Error(`${name} dev did not start:\n${server.logs}`)
    result.ready = now() - t0
    const base = `http://localhost:${port}`

    await page.navigate(`${base}/page-0`)
    if (!(await page.waitFor(pageMarker(0), 180000))) throw new Error(`${name}: page-0 not displayed`)
    result.firstPage = now() - t0

    for (const p of otherPages) {
      const t = now()
      await page.navigate(`${base}/page-${p}`)
      await page.waitFor(pageMarker(p), 180000)
      result.pages[p] = now() - t
    }

    // Client-side navigation (a <Link> click) to a page that was never opened.
    const t = now()
    await page.evaluate(`[...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href') === '/page-33').click()`)
    await page.waitFor(pageMarker(33), 180000)
    result.linkClick = now() - t

    // Hot update of a component displayed on the page.
    await page.navigate(`${base}/page-${hmrPage}`)
    await page.waitFor(pageMarker(hmrPage), 180000)
    await sleep(1500)
    const component = `components/Component${hmrPage * 60}.tsx`
    const hmr = []
    for (let k = 1; k <= 3; k++) {
      const before = k === 1 ? `Component ${hmrPage * 60}<` : `Component ${hmrPage * 60} v${k - 1}<`
      const after = `Component ${hmrPage * 60} v${k}<`
      const t = now()
      edit(component, before, after)
      const ok = await page.waitFor(`document.querySelector('[data-index="${hmrPage * 60}"] h3')?.textContent === 'Component ${hmrPage * 60} v${k}'`, 30000)
      hmr.push(ok ? now() - t : null)
      await sleep(3000) // a pause between two saves, like a person editing (lets background work finish)
    }
    edit(component, `Component ${hmrPage * 60} v3<`, `Component ${hmrPage * 60}<`)
    result.hmr = hmr.filter((v) => v != null).sort((a, b) => a - b)[1] ?? hmr[0]
  } finally {
    page.close()
    killTree(server.child)
    await sleep(1000)
  }
  return result
}

async function benchBuild(name) {
  const tool = tools[name]
  const times = []
  for (let r = 0; r < buildRuns; r++) {
    tool.clean()
    const [cmd, args] = tool.build()
    const t = now()
    const run = spawnSync(cmd, args, { cwd: project, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', NEXT_TELEMETRY_DISABLED: '1' } })
    if (run.status !== 0) throw new Error(`${name} build failed:\n${(run.stdout + run.stderr).slice(-2000)}`)
    times.push(now() - t)
  }
  times.sort((a, b) => a - b)

  // JavaScript downloaded to display /page-0 from the production server.
  const port = 5700 + Math.floor(Math.random() * 200)
  const server = start(tool.start(port))
  const page = await launchBrowser(browserPath)
  let js = null
  try {
    await waitForLog(server, /Local|Ready|localhost/, 60000)
    await sleep(500)
    await page.navigate(`http://localhost:${port}/page-0`)
    await page.waitFor(pageMarker(0), 60000)
    await sleep(1000)
    js = await page.evaluate(
      `performance.getEntriesByType('resource').filter((e) => e.name.split('?')[0].endsWith('.js')).reduce((sum, e) => sum + e.encodedBodySize, 0)`,
    )
  } finally {
    page.close()
    killTree(server.child)
    await sleep(500)
  }
  return { times, median: times[Math.floor(times.length / 2)], js }
}

async function main() {
  if (!existsSync(nextBin)) throw new Error(`Next.js is not installed in ${project} (run node scripts/gen-next.mjs)`)
  if (!existsSync(noruBin)) throw new Error(`noru binary not found: ${noruBin} (cargo build --release)`)
  // BENCH_TOOLS=noru re-measures only noru, BENCH_PARTS=dev only the dev server: the other
  // numbers are kept from the previous results file.
  const file = join(root, 'bench', 'results-next.json')
  const only = process.env.BENCH_TOOLS ? process.env.BENCH_TOOLS.split(',') : ['noru', 'next']
  const parts = process.env.BENCH_PARTS ? process.env.BENCH_PARTS.split(',') : ['dev', 'build']
  const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).results : {}
  for (const name of only) {
    const previous = results[name] || {}
    let dev = previous.dev
    let build = previous.build
    if (parts.includes('dev')) {
      console.log(`\n— ${tools[name].label}: dev server`)
      dev = await benchDev(name)
      console.log(`  ready ${seconds(dev.ready)} · first page displayed ${seconds(dev.firstPage)}`)
      console.log(`  other pages: ${otherPages.map((p) => `page-${p} ${seconds(dev.pages[p])}`).join(' · ')}`)
      console.log(`  link click to a new page ${seconds(dev.linkClick)} · hot update ${seconds(dev.hmr)}`)
    }
    if (parts.includes('build')) {
      console.log(`— ${tools[name].label}: production build (${buildRuns} runs)`)
      build = await benchBuild(name)
      console.log(`  build ${build.times.map(seconds).join(', ')} · JS for /page-0: ${(build.js / 1000).toFixed(0)} kB (compressed)`)
    }
    results[name] = { label: tools[name].label, dev, build }
  }
  tools.noru.clean()
  tools.next.clean()
  writeFileSync(file, JSON.stringify({ project: relative(root, project).replace(/\\/g, '/'), date: new Date().toISOString(), results }, null, 2))
  console.log(`\nresults written to ${file}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
