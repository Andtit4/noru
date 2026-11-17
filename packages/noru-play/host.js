// noru play: the host side. Connects a page to a game running in an <iframe>: answers the game's
// handshake, stores its saves, receives its scores, pauses it when it cannot be seen, takes the
// payments of what the game sells, and connects it to multiplayer rooms.
// Works with any framework; `noru-play/react` wraps it in a <Playable> component.

import { MAX_ROOM_MESSAGE_BYTES, MAX_SAVE_BYTES, ROOM_NAME, isMessage, jsonSize, message } from './protocol.js'
import { webSocketTransport } from './multiplayer.js'

export { broadcastChannelTransport, webSocketTransport } from './multiplayer.js'

/** Saves in the browser's localStorage, one entry per game. */
export function localStorageAdapter(key) {
  return {
    async load() {
      const text = localStorage.getItem(key)
      return text == null ? null : JSON.parse(text)
    },
    async save(data) {
      localStorage.setItem(key, JSON.stringify(data))
    },
  }
}

/**
 * Purchases paid but not yet given to the player by the game, in localStorage. A website with
 * accounts keeps them on its server instead (same three methods).
 */
export function localPurchaseStore(key) {
  const read = () => {
    try {
      const list = JSON.parse(localStorage.getItem(key))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }
  return {
    async list() {
      return read()
    },
    async add(purchase) {
      localStorage.setItem(key, JSON.stringify([...read().filter((p) => p.purchaseId !== purchase.purchaseId), purchase]))
    },
    async remove(purchaseId) {
      localStorage.setItem(key, JSON.stringify(read().filter((p) => p.purchaseId !== purchaseId)))
    },
  }
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Only JSON goes to the game (no functions, no class instances). */
const plain = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)))

/**
 * @param {HTMLIFrameElement} iframe
 * @param {object} [options]
 */
