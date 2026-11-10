// noru dev client: hot module updates (React Fast Refresh), CSS hot update, reloads and build
// error overlay.
const base = new URL('..', import.meta.url).pathname
let wasConnected = false
let overlay = null

function hideOverlay() {
  if (overlay) {
    overlay.remove()
    overlay = null
  }
}

function showOverlay(message) {
  hideOverlay()
  overlay = document.createElement('div')
  overlay.setAttribute('data-noru-overlay', '')
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.85);color:#e8e8e8;' +
    'font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:32px;overflow:auto'
  const box = document.createElement('div')
  box.style.cssText =
    'max-width:960px;margin:0 auto;background:#181818;border-top:4px solid #ff5555;border-radius:6px;padding:24px;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.5)'
  const title = document.createElement('div')
  title.textContent = 'noru — build error'
  title.style.cssText = 'color:#ff5555;font-weight:bold;font-size:15px;margin-bottom:12px'
  const pre = document.createElement('pre')
  pre.textContent = message
  pre.style.cssText = 'white-space:pre-wrap;margin:0'
  const hint = document.createElement('div')
  hint.textContent = 'Fix the error and save: the page will reload automatically. Click to dismiss.'
  hint.style.cssText = 'margin-top:16px;color:#888'
  box.append(title, pre, hint)
  overlay.append(box)
  overlay.addEventListener('click', hideOverlay)
  document.body.append(overlay)
}

function updateCss(version) {
  const link = document.querySelector('link[data-noru-css]')
  if (!link) return location.reload()
  const next = link.cloneNode()
  next.href = `${base}assets/index.css?v=${version}`
  next.addEventListener('load', () => link.remove())
  link.after(next)
}

// Hot updates are applied one after the other, in order.
let updates = Promise.resolve()
function hotUpdate(version) {
  updates = updates
    .then(() => import(`${base}@noru/update/${version}.js`))
    .catch((error) => {
      console.error('[noru] hot update failed, reloading', error)
      location.reload()
    })
}

const source = new EventSource(`${base}@noru/events`)
source.addEventListener('open', () => {
  // The server restarted: reload to get the fresh build.
  if (wasConnected) location.reload()
  wasConnected = true
})
source.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.type === 'reload') location.reload()
  else if (message.type === 'update') {
    hideOverlay()
    hotUpdate(message.version)
  } else if (message.type === 'css') {
    hideOverlay()
    updateCss(message.version)
  } else if (message.type === 'error') showOverlay(message.message)
})
console.debug('[noru] dev server connected')
