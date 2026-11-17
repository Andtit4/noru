// noru play: the messages exchanged between a game (in an iframe) and the page that hosts it.
//
// Every message is { source: "noru-play", v: 1, type, id?, payload? }.
//   game -> host:  hello, firstFrameReady, gameReady, error, warning,
//                  requests (with an id, answered by a "response"): score, save, load,
//                  products, purchase, pendingPurchases, consumePurchase,
//                  room:join, room:send, room:state, room:leave
//   host -> game:  init { language, audioEnabled, paused, player, purchases, multiplayer },
//                  pause, resume, audio { enabled }, response { id, ok, data?, error? },
//                  room:event { room, kind: join | leave | state | message | close, ... }

export const SOURCE = 'noru-play'
export const PROTOCOL_VERSION = 1

/** Saves larger than this are refused (1 MB of JSON). */
export const MAX_SAVE_BYTES = 1_000_000

/** Multiplayer: a message or a player state larger than this is refused (16 kB of JSON). */
export const MAX_ROOM_MESSAGE_BYTES = 16_000

/** Multiplayer: room names are short strings of letters, digits, `-`, `_`, `.` and `:`. */
export const ROOM_NAME = /^[\w.:-]{1,64}$/

export function message(type, payload, id) {
  const out = { source: SOURCE, v: PROTOCOL_VERSION, type }
  if (id !== undefined) out.id = id
  if (payload !== undefined) out.payload = payload
  return out
}

export function isMessage(data) {
  return !!data && typeof data === 'object' && data.source === SOURCE && typeof data.type === 'string'
}

/** Size of a value once serialized to JSON, in bytes (UTF-8). */
export function jsonSize(value) {
  const text = JSON.stringify(value)
  if (text === undefined) return 0
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length
}
