// noru play: the host side. Connects a page to a game running in an <iframe>: answers the game's
// handshake, stores its saves, receives its scores, and pauses it when it cannot be seen.
// Works with any framework; `noru-play/react` wraps it in a <Playable> component.

import { MAX_SAVE_BYTES, isMessage, jsonSize, message } from './protocol.js'

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
        send('init', { language, audioEnabled, paused: pauseReasons.size > 0, player })
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
      return { connected, firstFrame, ready, paused: pauseReasons.size > 0, audioEnabled }
    },
    destroy() {
      destroyed = true
      window.removeEventListener('message', onMessage)
      cleanups.forEach((fn) => fn())
    },
  }
}
