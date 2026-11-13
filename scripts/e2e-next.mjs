#!/usr/bin/env node
// End-to-end test of Next.js App Router projects (fixtures/next-app) in a real browser:
// the production build (served by `noru preview`) and the dev server (hot updates).
//
// Usage: node scripts/e2e-next.mjs [path/to/noru-binary]

import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { findBrowser, killTree, launchBrowser, sleep } from './lib/browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const exe = process.platform === 'win32' ? '.exe' : ''
const noru = process.argv[2] || process.env.NORU_BIN || join(root, 'target', 'release', `noru${exe}`)
const fixture = join(root, 'fixtures', 'next-app')

const failures = []
const check = (name, condition, details = '') => {
  console.log(`${condition ? '✓' : '✗'} ${name}${condition || !details ? '' : `  (${details})`}`)
  if (!condition) failures.push(name)
}

const text = (id) => `document.getElementById('${id}')?.textContent`
const title = text('title')
const click = (id) => `document.getElementById('${id}').click()`

function startServer(args) {
  const server = spawn(noru, args, { env: { ...process.env, NO_COLOR: '1' } })
  const state = { server, logs: '' }
  server.stdout.on('data', (d) => (state.logs += d))
  server.stderr.on('data', (d) => (state.logs += d))
  return state
}

async function waitForLog(state, needle) {
  for (let i = 0; i < 200 && !state.logs.includes(needle); i++) await sleep(50)
  return state.logs.includes(needle)
}

