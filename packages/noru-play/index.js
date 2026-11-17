// noru play: the SDK used by a game. The game runs in an iframe of a website (the host); the SDK
// tells the host when the game is ready, sends scores and saves, and receives pause / resume and
// sound on / off from it.
//
// Outside a host (the game opened on its own, e.g. with `noru dev`), the SDK works standalone:
// saves go to localStorage and scores to the console, so a game can be developed by itself.

import { MAX_ROOM_MESSAGE_BYTES, MAX_SAVE_BYTES, ROOM_NAME, isMessage, jsonSize, message } from './protocol.js'
import { broadcastChannelTransport, webSocketTransport } from './multiplayer.js'

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
// What the host offers (told in `init`).
let hostPurchases = false
let hostMultiplayer = false
// Standalone: products to try purchases, and the rooms transport (tabs of the browser by default).
let testProducts = null
let roomTransport = null
const rooms = new Map() // room name -> Room
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

/** A request to the host; `timeout` 0 waits as long as needed (a payment, a room to join). */
function request(type, payload, timeout = REQUEST_TIMEOUT) {
  if (mode === 'standalone') return Promise.reject(new Error('no host'))
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = timeout
      ? setTimeout(() => {
          requests.delete(id)
          reject(new Error(`[noru play] the host did not answer "${type}"`))
        }, timeout)
      : 0
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
      hostPurchases = !!(payload && payload.purchases)
      hostMultiplayer = !!(payload && payload.multiplayer)
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
    } else if (type === 'room:event') {
      const room = payload && rooms.get(payload.room)
      if (room) room._event(payload)
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
  // The game closes or reloads: leave its rooms (the other players see it go).
  window.addEventListener('pagehide', () => {
    for (const room of [...rooms.values()]) room.leave()
  })
}

function errorText(error) {
  if (error instanceof Error) return (error.stack || error.message || String(error)).slice(0, 2000)
  return String(error).slice(0, 2000)
}

// --- purchases (standalone: test products, bought for free, kept in localStorage) ---------------

function ledgerKey() {
  return 'noru-play:purchases:' + location.pathname
}

