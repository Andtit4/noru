'use strict'
// Smoke test of the npm package: JS API + CLI on the React fixture.

const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const fixture = path.resolve(__dirname, '../../../fixtures/react-ts')
const noru = require('..')

async function main() {
  // JS API (async)
  const result = await noru.build({ root: fixture, outDir: 'dist-smoke' })
  assert.ok(result.moduleCount > 5, 'modules were bundled')
  const names = result.files.map((f) => f.fileName)
  assert.ok(names.includes('index.html'), 'index.html emitted')
  assert.ok(names.some((n) => /^assets\/index-[0-9a-f]{8}\.js$/.test(n)), 'hashed JS bundle emitted')
  assert.ok(names.some((n) => /^assets\/index-[0-9a-f]{8}\.css$/.test(n)), 'hashed CSS bundle emitted')
  for (const name of names) assert.ok(fs.existsSync(path.join(result.outDir, name)), `${name} written`)

  // Errors are reported as rejected promises
  await assert.rejects(noru.build({ root: path.join(fixture, 'src') }), /no index\.html/)

  // Sync API
  const sync = noru.buildSync({ root: fixture, outDir: 'dist-smoke', minify: false })
  assert.strictEqual(sync.files.length, result.files.length)

  // CLI
  const out = execFileSync(process.execPath, [path.join(__dirname, '../bin/noru.js'), 'build', fixture, '--out-dir', 'dist-smoke'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  assert.match(out, /modules transformed/)
  assert.match(out, /built in \d+ms/)

  // Preview server
  const server = await noru.preview({ root: fixture, outDir: 'dist-smoke', port: 0 })
  const html = await (await fetch(server.url)).text()
  assert.match(html, /<div id="root"><\/div>/)
  const spa = await fetch(new URL('/some/client/route', server.url))
  assert.strictEqual(spa.status, 200)
  await server.close()

  // `start` serves gzip + immutable cache headers for hashed assets
  const start = await noru.preview({ root: fixture, outDir: 'dist-smoke', port: 0 })
  const jsName = names.find((n) => n.endsWith('.js'))
  const asset = await fetch(new URL(jsName, start.url), { headers: { 'Accept-Encoding': 'gzip' } })
  assert.match(asset.headers.get('cache-control'), /immutable/)
  await start.close()

  // Dev server
  const dev = noru.startDevServer({ root: fixture, port: 0, log: false })
  assert.ok(dev.port > 0)
  const devHtml = await (await fetch(dev.url)).text()
  assert.match(devHtml, /@noru\/client\.js/)
  const devJs = await (await fetch(new URL('assets/index.js', dev.url))).text()
  assert.match(devJs, /__noru_require/)
  dev.close()

  fs.rmSync(path.join(fixture, 'dist-smoke'), { recursive: true, force: true })
  console.log(`✓ npm package smoke test passed (noru v${noru.version}, core v${noru.coreVersion})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