/** The app itself: routing, layouts, server components, boundaries, next/* modules. */
async function testApp(page, base, label) {
  console.log(`\n— ${label}`)
  await page.navigate(`${base}/`)
  check('home page renders inside the root layout', await page.waitFor(`${title} === 'Home page' && !!document.getElementById('nav')`))
  check('<html lang> and attributes come from the root layout', await page.evaluate(`document.documentElement.lang === 'fr' && document.documentElement.dataset.rootLayout === 'yes'`))
  check('metadata: default title', await page.waitFor(`document.title === 'Fixture'`), await page.evaluate('document.title'))
  check('metadata: description', await page.evaluate(`document.querySelector('meta[name=description]')?.content === 'noru Next.js fixture'`))
  check('NEXT_PUBLIC_ variables are inlined', (await page.evaluate(text('greeting'))) === 'hello from next env')
  check('other process.env variables are undefined', (await page.evaluate(text('secret'))) === 'undefined')
  check('Tailwind CSS classes are generated', await page.evaluate(`getComputedStyle(document.getElementById('title')).color === 'rgb(10, 20, 30)'`))
  check('global CSS from the layout is applied', await page.evaluate(`getComputedStyle(document.getElementById('brand')).borderTopWidth === '2px'`))
  check('next/font/google: variable class on <body>', await page.evaluate(`[...document.body.classList].some((c) => c.startsWith('__noru_font_var_geist')) && document.body.classList.contains('antialiased')`))
  check('next/font/google: stylesheet requested', await page.evaluate(`!!document.querySelector('link[href^="https://fonts.googleapis.com/css2?family=Geist"]')`))
  check('next/image renders an <img>', await page.evaluate(`document.getElementById('logo')?.tagName === 'IMG' && document.getElementById('logo').getAttribute('src') === '/logo.svg'`))

  await page.evaluate(`${click('counter')}; ${click('counter')}`)
  check('client component state', await page.waitFor(`${text('counter')} === 'count is 2'`))
  await page.evaluate(`window.__noruMarker = 'kept'`)

  await page.evaluate(click('link-about'))
  check('next/link: client-side navigation to a route group page', await page.waitFor(`${title} === 'About page'`))
  check('  … without reloading the page', await page.evaluate(`window.__noruMarker === 'kept'`))
  check('  … usePathname()', (await page.evaluate(text('pathname'))) === '/about')
  check('  … nested layout of the route group', await page.evaluate(`!!document.getElementById('marketing-layout')`))
  check('  … metadata title template', await page.waitFor(`document.title === 'About | Fixture'`), await page.evaluate('document.title'))

  await page.evaluate(click('link-post'))
  check('async server component: loading.tsx while it loads', await page.waitFor(`!!document.getElementById('loading')`, 3000))
  check('  … then its content, with params', await page.waitFor(`${title} === 'Post: hello-world'`))
  check('  … generateMetadata()', await page.waitFor(`document.title === 'Blog hello-world | Fixture'`), await page.evaluate('document.title'))

  await page.evaluate('history.back()')
  check('browser back button', await page.waitFor(`${title} === 'About page'`))

  await page.evaluate(click('link-search'))
  check('searchParams prop (with use())', await page.waitFor(`${text('query-prop')} === 'noru'`))
  check('useSearchParams()', (await page.evaluate(text('query-hook'))) === 'noru')
  await page.evaluate(click('search-other'))
  check('router.push() updates search params', await page.waitFor(`${text('query-hook')} === 'rust' && ${text('query-prop')} === 'rust'`))

  await page.evaluate(click('link-dashboard'))
  check('nested layout: useSelectedLayoutSegment() at the index', await page.waitFor(`${title} === 'Dashboard' && ${text('segment')} === 'none'`))
  await page.evaluate(click('link-settings'))
  check('  … and on a child page', await page.waitFor(`${title} === 'Settings' && ${text('segment')} === 'settings'`))
  check('  … still no page reload', await page.evaluate(`window.__noruMarker === 'kept'`))

  await page.navigate(`${base}/docs/getting/started/install`)
  check('catch-all route + useParams()', await page.waitFor(`${title} === 'Docs: getting/started/install'`))

  await page.navigate(`${base}/broken`)
  check('error.tsx catches render errors', await page.waitFor(`${text('error')} === 'Something went wrong: boom'`))
  await page.evaluate(click('retry'))
  check('  … and reset() renders the page again', await page.waitFor(`${title} === 'Recovered'`))

  await page.navigate(`${base}/old`)
  check('redirect()', await page.waitFor(`location.pathname === '/about' && ${title} === 'About page'`))

  await page.navigate(`${base}/does/not/exist`)
  check('unknown URL: not-found.tsx inside the root layout', await page.waitFor(`${title} === 'Page introuvable' && !!document.getElementById('nav')`))
  await page.navigate(`${base}/blog/missing`)
  check('notFound() from a server component', await page.waitFor(`${title} === 'Page introuvable'`))

  await page.navigate(`${base}/lazy`)
  check('next/dynamic', await page.waitFor(`${text('heavy')} === 'dynamic works'`))

  await page.navigate(`${base}/`)
  await page.waitFor(`${title} === 'Home page'`)
  await page.evaluate(click('link-suspend'))
  check(
    'client-side navigation to a page that suspends (no loading.tsx)',
    await page.waitFor(`${text('heavy')} === 'lazy page without suspense' && !document.querySelector('[data-noru-app-error]')`),
  )

  // Middleware and route handlers, run by Node.js.
  const hello = await (await fetch(`${base}/api/hello?name=noru`, { headers: { cookie: 'mw-visited=yes' } })).json()
  check('route handler GET (searchParams)', hello.hello === 'noru', JSON.stringify(hello))
  check('  … sees server-side .env variables', hello.secret === 'do-not-leak')
  check('  … cookies() and headers() from next/headers', hello.visited === 'yes' && hello.agent === true)
  const posted = await fetch(`${base}/api/hello`, { method: 'POST', body: JSON.stringify({ a: 1 }), headers: { 'content-type': 'application/json' } })
  const postedBody = await posted.json().catch(() => ({}))
  check('route handler POST with a JSON body', posted.status === 201 && postedBody.received?.a === 1, `${posted.status} ${JSON.stringify(postedBody)}`)
  const postedCookies = posted.headers.getSetCookie()
  check('  … response cookies (NextResponse and cookies().set)', postedCookies.some((c) => c.startsWith('posted=yes')) && postedCookies.some((c) => c.startsWith('via-headers=yes')), postedCookies.join(' | '))
  check('dynamic route handler params', (await (await fetch(`${base}/api/items/42`)).json()).id === '42')
  check('method without a handler: 405', (await fetch(`${base}/api/items/42`, { method: 'DELETE' })).status === 405)
  const redirected = await fetch(`${base}/mw-redirect`, { redirect: 'manual' })
  check('middleware redirect', redirected.status === 307 && (redirected.headers.get('location') || '').endsWith('/about'), `${redirected.status} ${redirected.headers.get('location')}`)
  const blocked = await fetch(`${base}/mw-blocked`)
  check('middleware response', blocked.status === 403 && (await blocked.text()) === 'blocked by middleware')
  const homeResponse = await fetch(`${base}/`)
  check(
    'NextResponse.next() with headers and cookies',
    homeResponse.headers.get('x-noru-middleware') === 'ran' && homeResponse.headers.getSetCookie().some((c) => c.startsWith('mw-visited=yes')),
  )
  await page.navigate(`${base}/mw-rewrite`)
  check('middleware rewrite: another page under the same URL', await page.waitFor(`${title} === 'Dashboard' && location.pathname === '/mw-rewrite'`))
  await page.navigate(`${base}/`)
  await page.waitFor(`${title} === 'Home page'`)
  await page.evaluate(click('link-mw-redirect'))
  check('client-side navigation goes through the middleware', await page.waitFor(`location.pathname === '/about' && ${title} === 'About page'`))

  const errors = page.takeErrors().filter((e) => !/boom|The above error occurred|React will try to recreate|fonts\.googleapis/i.test(e))
  check('no unexpected errors in the browser console', errors.length === 0, errors.slice(0, 3).join(' | '))
}

