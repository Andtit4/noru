#!/usr/bin/env node
// End-to-end test of noru play in a real browser: a game (fixtures/play/game, then the Cloud Acres
// example) embedded with <Playable> in a Next.js app (a copy of fixtures/next-app) run by noru dev.
//
// Usage: node scripts/e2e-play.mjs [path/to/noru-binary]

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { killTree, launchBrowser, sleep } from './lib/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? '.exe' : ''
const noru = process.argv[2] || process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)
const nextFixture = join(root, 'fixtures', 'next-app')

const failures = []
const check = (name, condition, details = '') => {
  console.log(`${condition ? '✓' : '✗'} ${name}${condition || !details ? '' : `  (${details})`}`)
  if (!condition) failures.push(name)
}

function buildGame(dir, out, base) {
  const result = spawnSync(noru, ['build', dir, '--out-dir', out, '--base', base, '--no-offline'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  check(`noru build ${dir.split(/[\\/]/).slice(-2).join('/')}`, result.status === 0, (result.stdout + result.stderr).slice(-600))
}

const PLAY_PAGE = `'use client'
import { useState } from 'react'
import { Playable } from '../../lib/noru-play/react.js'

declare global {
  interface Window { __play: string[] }
}

export default function PlayPage() {
  const [paused, setPaused] = useState(false)
  const [muted, setMuted] = useState(false)
  const log = (event: string) => {
    window.__play = [...(window.__play || []), event]
  }
  return (
    <section>
      <h1 id="title">Play</h1>
      <button id="host-pause" onClick={() => setPaused((p) => !p)}>pause</button>
      <button id="host-mute" onClick={() => setMuted((m) => !m)}>mute</button>
      <Playable
        src="/games/test/"
        title="Test game"
        language="fr"
        player={{ name: 'Ama', avatar: '/logo.svg' }}
        paused={paused}
        muted={muted}
        autoPause={false}
        aspectRatio="4 / 3"
        onFirstFrame={() => log('firstFrame')}
        onReady={() => log('ready')}
        onScore={(score) => log('score:' + score)}
        onError={(error) => log('error:' + error.message)}
      />
    </section>
  )
}
`

const FARM_PAGE = `'use client'
import { Playable } from '../../lib/noru-play/react.js'

export default function FarmPage() {
  return (
    <section>
      <h1 id="title">Cloud Acres</h1>
      <Playable
        src="/games/cloud-acres/"
        title="Cloud Acres"
        player={{ name: 'Ama', avatar: '/logo.svg' }}
        aspectRatio="16 / 9"
        style={{ maxWidth: 800 }}
        onReady={() => { (window as any).__farmReady = true }}
        onError={(error) => { (window as any).__farmError = error.message }}
        onPause={() => { (window as any).__farmPaused = true }}
        onResume={() => { (window as any).__farmPaused = false }}
      />
      <div style={{ height: 3000 }} />
    </section>
  )
}
`

async function main() {
  if (!existsSync(join(nextFixture, 'node_modules'))) {
    spawnSync('npm install --no-audit --no-fund', { cwd: nextFixture, stdio: 'inherit', shell: true })
  }
  const project = mkdtempSync(join(tmpdir(), 'noru-play-'))
  cpSync(nextFixture, project, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)$/.test(src) })
  spawnSync(process.platform === 'win32' ? 'cmd' : 'ln', process.platform === 'win32' ? ['/c', 'mklink', '/J', join(project, 'node_modules'), join(nextFixture, 'node_modules')] : ['-s', join(nextFixture, 'node_modules'), join(project, 'node_modules')])
  // The site uses the package's files directly (as if installed from npm).
  cpSync(join(root, 'packages', 'noru-play'), join(project, 'lib', 'noru-play'), { recursive: true, filter: (src) => !/[\\/](test|node_modules)$/.test(src) })
  mkdirSync(join(project, 'app', 'play'), { recursive: true })
  writeFileSync(join(project, 'app', 'play', 'page.tsx'), PLAY_PAGE)
  mkdirSync(join(project, 'app', 'farm'), { recursive: true })
  writeFileSync(join(project, 'app', 'farm', 'page.tsx'), FARM_PAGE)
  buildGame(join(root, 'fixtures', 'play', 'game'), join(project, 'public', 'games', 'test'), '/games/test/')
  buildGame(join(root, 'examples', 'play', 'cloud-acres'), join(project, 'public', 'games', 'cloud-acres'), '/games/cloud-acres/')

  const port = 4100 + Math.floor(Math.random() * 300)
  const dev = spawn(noru, ['dev', project, '--port', String(port)], { env: { ...process.env, NO_COLOR: '1' } })
  let logs = ''
  dev.stdout.on('data', (d) => (logs += d))
  dev.stderr.on('data', (d) => (logs += d))
  const page = await launchBrowser()
  try {
    for (let i = 0; i < 200 && !logs.includes('Local'); i++) await sleep(50)
    const base = `http://127.0.0.1:${port}`

    console.log('\n— game on its own (standalone)')
    await page.navigate(`${base}/games/test/`)
    check('standalone mode outside a host', await page.waitFor(`document.getElementById('mode')?.textContent === 'standalone'`))
    check('standalone saves go to localStorage', (await page.evaluate(`game.saveLoad(7).then((v) => { window.__v = v; return true })`)) !== undefined && (await page.waitFor(`window.__v && window.__v.value === 7`)))

    console.log('\n— game in a Next.js page with <Playable>')
    await page.navigate(`${base}/play`)
    const frame = `document.querySelector('iframe[title="Test game"]')`
    const game = `${frame}?.contentWindow?.game`
    const events = `(window.__play || [])`
    check('loading screen until the first frame, then removed', await page.waitFor(`${events}.includes('firstFrame') && !document.querySelector('[role=status]')`))
    check('gameReady reaches the host', await page.waitFor(`${events}.includes('ready')`))
    check('the game knows it is in a host', await page.waitFor(`${frame}.contentDocument.getElementById('mode').textContent === 'host'`))
    check('language given by the host', await page.evaluate(`${frame}.contentDocument.getElementById('lang').textContent === 'fr'`))
    check('logged-in player given by the host (name and picture)', await page.evaluate(`${game}.play.player && ${game}.play.player.name === 'Ama' && ${game}.play.player.avatar === '/logo.svg'`))

    await page.evaluate(`${game}.score(1234).then(() => { window.__scored = true })`)
    check('sendScore() → onScore on the host', await page.waitFor(`window.__scored === true && ${events}.includes('score:1234')`))

    await page.evaluate(`${game}.saveLoad({ level: 3 }).then((v) => { window.__loaded = v })`)
    check('save() then load() through the host', await page.waitFor(`window.__loaded && window.__loaded.value.level === 3`))
    check('  … stored by the host (localStorage of the site)', await page.evaluate(`JSON.parse(localStorage.getItem('noru-play:save:/games/test/')).value.level === 3`))
    await page.evaluate(`${game}.tooBig().then((m) => { window.__big = m })`)
    check('saves over 1 MB are refused', await page.waitFor(`typeof window.__big === 'string' && window.__big.includes('too large')`), await page.evaluate('window.__big'))

    await page.evaluate(`document.getElementById('host-pause').click()`)
    check('host pause → onPause in the game', await page.waitFor(`${game}.state.pauses === 1 && ${game}.play.isPaused`))
    await page.evaluate(`document.getElementById('host-pause').click()`)
    check('host resume → onResume in the game', await page.waitFor(`${game}.state.resumes === 1 && !${game}.play.isPaused`))
    await page.evaluate(`document.getElementById('host-mute').click()`)
    check('host mute → onAudioChange(false)', await page.waitFor(`${game}.state.audio.join() === 'false' && !${game}.play.isAudioEnabled`))

    await page.evaluate(`${game}.crash()`)
    check('uncaught errors of the game reach onError', await page.waitFor(`${events}.some((e) => e.includes('boom from the game'))`))

    console.log('\n— Cloud Acres example')
    await page.navigate(`${base}/farm`)
    check('Cloud Acres loads in <Playable> and calls gameReady', await page.waitFor(`window.__farmReady === true`))
    await sleep(500)
    const pixel = await page.evaluate(`(() => {
      const canvas = document.querySelector('iframe[title="Cloud Acres"]').contentDocument.querySelector('canvas')
      const ctx = canvas.getContext('2d')
      let green = 0
      for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) {
        const c = ctx.getImageData((canvas.width * i) / 7, (canvas.height * j) / 7, 1, 1).data
        if (c[1] > c[0] && c[1] > c[2] && c[1] > 90) green++
      }
      return green
    })()`)
    check('Cloud Acres draws the farm (mostly grass)', pixel >= 12, `${pixel}/36 green points`)
    await page.evaluate('window.scrollTo(0, 3000)')
    check('game scrolled out of view: paused automatically', await page.waitFor('window.__farmPaused === true'))
    await page.evaluate('window.scrollTo(0, 0)')
    check('  … and resumed when visible again', await page.waitFor('window.__farmPaused === false'))
    check('no errors from Cloud Acres', !(await page.evaluate('window.__farmError')), await page.evaluate('window.__farmError'))
    const errors = page.takeErrors().filter((e) => !/boom from the game|fonts\.googleapis/.test(e))
    check('no unexpected errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
  } finally {
    page.close()
    killTree(dev)
    await sleep(300)
    rmSync(project, { recursive: true, force: true })
  }
  if (failures.length) {
    console.log(`\n${failures.length} noru play check(s) failed\n--- dev server logs ---\n${logs.slice(-2000)}`)
    process.exit(1)
  }
  console.log('\nall noru play tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
