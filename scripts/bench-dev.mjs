#!/usr/bin/env node
// Measures how long a dev server takes to show a page in a real (headless) browser:
// from navigation start until `selector` matches at least `minCount` elements.
// Uses the Chrome DevTools Protocol (Node 22+ has a global WebSocket).
//
// Usage: node scripts/bench-dev.mjs <url> [selector=[data-index]] [minCount=50]

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const [url, selector = '[data-index]', minCount = '50'] = process.argv.slice(2)
if (!url) {
  console.error('usage: node scripts/bench-dev.mjs <url> [selector] [minCount]')
  process.exit(1)
}

const browserPath =
  process.env.BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'noru-bench-'))
  const browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ])
  try {
    let port
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100)
      const file = join(profile, 'DevToolsActivePort')
      if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0].trim()
    }
    if (!port) throw new Error('browser did not start')
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => ws.addEventListener('open', r, { once: true }))
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    })
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })
    await send('Page.enable')
    await send('Network.enable')
    await send('Network.setCacheDisabled', { cacheDisabled: !process.env.KEEP_CACHE })

    const measure = async (label) => {
      const start = performance.now()
      await send('Page.navigate', { url })
      for (;;) {
        const res = await send('Runtime.evaluate', {
          expression: `document.querySelectorAll(${JSON.stringify(selector)}).length`,
          returnByValue: true,
        })
        if ((res.result?.result?.value ?? 0) >= Number(minCount)) break
        if (performance.now() - start > 120000) throw new Error('page did not render within 2 minutes')
        await sleep(10)
      }
      const ms = Math.round(performance.now() - start)
      console.log(`${label}: page rendered in ${ms} ms`)
      return ms
    }
    await measure('first load (cold)')
    await measure('reload')
    await measure('reload')
    ws.close()
  } finally {
    browser.kill()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
