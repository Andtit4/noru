'use strict'

// `noru preview`: serves the build output with a SPA fallback (client-side routes -> index.html).
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
}

/** Next.js middleware and route handlers of the build (dist/server/), run in this process. */
function loadServerCode(root, dir) {
  const app = path.join(dir, 'server', 'app.js')
  if (!fs.existsSync(app)) return null
  const { createNoruServerRuntime } = require(path.join(dir, 'server', 'runtime.js'))
  const runtime = createNoruServerRuntime({ root, mode: 'production' })
  runtime.load(fs.readFileSync(app, 'utf8'))
  return runtime
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function headerObject(pairs) {
  const headers = {}
  for (const [name, value] of pairs) {
    const key = name.toLowerCase()
    if (key === 'content-length' || key === 'transfer-encoding' || key === 'connection' || key === 'content-encoding') continue
    if (headers[key] === undefined) headers[key] = value
    else headers[key] = [].concat(headers[key], value)
  }
  return headers
}

function sendPage(res, req, dir, rewrite, extraHeaders) {
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
  if (rewrite) {
    const value = JSON.stringify(rewrite).replace(/<\//g, '<\\/')
    html = html.replace('  </head>', `    <script>window.__NORU_REWRITE__ = ${value}</script>\n  </head>`)
  }
  const headers = Object.assign(headerObject(extraHeaders), { 'content-type': MIME['.html'], 'cache-control': 'no-cache' })
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : html)
}

/** `/@noru/middleware?url=/path`: what the middleware says about a client-side navigation. */
async function middlewareEndpoint(runtime, req, res) {
  const query = new URL(req.url, 'http://localhost').searchParams.get('url') || '/'
  const target = query.startsWith('/') ? query : '/'
  const headers = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push([req.rawHeaders[i], req.rawHeaders[i + 1]])
  const answer = await runtime.middlewareOnly({ method: 'GET', url: `http://${req.headers.host || 'localhost'}${target}`, headers })
  const cookies = answer.headers.filter(([name]) => name.toLowerCase() === 'set-cookie')
  res.writeHead(200, Object.assign(headerObject(cookies), { 'content-type': 'application/json', 'cache-control': 'no-store' }))
  res.end(JSON.stringify({ action: answer.action, location: answer.location, rewrite: answer.rewrite }))
}

/** Middleware, then route handler; serves the page when they let it through. */
async function handleWithServerCode(runtime, req, res, dir, pathname) {
  const body = await readBody(req)
  const headers = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push([req.rawHeaders[i], req.rawHeaders[i + 1]])
  const answer = await runtime.handle({
    method: req.method,
    url: `http://${req.headers.host || 'localhost'}${req.url}`,
    headers,
    body: body.length ? body.toString('base64') : undefined,
  })
  if (answer.action === 'redirect') {
    res.writeHead(answer.status, Object.assign(headerObject(answer.headers), { location: answer.location }))
    res.end()
  } else if (answer.action === 'response') {
    res.writeHead(answer.status, headerObject(answer.headers))
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(answer.body || '', 'base64'))
  } else {
    const target = answer.rewrite ? answer.rewrite.split('?')[0] : pathname
    if (target !== '/' && path.extname(target) !== '') res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    else sendPage(res, req, dir, answer.rewrite, answer.headers)
  }
}

/**
 * @param {{ root?: string, outDir?: string, port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function preview(options = {}) {
  const root = path.resolve(options.root || '.')
  const dir = path.resolve(root, options.outDir || 'dist')
  const host = options.host || '127.0.0.1'
  const port = options.port ?? 4173
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    return Promise.reject(new Error(`no build found in ${dir} — run \`noru build\` first`))
  }
  let runtime
  try {
    runtime = loadServerCode(root, dir)
  } catch (error) {
    return Promise.reject(error)
  }

  const server = http.createServer((req, res) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('bad request')
      return
    }
    let file = path.join(dir, pathname)
    // The server code of the build (dist/server/) is never sent to browsers.
    if (!file.startsWith(dir) || pathname.startsWith('/server/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    const isStatic = fs.existsSync(file) && path.basename(file) !== 'index.html' && (req.method === 'GET' || req.method === 'HEAD')
    if (runtime && !isStatic) {
      const work = pathname === '/@noru/middleware' ? middlewareEndpoint(runtime, req, res) : handleWithServerCode(runtime, req, res, dir, pathname)
      work.catch((error) => {
        console.error(`[noru] error in the middleware / route handler for ${req.url}:\n${error && error.stack}`)
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      })
      return
    }
    if (!fs.existsSync(file)) {
      // SPA fallback for paths without an extension.
      if (path.extname(pathname) === '') file = path.join(dir, 'index.html')
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
        return
      }
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const headers = {
      'Content-Type': type,
      // Files in assets/ have a content hash in their name: they can be cached forever.
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    }
    const compressible = /^text\/|javascript|json|svg|manifest/.test(type)
    const gzip = compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    if (gzip) {
      headers['Content-Encoding'] = 'gzip'
      headers['Vary'] = 'Accept-Encoding'
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') res.end()
    else if (gzip) fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res)
    else fs.createReadStream(file).pipe(res)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      resolve({
        url: `http://${host}:${address.port}/`,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

module.exports = { preview }
