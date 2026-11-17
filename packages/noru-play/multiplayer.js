// noru play: multiplayer transports. A transport connects players of a room:
//
//   transport.join(room, me, events) -> Promise<session>
//     me      { name, avatar, state }
//     events  { join(player), leave(id), state(id, state), message(data, from), close(reason) }
//     session { me, players, send(data, to?), setState(state), leave() }
//   player    { id, name, avatar, state }
//
// - webSocketTransport(url): through a rooms server (`noru dev` serves one at /@noru/play,
//   `noru play-server` runs one for production). Players on any device.
// - broadcastChannelTransport(): between tabs of the same browser, no server (to try a game).
//
// A website can bring its own transport (its server, a realtime database...) with the same shape.

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().slice(0, 12)
  return Math.random().toString(36).slice(2, 14)
}

function cleanPlayer(player) {
  if (!player || typeof player !== 'object' || typeof player.id !== 'string') return null
  return {
    id: player.id,
    name: typeof player.name === 'string' ? player.name.slice(0, 40) : '',
    avatar: typeof player.avatar === 'string' ? player.avatar : null,
    state: player.state === undefined ? null : player.state,
  }
}

/** Players in tabs of the same browser (BroadcastChannel). No server needed: for development. */
export function broadcastChannelTransport() {
  return {
    join(room, me, events) {
      return new Promise((resolve) => {
        const channel = new BroadcastChannel('noru-play-room:' + room)
        const id = randomId()
        const self = { id, name: me.name || '', avatar: me.avatar || null, state: me.state === undefined ? null : me.state }
        const peers = new Map() // id -> { player, seen }
        // Messages received while joining (an answer to our hello): given once the room is joined.
        const early = []
        let ready = false
        let closed = false
        const post = (data) => {
          if (!closed) channel.postMessage({ ...data, from: id })
        }
        const add = (raw) => {
          const player = cleanPlayer(raw)
          if (!player || player.id === id) return
          const known = peers.get(player.id)
          if (known) {
            known.seen = Date.now()
            return
          }
          peers.set(player.id, { player, seen: Date.now() })
          if (ready) events.join(player)
        }
        const remove = (peerId) => {
          if (peers.delete(peerId) && ready) events.leave(peerId)
        }
        channel.onmessage = ({ data }) => {
          if (!data || typeof data !== 'object' || data.from === id) return
          if (data.to && data.to !== id) return
          const known = peers.get(data.from)
          if (known) known.seen = Date.now()
          switch (data.t) {
            case 'hello':
              // Answered first: what the new player is sent once they are known comes after.
              post({ t: 'here', player: self, to: data.from })
              add(data.player)
              break
            case 'here':
              add(data.player)
              break
            case 'ping':
              // A player we missed (it joined while this tab was asleep): say hello to it.
              if (!known) post({ t: 'hello', player: self, to: data.from })
              break
            case 'state':
              if (known) {
                known.player.state = data.state
                if (ready) events.state(data.from, data.state)
              }
              break
            case 'msg':
              if (known && ready) events.message(data.data, data.from)
              else if (!ready) early.push([data.data, data.from])
              break
            case 'bye':
              remove(data.from)
              break
          }
        }
        // Players of closed tabs stop answering: they leave after a few seconds.
        const heartbeat = setInterval(() => {
          post({ t: 'ping' })
          const now = Date.now()
          for (const [peerId, peer] of peers) if (now - peer.seen > 7000) remove(peerId)
        }, 2000)
        const leave = () => {
          if (closed) return
          post({ t: 'bye' })
          closed = true
          clearInterval(heartbeat)
          channel.close()
          if (typeof window !== 'undefined') window.removeEventListener('pagehide', leave)
        }
        if (typeof window !== 'undefined') window.addEventListener('pagehide', leave)
        post({ t: 'hello', player: self })
        // The players already there answer within a few milliseconds.
        setTimeout(() => {
          ready = true
          resolve({
            me: { ...self },
            players: [...peers.values()].map((p) => ({ ...p.player })),
            send(data, to) {
              post(to ? { t: 'msg', data, to } : { t: 'msg', data })
            },
            setState(state) {
              self.state = state
              post({ t: 'state', state })
            },
            leave,
          })
          for (const [message, from] of early.splice(0)) if (peers.has(from)) events.message(message, from)
        }, 150)
      })
    },
  }
}

/**
 * Players connected to a rooms server (WebSocket). `url` may be relative to the page
 * (`/@noru/play` with `noru dev`), or absolute (`wss://play.example.com`).
 */
export function webSocketTransport(url) {
  return {
    join(room, me, events) {
      const base = typeof location !== 'undefined' ? location.href : 'http://localhost/'
      const target = new URL(url, base)
      if (target.protocol === 'http:') target.protocol = 'ws:'
      if (target.protocol === 'https:') target.protocol = 'wss:'
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(target.href)
        let session = null
        let left = false
        const sendJson = (value) => {
          if (socket.readyState === 1) socket.send(JSON.stringify(value))
        }
        socket.onopen = () => {
          sendJson({ t: 'join', room, name: me.name || '', avatar: me.avatar || null, state: me.state === undefined ? null : me.state })
        }
        socket.onmessage = (event) => {
          let data
          try {
            data = JSON.parse(event.data)
          } catch {
            return
          }
          if (!data || typeof data !== 'object') return
          if (!session) {
            if (data.t === 'welcome') {
              session = {
                me: cleanPlayer(data.me),
                players: (Array.isArray(data.players) ? data.players : []).map(cleanPlayer).filter(Boolean),
                send(value, to) {
                  sendJson(to ? { t: 'msg', data: value, to } : { t: 'msg', data: value })
                },
                setState(state) {
                  sendJson({ t: 'state', state })
                },
                leave() {
                  if (left) return
                  left = true
                  sendJson({ t: 'leave' })
                  socket.close(1000)
                },
              }
              resolve(session)
            } else if (data.t === 'error') {
              left = true
              reject(new Error(String(data.message || 'the rooms server refused to join')))
              socket.close(1000)
            }
            return
          }
          if (data.t === 'join') {
            const player = cleanPlayer(data.player)
            if (player) events.join(player)
          } else if (data.t === 'leave') events.leave(String(data.id))
          else if (data.t === 'state') events.state(String(data.id), data.state === undefined ? null : data.state)
          else if (data.t === 'msg') events.message(data.data, String(data.from))
          else if (data.t === 'error') console.warn('[noru play] rooms server: ' + data.message)
        }
        socket.onclose = () => {
          if (!session) {
            if (!left) reject(new Error('[noru play] cannot connect to the rooms server ' + target.href))
          } else if (!left) {
            left = true
            events.close('disconnected')
          }
        }
      })
    },
  }
}