async function testBuild(browserPath) {
  const temp = mkdtempSync(join(tmpdir(), 'noru-next-dist-'))
  const out = join(temp, 'dist') // does not exist yet: noru only empties output dirs inside the project
  try {
    const build = spawnSync(noru, ['build', fixture, '--out-dir', out], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
    check('noru build on a Next.js app', build.status === 0, (build.stdout + build.stderr).slice(-800))
    if (build.status !== 0) return
    const port = 4600 + Math.floor(Math.random() * 300)
    const preview = startServer(['preview', fixture, '--out-dir', out, '--port', String(port)])
    try {
      await waitForLog(preview, 'Local')
      const page = await launchBrowser(browserPath)
      try {
        await testApp(page, `http://127.0.0.1:${port}`, 'production build (noru build + noru preview)')
      } finally {
        page.close()
      }
    } finally {
      killTree(preview.server)
    }
  } finally {
    await sleep(200)
    rmSync(temp, { recursive: true, force: true })
  }
}

async function testDev(browserPath) {
  const project = mkdtempSync(join(tmpdir(), 'noru-next-dev-'))
  cpSync(fixture, project, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)$/.test(src) })
  // Share the fixture's dependencies instead of copying them.
  spawnSync(process.platform === 'win32' ? 'cmd' : 'ln', process.platform === 'win32' ? ['/c', 'mklink', '/J', join(project, 'node_modules'), join(fixture, 'node_modules')] : ['-s', join(fixture, 'node_modules'), join(project, 'node_modules')])
  const file = (rel) => join(project, ...rel.split('/'))
  const edit = (rel, change) => writeFileSync(file(rel), change(readFileSync(file(rel), 'utf8')))

  const port = 3900 + Math.floor(Math.random() * 300)
  const dev = startServer(['dev', project, '--port', String(port)])
  let page
  try {
    check('noru dev starts on a Next.js app', await waitForLog(dev, 'Local'), dev.logs)
    check('  … and says it is a Next.js app', dev.logs.includes('Next.js app (app/'), dev.logs)
    const base = `http://127.0.0.1:${port}`
    page = await launchBrowser(browserPath)
    await testApp(page, base, 'dev server (noru dev)')

    console.log('\n— hot reload')
    await page.navigate(`${base}/`)
    await page.waitFor(`${title} === 'Home page'`)
    await page.evaluate(`${click('counter')}; ${click('counter')}; ${click('counter')}`)
    await page.waitFor(`${text('counter')} === 'count is 3'`)
    await page.evaluate(`window.__noruMarker = 'kept'`)

    edit('components/Counter.tsx', (s) => s.replace('count is {count}', 'clicks: {count}'))
    check('editing a client component: hot update', await page.waitFor(`${text('counter')} === 'clicks: 3'`), dev.logs.split('\n').slice(-3).join(' | '))
    check('  … state kept, no reload', await page.evaluate(`window.__noruMarker === 'kept'`))

    edit('app/page.tsx', (s) => s.replace('Home page', 'Home edited'))
    check('editing a page: hot update', await page.waitFor(`${title} === 'Home edited'`))
    check('  … state of its children kept, no reload', (await page.evaluate(text('counter'))) === 'clicks: 3' && (await page.evaluate(`window.__noruMarker === 'kept'`)))

    edit('app/page.tsx', (s) => s.replace('text-[rgb(10,20,30)]', 'text-[rgb(200,30,40)]'))
    check('new Tailwind class in a component: CSS regenerated', await page.waitFor(`getComputedStyle(document.getElementById('title')).color === 'rgb(200, 30, 40)'`), dev.logs.split('\n').slice(-3).join(' | '))
    check('  … without reloading the page', await page.evaluate(`window.__noruMarker === 'kept'`))

    edit('app/(marketing)/layout.tsx', (s) => s.replace("title: 'About'", "title: 'About us'"))
    await sleep(300)
    check('editing a layout with a metadata export: no reload', await page.evaluate(`window.__noruMarker === 'kept'`))

    mkdirSync(file('app/contact'), { recursive: true })
    writeFileSync(file('app/contact/page.tsx'), `export default function Contact() {\n  return <h1 id="title">Contact page</h1>\n}\n`)
    await sleep(500)
    await page.evaluate(`window.history.pushState(null, '', '/contact'); window.dispatchEvent(new PopStateEvent('popstate'))`)
    check('a new page file becomes a route', await page.waitFor(`${title} === 'Contact page'`), dev.logs.split('\n').slice(-3).join(' | '))
  } finally {
    page?.close()
    killTree(dev.server)
    await sleep(300)
    rmSync(project, { recursive: true, force: true })
  }
  return dev.logs
}

