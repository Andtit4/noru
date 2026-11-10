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

  const server = http.createServer((req, res) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end('bad request')
      return
    }
    let file = path.join(dir, pathname)
    if (!file.startsWith(dir)) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
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