export function createHost(iframe, options = {}) {
  const src = iframe.getAttribute('src') || ''
  const gameUrl = new URL(src, location.href)
  const allowedOrigin = options.allowedOrigin || gameUrl.origin
  const defaultStorage = localStorageAdapter('noru-play:save:' + gameUrl.pathname)
  const maxSaveBytes = options.maxSaveBytes || MAX_SAVE_BYTES
  const callbacks = { ...options }
  const storage = () => callbacks.storage || defaultStorage
  const defaultPurchases = localPurchaseStore('noru-play:purchases:' + gameUrl.pathname)
  const purchaseStore = () => callbacks.purchaseStore || defaultPurchases
  let purchasing = false
  // Multiplayer: `multiplayer` is a transport or the URL of a rooms server.
  let wsTransport = null
  const transport = () => {
    const m = callbacks.multiplayer
    if (typeof m === 'string') {
      if (!wsTransport || wsTransport.url !== m) wsTransport = { url: m, transport: webSocketTransport(m) }
      return wsTransport.transport
    }
    return m && typeof m.join === 'function' ? m : null
  }
  const rooms = new Map() // room name (as the game calls it) -> session
  const leaveRooms = () => {
    for (const session of rooms.values()) session.leave()
    rooms.clear()
  }
  let language = options.language || (navigator.language || 'en').split('-')[0]
  let audioEnabled = options.audioEnabled !== false
  let player = options.player || null
  // The game is paused while any of these reasons applies.
  const pauseReasons = new Set()
  let connected = false
  let firstFrame = false
  let ready = false
  let destroyed = false

  const call = (name, ...args) => {
    const fn = callbacks[name]
    if (typeof fn === 'function') {
      try {
        return fn(...args)
      } catch (error) {
        console.error(error)
      }
    }
  }

  function send(type, payload, id) {
    const target = iframe.contentWindow
    if (target && connected) target.postMessage(message(type, payload, id), allowedOrigin)
  }

  function respond(id, work) {
    Promise.resolve()
      .then(work)
      .then(
        (data) => send('response', { ok: true, data: data === undefined ? null : data }, id),
        (error) => send('response', { ok: false, error: String((error && error.message) || error) }, id),
      )
  }

  function updatePause(reason, on) {
    const before = pauseReasons.size > 0
    if (on) pauseReasons.add(reason)
    else pauseReasons.delete(reason)
    const after = pauseReasons.size > 0
    if (before !== after) {
      send(after ? 'pause' : 'resume')
      call(after ? 'onPause' : 'onResume')
    }
  }

  async function products() {
    const source = callbacks.products
    const list = typeof source === 'function' ? await source() : source || []
    if (!Array.isArray(list)) throw new Error('products must be a list')
    return plain(list.filter((p) => p && typeof p.id === 'string'))
  }

  async function purchase(productId) {
    if (typeof callbacks.onPurchase !== 'function') throw new Error('this website does not sell anything')
    const product = (await products()).find((p) => p.id === productId)
    if (!product) throw new Error(`unknown product "${productId}"`)
    if (purchasing) throw new Error('a purchase is already in progress')
    purchasing = true
    try {
      // The website takes the payment (its checkout, mobile money...): truthy once paid.
      const paid = await callbacks.onPurchase(product)
      if (!paid) return null
      const purchaseId = typeof paid === 'object' && typeof paid.purchaseId === 'string' ? paid.purchaseId : randomId()
      const done = { purchaseId, productId: product.id, product, time: Date.now() }
      // Kept until the game consumes it: nothing is lost if the game closes now.
      await purchaseStore().add(done)
      return done
    } finally {
      purchasing = false
    }
  }

  async function joinRoom({ room, state, name, avatar }) {
    const through = transport()
    if (!through) throw new Error('this website does not offer multiplayer')
    if (typeof room !== 'string' || !ROOM_NAME.test(room)) throw new Error('invalid room name')
    if (jsonSize(state) > MAX_ROOM_MESSAGE_BYTES) throw new Error('state too large')
    const old = rooms.get(room)
    if (old) {
      rooms.delete(room)
      old.leave()
    }
    // The website can put the game's rooms apart (per page, per group of players...).
    const target = typeof callbacks.room === 'function' ? String(callbacks.room(room)) : room
    // The name and picture come from the website's account when there is one.
    const me = {
      name: (player && player.name) || (typeof name === 'string' ? name.slice(0, 40) : ''),
      avatar: (player && player.avatar) || (typeof avatar === 'string' ? avatar : null),
      state: state === undefined ? null : state,
    }
    const event = (kind, data) => {
      if (rooms.get(room) === session) send('room:event', { room, kind, ...data })
    }
    let session = null
    const joined = await through.join(target, me, {
      join: (p) => event('join', { player: plain(p) }),
      leave: (playerId) => event('leave', { id: playerId }),
      state: (playerId, value) => event('state', { id: playerId, state: plain(value) }),
      message: (data, from) => event('message', { data: plain(data), from }),
      close: (reason) => {
        event('close', { reason })
        if (rooms.get(room) === session) rooms.delete(room)
      },
    })
    session = joined
    if (destroyed) {
      joined.leave()
      throw new Error('the game was closed')
    }
    rooms.set(room, joined)
    return { me: plain(joined.me), players: plain(joined.players) }
  }

  function onMessage(event) {
    if (destroyed || event.source !== iframe.contentWindow || event.origin !== allowedOrigin) return
    if (!isMessage(event.data)) return
    const { type, payload, id } = event.data
    switch (type) {
      case 'hello':
        // A (re)loaded game: (re)start the session.
        connected = true
        firstFrame = false
        ready = false
        leaveRooms()
        send('init', {
          language,
          audioEnabled,
          paused: pauseReasons.size > 0,
          player,
          purchases: typeof callbacks.onPurchase === 'function',
          multiplayer: !!transport(),
        })
        call('onConnect')
        break
      case 'firstFrameReady':
        if (!firstFrame) {
          firstFrame = true
          // Keyboard games: the keys go to the game without clicking it first.
          if (callbacks.autoFocus) iframe.focus({ preventScroll: true })
          call('onFirstFrame')
        }
        break
      case 'gameReady':
        if (!ready) {
          ready = true
          call('onReady')
        }
        break
      case 'score':
        respond(id, () => {
          if (typeof payload !== 'number' || !Number.isFinite(payload)) throw new Error('invalid score')
          return call('onScore', payload)
        })
        break
      case 'save':
        respond(id, () => {
          const size = jsonSize(payload)
          if (size > maxSaveBytes) throw new Error(`save too large (${size} bytes, max ${maxSaveBytes})`)
          return storage().save(payload).then(() => undefined)
        })
        break
      case 'load':
        respond(id, () => storage().load())
        break
      case 'products':
        respond(id, () => products())
        break
      case 'purchase':
        respond(id, () => purchase(payload && payload.productId))
        break
      case 'pendingPurchases':
        respond(id, () => purchaseStore().list())
        break
      case 'consumePurchase':
        respond(id, async () => {
          const purchaseId = payload && payload.purchaseId
          if (typeof purchaseId !== 'string') throw new Error('invalid purchase id')
          await purchaseStore().remove(purchaseId)
          call('onPurchaseConsumed', purchaseId)
        })
        break
      case 'room:join':
        respond(id, () => joinRoom(payload || {}))
        break
      case 'room:send': {
        const session = payload && rooms.get(payload.room)
        if (session && jsonSize(payload.data) <= MAX_ROOM_MESSAGE_BYTES) session.send(payload.data, typeof payload.to === 'string' ? payload.to : undefined)
        break
      }
      case 'room:state': {
        const session = payload && rooms.get(payload.room)
        if (session && jsonSize(payload.state) <= MAX_ROOM_MESSAGE_BYTES) session.setState(payload.state === undefined ? null : payload.state)
        break
      }
      case 'room:leave': {
        const session = payload && rooms.get(payload.room)
        if (session) {
          rooms.delete(payload.room)
          session.leave()
        }
        break
      }
      case 'error':
        call('onError', new Error((payload && payload.message) || 'error in the game'))
        break
      case 'warning':
        call('onWarning', (payload && payload.message) || '')
        break
    }
  }

  window.addEventListener('message', onMessage)

  // Pause when the tab is hidden or the game scrolled out of view (unless autoPause is false).
  const cleanups = []
  if (options.autoPause !== false) {
    const onVisibility = () => updatePause('hidden', document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))
    onVisibility()
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1]
          updatePause('offscreen', !entry.isIntersecting || entry.intersectionRatio < 0.25)
        },
        { threshold: [0, 0.25, 0.5, 1] },
      )
      observer.observe(iframe)
      cleanups.push(() => observer.disconnect())
    }
  }
  if (options.paused) updatePause('manual', true)

  return {
    /** Pauses the game (until `resume()`). */
    pause() {
      updatePause('manual', true)
    },
    resume() {
      updatePause('manual', false)
    },
    /** Turns the game's sound on or off. */
    setAudio(enabled) {
      enabled = !!enabled
      if (enabled === audioEnabled) return
      audioEnabled = enabled
      send('audio', { enabled })
    },
    /** The logged-in user shown in the game ({ name, avatar }); applies when the game (re)starts. */
    setPlayer(value) {
      player = value || null
    },
    setLanguage(value) {
      language = value
    },
    /** Replaces the callbacks (onScore, onReady...) and the storage, e.g. on a React re-render. */
    setCallbacks(next) {
      Object.assign(callbacks, next)
    },
    get state() {
      return { connected, firstFrame, ready, paused: pauseReasons.size > 0, audioEnabled, rooms: [...rooms.keys()] }
    },
    destroy() {
      destroyed = true
      leaveRooms()
      window.removeEventListener('message', onMessage)
      cleanups.forEach((fn) => fn())
    },
  }
}
