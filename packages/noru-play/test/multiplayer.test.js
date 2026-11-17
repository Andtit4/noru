// node test/multiplayer.test.js [path/to/noru] — the multiplayer transports: tabs of a browser
// (BroadcastChannel), and a rooms server (`noru play-server`, when the noru binary is found).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { broadcastChannelTransport, webSocketTransport } from '../multiplayer.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function recorder() {
  const log = []
  const events = {
    join: (p) => log.push(['join', p.name]),
    leave: (id) => log.push(['leave', id]),
    state: (id, s) => log.push(['state', id, s]),
    message: (data, from) => log.push(['message', data, from]),
    close: (reason) => log.push(['close', reason]),
  }
  return { log, events }
}

async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await sleep(20)
  }
  assert.fail('timed out: ' + what)
}

async function scenario(transport, label) {
  const a = recorder()
  const b = recorder()
  const ama = await transport.join('farm', { name: 'Ama', avatar: null, state: { x: 1 } }, a.events)
  assert.equal(ama.players.length, 0)
  const kofi = await transport.join('farm', { name: 'Kofi', avatar: '/k.png', state: null }, b.events)
  assert.deepEqual(kofi.players.map((p) => [p.name, p.state]), [['Ama', { x: 1 }]], 'players already there, with their state')
  await until(() => a.log.some((e) => e[0] === 'join' && e[1] === 'Kofi'), 'join event')
  kofi.setState({ x: 9 })
  await until(() => a.log.some((e) => e[0] === 'state' && e[1] === kofi.me.id && e[2].x === 9), 'state event')
  ama.send({ gift: 'egg' })
  await until(() => b.log.some((e) => e[0] === 'message' && e[1].gift === 'egg' && e[2] === ama.me.id), 'broadcast message')
  ama.send('just for you', kofi.me.id)
  await until(() => b.log.some((e) => e[0] === 'message' && e[1] === 'just for you'), 'direct message')
  assert.ok(!a.log.some((e) => e[0] === 'message'), 'no echo of your own messages')
  kofi.leave()
  await until(() => a.log.some((e) => e[0] === 'leave' && e[1] === kofi.me.id), 'leave event')
  ama.leave()
  console.log(`✓ ${label}: join, players already there, state, messages (all / one player), leave`)
}

await scenario(broadcastChannelTransport(), 'tabs of a browser (BroadcastChannel)')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const noru = process.argv[2] || process.env.NORU_BIN || join(root, 'target', 'release', process.platform === 'win32' ? 'noru.exe' : 'noru')
if (!existsSync(noru)) {
  console.log('- rooms server not tested (no noru binary at ' + noru + ')')
} else {
  const port = 4700 + Math.floor(Math.random() * 200)
  const server = spawn(noru, ['play-server', '--port', String(port), '--host', '127.0.0.1', '--max-players', '2'], { env: { ...process.env, NO_COLOR: '1' } })
  let logs = ''
  server.stdout.on('data', (d) => (logs += d))
  server.stderr.on('data', (d) => (logs += d))
  try {
    await until(() => logs.includes('Local'), 'play-server start')
    const transport = webSocketTransport(`http://127.0.0.1:${port}/`)
    await scenario(transport, 'rooms server (noru play-server, WebSocket)')
    // A full room refuses a third player.
    const x = await transport.join('full', { name: 'A' }, recorder().events)
    const y = await transport.join('full', { name: 'B' }, recorder().events)
    await assert.rejects(transport.join('full', { name: 'C' }, recorder().events), /full/)
    // The health check counts rooms and players.
    const health = await (await fetch(`http://127.0.0.1:${port}/`)).json()
    assert.deepEqual([health.rooms, health.players], [1, 2])
    x.leave()
    y.leave()
    console.log('✓ rooms server: full rooms refuse players, health check')
  } finally {
    server.kill()
  }
}
console.log('✓ noru-play multiplayer tests passed')
