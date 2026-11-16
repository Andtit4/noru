// Test game for scripts/e2e-play.mjs: exercises every part of the noru play SDK.
import { play } from '../../../packages/noru-play/index.js'

const $ = (id) => document.getElementById(id)
const state = { pauses: 0, resumes: 0, audio: [] }

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
}

requestAnimationFrame(() => {
  play.firstFrameReady()
  setTimeout(() => play.gameReady(), 50)
})