/** Next.js 14 apps use React 18, which fails when a navigation that suspends is not a transition. */
async function testReact18(browserPath) {
  console.log('\n— React 18')
  const project = mkdtempSync(join(tmpdir(), 'noru-next-react18-'))
  cpSync(fixture, project, { recursive: true, filter: (src) => !/[\\/](dist|node_modules)$/.test(src) })
  const pkg = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
  pkg.dependencies.react = '^18.3.1'
  pkg.dependencies['react-dom'] = '^18.3.1'
  writeFileSync(join(project, 'package.json'), JSON.stringify(pkg, null, 2))
  spawnSync('npm install --no-audit --no-fund --loglevel=error', { cwd: project, stdio: 'inherit', shell: true })
  const port = 4300 + Math.floor(Math.random() * 300)
  const dev = startServer(['dev', project, '--port', String(port)])
  let page
  try {
    await waitForLog(dev, 'Local')
    page = await launchBrowser(browserPath)
    const base = `http://127.0.0.1:${port}`
    await page.navigate(`${base}/`)
    check('React 18: home page renders', await page.waitFor(`${title} === 'Home page'`))
    await page.evaluate(click('link-suspend'))
    check(
      'React 18: client-side navigation to a page that suspends',
      await page.waitFor(`${text('heavy')} === 'lazy page without suspense' && !document.querySelector('[data-noru-app-error]')`),
      await page.evaluate(`document.querySelector('[data-noru-app-error] pre')?.textContent.split('\\n')[0]`),
    )
    await page.evaluate(click('link-about'))
    check('React 18: usePathname() after a client-side navigation', await page.waitFor(`${text('pathname')} === '/about'`))
  } finally {
    page?.close()
    killTree(dev.server)
    await sleep(300)
    rmSync(project, { recursive: true, force: true })
  }
}

async function main() {
  const browserPath = findBrowser()
  if (!existsSync(noru) || !browserPath) {
    console.error(!browserPath ? 'no Chrome/Edge found' : `noru binary not found at ${noru}`)
    process.exit(1)
  }
  if (!existsSync(join(fixture, 'node_modules'))) {
    spawnSync('npm install --no-audit --no-fund', { cwd: fixture, stdio: 'inherit', shell: true })
  }
  await testBuild(browserPath)
  const devLogs = await testDev(browserPath)
  await testReact18(browserPath)

  if (failures.length) {
    console.log(`\n${failures.length} Next.js check(s) failed\n--- dev server logs ---\n${devLogs}`)
    process.exit(1)
  }
  console.log('\nall Next.js tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
