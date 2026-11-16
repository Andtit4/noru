// node test/protocol.test.js — the browser parts are tested by scripts/e2e-play.mjs.
import assert from 'node:assert/strict'
import { MAX_SAVE_BYTES, isMessage, jsonSize, message } from '../protocol.js'

assert.deepEqual(message('save', { a: 1 }, 3), { source: 'noru-play', v: 1, type: 'save', id: 3, payload: { a: 1 } })
assert.deepEqual(message('hello'), { source: 'noru-play', v: 1, type: 'hello' })
assert.ok(isMessage(message('pause')))
assert.ok(!isMessage({ type: 'pause' }))
assert.ok(!isMessage(null))
assert.equal(jsonSize({ name: 'é' }), JSON.stringify({ name: 'é' }).length + 1)
assert.equal(jsonSize(undefined), 0)
assert.equal(MAX_SAVE_BYTES, 1_000_000)
const sdk = await import('../index.js')
assert.equal(typeof sdk.play.save, 'function')
console.log('✓ noru-play protocol tests passed')
