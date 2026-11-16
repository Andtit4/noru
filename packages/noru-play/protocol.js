// noru play: the messages exchanged between a game (in an iframe) and the page that hosts it.
//
// Every message is { source: "noru-play", v: 1, type, id?, payload? }.
//   game -> host:  hello, firstFrameReady, gameReady, score, save (id), load (id), error, warning
//   host -> game:  init { language, audioEnabled, paused }, pause, resume, audio { enabled },
//                  response { id, ok, data?, error? }

export const SOURCE = 'noru-play'
export const PROTOCOL_VERSION = 1

/** Saves larger than this are refused (1 MB of JSON). */
export const MAX_SAVE_BYTES = 1_000_000

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