function readLedger() {
  try {
    const list = JSON.parse(localStorage.getItem(ledgerKey()))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeLedger(list) {
  localStorage.setItem(ledgerKey(), JSON.stringify(list))
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// --- multiplayer ---------------------------------------------------------------------------------

function checkRoomSize(value, what) {
  const size = jsonSize(value)
  if (size > MAX_ROOM_MESSAGE_BYTES) throw new Error(`[noru play] ${what} too large (${size} bytes, max ${MAX_ROOM_MESSAGE_BYTES})`)
}

/** Players of a multiplayer room. Created by `play.joinRoom()`. */
class Room {
  constructor(name) {
    this.name = name
    /** You: { id, name, avatar, state }. */
    this.me = null
    /** The other players, by id: { id, name, avatar, state }. */
    this.players = new Map()
    this.closed = false
    this._listeners = { join: new Set(), leave: new Set(), state: new Set(), message: new Set(), close: new Set() }
    this._link = null // { send(data, to), setState(state), leave() }
  }

  /** `join` (player), `leave` (player), `state` (player), `message` (data, player), `close` (reason). */
  on(kind, listener) {
    const set = this._listeners[kind]
    if (!set) throw new Error(`[noru play] unknown room event "${kind}"`)
    set.add(listener)
    return () => set.delete(listener)
  }

  /** Sends any JSON value (up to 16 kB) to every other player, or to one player (`to`: its id). */
  send(data, to) {
    if (this.closed) return
    checkRoomSize(data, 'message')
    this._link.send(data, to)
  }

  /** Your shared state (position, look...): the others get it now, players who join later too. */
  setState(state) {
    if (this.closed) return
    checkRoomSize(state, 'state')
    this.me.state = state
    this._link.setState(state)
  }

  leave() {
    if (this.closed) return
    this._link.leave()
    this._close('left')
  }

  _emit(kind, ...args) {
    for (const listener of [...this._listeners[kind]]) {
      try {
        listener(...args)
      } catch (error) {
        console.error(error)
      }
    }
  }

  _close(reason) {
    if (this.closed) return
    this.closed = true
    if (rooms.get(this.name) === this) rooms.delete(this.name)
    this._emit('close', reason)
  }

  /** Events from the transport (standalone) or from the host (`room:event`). */
  _event(event) {
    if (this.closed) return
    if (!this.me) {
      // Still joining: kept until the room starts.
      ;(this._early || (this._early = [])).push(event)
      return
    }
    if (event.kind === 'join' && event.player && event.player.id !== this.me.id) {
      this.players.set(event.player.id, event.player)
      this._emit('join', event.player)
    } else if (event.kind === 'leave') {
      const player = this.players.get(event.id)
      if (!player) return
      this.players.delete(event.id)
      this._emit('leave', player)
    } else if (event.kind === 'state') {
      const player = this.players.get(event.id)
      if (!player) return
      player.state = event.state
      this._emit('state', player)
    } else if (event.kind === 'message') {
      const player = this.players.get(event.from)
      if (player) this._emit('message', event.data, player)
    } else if (event.kind === 'close') {
      this._close(event.reason || 'closed')
    }
  }

  _start(me, players) {
    this.me = me
    for (const p of players) if (p && p.id !== me.id) this.players.set(p.id, p)
    const early = this._early || []
    this._early = null
    for (const event of early) this._event(event)
  }
}

async function joinRoom(name, options = {}) {
  if (typeof name !== 'string' || !ROOM_NAME.test(name)) throw new Error('[noru play] a room name is 1-64 letters, digits, "-", "_", "." or ":"')
  const state = options.state === undefined ? null : options.state
  checkRoomSize(state, 'state')
  await readyPromise
  const current = rooms.get(name)
  if (current) return current
  const room = new Room(name)
  if (mode === 'host') {
    if (!hostMultiplayer) throw new Error('[noru play] this website does not offer multiplayer')
    rooms.set(name, room)
    try {
      const joined = await request('room:join', { room: name, state, name: options.name, avatar: options.avatar }, 20000)
      room._start(joined.me, joined.players || [])
    } catch (error) {
      rooms.delete(name)
      throw error
    }
    room._link = {
      send: (data, to) => post('room:send', { room: name, data, to }),
      setState: (value) => post('room:state', { room: name, state: value }),
      leave: () => post('room:leave', { room: name }),
    }
    return room
  }
  if (!roomTransport && typeof BroadcastChannel !== 'function') throw new Error('[noru play] multiplayer is not available here')
  const transport = roomTransport || (roomTransport = broadcastChannelTransport())
  const me = { name: options.name || (player && player.name) || '', avatar: options.avatar || null, state }
  rooms.set(name, room)
  let session
  try {
    session = await transport.join(name, me, {
      join: (p) => room._event({ kind: 'join', player: p }),
      leave: (id) => room._event({ kind: 'leave', id }),
      state: (id, value) => room._event({ kind: 'state', id, state: value }),
      message: (data, from) => room._event({ kind: 'message', data, from }),
      close: (reason) => room._event({ kind: 'close', reason }),
    })
  } catch (error) {
    rooms.delete(name)
    throw error
  }
  room._start(session.me, session.players)
  room._link = session
  return room
}

export const play = {
  /**
   * Origins allowed to host the game (default: the game's own origin, i.e. the same website).
   * Call it right after importing the SDK. `['*']` allows any website.
   */
  configure(options = {}) {
    if (Array.isArray(options.allowedOrigins)) allowedOrigins = options.allowedOrigins.slice()
    // Standalone only (the game opened on its own): products that can be "bought" for free, to
    // develop the shop of a game without a website.
    if (Array.isArray(options.testProducts)) testProducts = options.testProducts.map((p) => ({ ...p }))
    // Standalone only: where players meet. A rooms server URL, a transport, or (default) the tabs
    // of the same browser.
    if (typeof options.multiplayer === 'string') roomTransport = webSocketTransport(options.multiplayer)
    else if (options.multiplayer && typeof options.multiplayer.join === 'function') roomTransport = options.multiplayer
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

  // --- purchases: the website sells, the game delivers ----------------------------------------

  /** true when the website sells things to the player (coins...), see `getProducts()`. */
  get canPurchase() {
    return mode === 'host' ? hostPurchases : !!testProducts
  },

  /** What the website sells: [{ id, title, price, ... }] (`price` is a text to show, e.g. "500 FCFA"). */
  async getProducts() {
    await readyPromise
    if (mode === 'standalone') return testProducts ? testProducts.map((p) => ({ ...p })) : []
    if (!hostPurchases) return []
    return (await request('products')) || []
  },

  /**
   * Buys a product: the website takes the payment, the game only gets the result.
   * Resolves with `{ purchaseId, productId, product }` once paid, or `null` if the player cancelled.
   * Give the player what they bought, save, then call `consumePurchase(purchaseId)`: a purchase not
   * consumed (the game closed in between) comes back in `getPendingPurchases()`.
   */
  async purchase(productId) {
    await readyPromise
    if (mode === 'standalone') {
      const product = testProducts && testProducts.find((p) => p.id === productId)
      if (!product) throw new Error(`[noru play] unknown product "${productId}"`)
      const purchase = { purchaseId: randomId(), productId, product: { ...product }, time: Date.now() }
      writeLedger([...readLedger(), purchase])
      return purchase
    }
    if (!hostPurchases) throw new Error('[noru play] this website does not sell anything')
    return request('purchase', { productId }, 0)
  },

  /** Purchases paid but not consumed yet: give them to the player at start. */
  async getPendingPurchases() {
    await readyPromise
    if (mode === 'standalone') return readLedger()
    if (!hostPurchases) return []
    return (await request('pendingPurchases')) || []
  },

  /** The player received this purchase: remove it from the pending ones. */
  async consumePurchase(purchaseId) {
    await readyPromise
    if (mode === 'standalone') {
      writeLedger(readLedger().filter((p) => p.purchaseId !== purchaseId))
      return
    }
    await request('consumePurchase', { purchaseId })
  },

  // --- multiplayer --------------------------------------------------------------------------------

  /** true when the game can join multiplayer rooms (the website offers it, or tabs of the browser). */
  get canJoinRooms() {
    if (mode === 'host') return hostMultiplayer
    return !!roomTransport || typeof BroadcastChannel === 'function'
  },

  /**
   * Joins a room: the players in the same room see each other's state and exchange messages.
   * `options.state` is your first shared state. Your name and picture come from the website.
   */
  joinRoom,

  logError(error) {
    if (mode === 'host') post('error', { message: errorText(error) })
  },

  logWarning(warning) {
    if (mode === 'host') post('warning', { message: errorText(warning) })
  },
}

export default play
