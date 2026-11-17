// Test game for scripts/e2e-play.mjs: exercises every part of the noru play SDK.
import { play } from '../../../packages/noru-play/index.js'

const $ = (id) => document.getElementById(id)
const state = { pauses: 0, resumes: 0, audio: [], joins: [], leaves: [], states: [], messages: [] }

play.onPause(() => {
  state.pauses++
  $('paused').textContent = 'yes'
})
play.onResume(() => {
  state.resumes++
  $('paused').textContent = 'no'
})
play.onAudioChange((on) => {
  state.audio.push(on)
  $('audio').textContent = String(on)
})
play.ready.then(() => {
  $('mode').textContent = play.inHost ? 'host' : 'standalone'
  $('lang').textContent = play.language
  $('audio').textContent = String(play.isAudioEnabled)
})

window.game = {
  play,
  state,
  async saveLoad(value) {
    await play.save({ value })
    return play.load()
  },
  score: (n) => play.sendScore(n),
  tooBig: () => play.save('x'.repeat(1_100_000)).then(() => 'saved', (error) => error.message),
  crash: () => setTimeout(() => {
    throw new Error('boom from the game')
  }),
  // Purchases (the website takes the payment).
  products: () => play.getProducts(),
  buy: (id) => play.purchase(id),
  pending: () => play.getPendingPurchases(),
  consume: (id) => play.consumePurchase(id),
  // Multiplayer.
  room: null,
  async join(name) {
    const room = await play.joinRoom('lobby', { state: { name } })
    window.game.room = room
    room.on('join', (p) => state.joins.push(p.name))
    room.on('leave', (p) => state.leaves.push(p.name))
    room.on('state', (p) => state.states.push(p.state))
    room.on('message', (data, from) => state.messages.push([data, from.name]))
    return { me: room.me, players: [...room.players.values()] }
  },
}

requestAnimationFrame(() => {
  play.firstFrameReady()
  setTimeout(() => play.gameReady(), 50)
})
