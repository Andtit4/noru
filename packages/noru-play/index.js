// noru play: the SDK used by a game. The game runs in an iframe of a website (the host); the SDK
// tells the host when the game is ready, sends scores and saves, and receives pause / resume and
// sound on / off from it.
//
// Outside a host (the game opened on its own, e.g. with `noru dev`), the SDK works standalone:
// saves go to localStorage and scores to the console, so a game can be developed by itself.

import { MAX_SAVE_BYTES, isMessage, jsonSize, message } from './protocol.js'

const browser = typeof window !== 'undefined'
const framed = browser && window.parent !== window
/** How long to wait for the host to answer before running standalone. */
const HANDSHAKE_TIMEOUT = 1500
const REQUEST_TIMEOUT = 10000

let mode = framed ? 'connecting' : 'standalone' // 'connecting' | 'host' | 'standalone'
let hostOrigin = null
let allowedOrigins = browser ? [location.origin] : []
let language = browser && navigator.language ? navigator.language.split('-')[0] : 'en'
let audioEnabled = true
let player = null
let paused = false
let firstFrame = false
let ready = false
let nextId = 1
const requests = new Map()
const listeners = { pause: new Set(), resume: new Set(), audio: new Set() }
let resolveReady
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve
})

function emit(kind, value) {
  for (const listener of [...listeners[kind]]) {
    try {
      listener(value)
    } catch (error) {
      console.error(error)
    }
  }
}

function setPaused(value) {
  if (paused === value) return
  paused = value
  emit(value ? 'pause' : 'resume')
}

function setAudio(value) {
  if (audioEnabled === value) return
  audioEnabled = value
  emit('audio', value)
}

function post(type, payload, id) {
  if (mode !== 'host') return
  window.parent.postMessage(message(type, payload, id), hostOrigin)
}

function standalone(reason) {
  if (mode === 'host') return
  if (mode === 'connecting' && reason) console.info(`[noru play] ${reason}: running standalone`)
  mode = 'standalone'
  resolveReady()
}

function storageKey() {
  return 'noru-play:save:' + location.pathname
}

function request(type, payload) {
  if (mode === 'standalone') return Promise.reject(new Error('no host'))
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      requests.delete(id)
      reject(new Error(`[noru play] the host did not answer "${type}"`))
    }, REQUEST_TIMEOUT)
    requests.set(id, { resolve, reject, timer })
    post(type, payload, id)
  })
}

if (browser) {
  window.addEventListener('message', (event) => {
    if (!framed || event.source !== window.parent || !isMessage(event.data)) return
    if (!allowedOrigins.includes('*') && !allowedOrigins.includes(event.origin)) return
    const { type, payload, id } = event.data
    if (type === 'init') {
      hostOrigin = event.origin
      mode = 'host'
      if (payload && typeof payload.language === 'string') language = payload.language
      if (payload && typeof payload.audioEnabled === 'boolean') setAudio(payload.audioEnabled)
      if (payload && typeof payload.paused === 'boolean') setPaused(payload.paused)
      if (payload && payload.player && typeof payload.player === 'object') {
        const name = typeof payload.player.name === 'string' ? payload.player.name.slice(0, 80) : ''
        const avatar = typeof payload.player.avatar === 'string' ? payload.player.avatar : null
        player = { name, avatar }
      }
      // Tell the host what already happened before it answered.
      if (firstFrame) post('firstFrameReady')
      if (ready) post('gameReady')
      resolveReady()
    } else if (mode !== 'host' || event.origin !== hostOrigin) {
      return
    } else if (type === 'pause') {
      setPaused(true)
    } else if (type === 'resume') {
      setPaused(false)
    } else if (type === 'audio') {
      setAudio(!!(payload && payload.enabled))
    } else if (type === 'response') {
      const pending = requests.get(id)
      if (!pending) return
      requests.delete(id)
      clearTimeout(pending.timer)
      if (payload && payload.ok) pending.resolve(payload.data)
      else pending.reject(new Error((payload && payload.error) || 'the host refused the request'))
    }
  })

  if (framed) {
    // The handshake starts after the current script, so that `play.configure()` called right after
    // the import applies to it.
    queueMicrotask(() => {
      window.parent.postMessage(message('hello', { sdk: 1 }), '*')
      setTimeout(() => standalone('no noru play host answered'), HANDSHAKE_TIMEOUT)
    })
  } else {
    resolveReady()
  }

  // Uncaught errors of the game are reported to the host.
  window.addEventListener('error', (event) => play.logError(event.error || event.message))
  window.addEventListener('unhandledrejection', (event) => play.logError(event.reason))
}

function errorText(error) {
  if (error instanceof Error) return (error.stack || error.message || String(error)).slice(0, 2000)
  return String(error).slice(0, 2000)
}

export const play = {
  /**
   * Origins allowed to host the game (default: the game's own origin, i.e. the same website).
   * Call it right after importing the SDK. `['*']` allows any website.
   */
  configure(options = {}) {
    if (Array.isArray(options.allowedOrigins)) allowedOrigins = options.allowedOrigins.slice()
  },

  /** Resolves once the SDK knows whether a host is there (`play.inHost`). */
  get ready() {
    return readyPromise
  },

  /** true when the game runs inside a noru play host. */
  get inHost() {
    return mode === 'host'
  },

  /** The player logged in on the website ({ name, avatar }), or null. Given by the host. */
  get player() {
    return player
  },

  /** Language of the player (`"fr"`, `"en"`...), given by the host or the browser. */
  get language() {
    return language
  },

  get isPaused() {
    return paused
  },

  get isAudioEnabled() {
    return audioEnabled
  },

  /** The first frame is on screen: the host can remove its loading screen. */
  firstFrameReady() {
    if (firstFrame) return
    firstFrame = true
    post('firstFrameReady')
  },

  /** The player can play. */
  gameReady() {
    if (ready) return
    if (!firstFrame) play.firstFrameReady()
    ready = true
    post('gameReady')
  },

  /** Called when the host pauses the game (hidden tab, game scrolled out of view...). */
  onPause(listener) {
    listeners.pause.add(listener)
    return () => listeners.pause.delete(listener)
  },

  onResume(listener) {
    listeners.resume.add(listener)
    return () => listeners.resume.delete(listener)
  },

  /** Called with `true` / `false` when the host turns the sound on or off. */
  onAudioChange(listener) {
    listeners.audio.add(listener)
    return () => listeners.audio.delete(listener)
  },

  /** Saves the player's progress (any JSON value, up to 1 MB). */
  async save(data) {
    const size = jsonSize(data)
    if (size > MAX_SAVE_BYTES) throw new Error(`[noru play] save too large (${size} bytes, max ${MAX_SAVE_BYTES})`)
    await readyPromise
    if (mode === 'standalone') {
      localStorage.setItem(storageKey(), JSON.stringify(data))
      return
    }
    await request('save', data)
  },

  /** The last saved progress, or `null`. */
  async load() {
    await readyPromise
    if (mode === 'standalone') {
      const text = localStorage.getItem(storageKey())
      return text == null ? null : JSON.parse(text)
    }
    const data = await request('load')
    return data === undefined ? null : data
  },

  /** Sends a score to the host (a finite number). */
  async sendScore(score) {
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('[noru play] the score must be a finite number')
    await readyPromise
    if (mode === 'standalone') {
      console.info(`[noru play] score: ${score}`)
      return
    }
    await request('score', score)
  },

  logError(error) {
    if (mode === 'host') post('error', { message: errorText(error) })
  },

  logWarning(warning) {
    if (mode === 'host') post('warning', { message: errorText(warning) })
  },
}

export default play
