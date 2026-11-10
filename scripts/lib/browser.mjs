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
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100)
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = readFileSync(file, 'utf8').split('\n')[0].trim()
  }
  if (!port) throw new Error('browser did not start')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
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
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true })
    return res.result?.result?.value
  }
  return {
    navigate: (url) => send('Page.navigate', { url }),
    evaluate,
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
