// Minimal headless-browser automation over the Chrome DevTools Protocol (Chrome or Edge).
// Node 22+ provides the global WebSocket used here.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p))
}

/** Kills a process and all its children (dev servers often spawn workers). */
export function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/** Starts a headless browser with a fresh profile and returns a small page-automation API. */
export async function launchBrowser(path = findBrowser()) {
  if (!path) throw new Error('no Chrome/Edge found — set BROWSER=/path/to/chrome')
  const profile = mkdtempSync(join(tmpdir(), 'noru-browser-'))
  const child = spawn(path, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ])
  let port
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100)
    try {
      // The browser may still be writing the file: EBUSY on Windows, or partial content.
      const first = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (/^\d+$/.test(first)) port = first
    } catch {}
  }
  if (!port) throw new Error('browser did not start')
  let page
  for (let i = 0; i < 50 && !page; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = targets.find((t) => t.type === 'page')
    } catch {}
    if (!page) await sleep(100)
  }
  if (!page) throw new Error('browser did not open a page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
  let nextId = 1
  const pending = new Map()
  // Uncaught exceptions and console.error() calls of the page, for test diagnostics.
  const pageErrors = []
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      pageErrors.push(d.exception?.description || d.text)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      pageErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  await send('Page.enable')
  await send('Runtime.enable')
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true })
    return res.result?.result?.value
  }
  return {
    navigate: (url) => send('Page.navigate', { url }),
    evaluate,
    /** Errors reported by the page since the last call. */
    takeErrors() {
      return pageErrors.splice(0)
    },
    /** Polls `expression` until it is truthy; returns false on timeout. */
    async waitFor(expression, timeout = 10000) {
      const start = Date.now()
      while (Date.now() - start < timeout) {
        if (await evaluate(expression).catch(() => false)) return true
        await sleep(20)
      }
      return false
    },
    close() {
      ws.close()
      killTree(child)
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {}
    },
  }
}
