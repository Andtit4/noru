#!/usr/bin/env node
// Generates a large React + TypeScript app to benchmark noru (and compare with other tools).
//
// Usage: node scripts/gen-large.mjs [componentCount=5000] [outDir=bench/large-app]

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const count = Number(process.argv[2] || 5000)
const out = resolve(root, process.argv[3] || 'bench/large-app')
const perPage = 50
const pages = Math.ceil(count / perPage)

if (existsSync(join(out, 'src'))) rmSync(join(out, 'src'), { recursive: true, force: true })
mkdirSync(join(out, 'src', 'components'), { recursive: true })
mkdirSync(join(out, 'src', 'views'), { recursive: true })
mkdirSync(join(out, 'src', 'utils'), { recursive: true })

const write = (file, content) => writeFileSync(join(out, file), content)

if (!existsSync(join(out, 'package.json'))) {
  write(
    'package.json',
    JSON.stringify(
      {
        name: 'noru-bench-large-app',
        private: true,
        type: 'module',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      },
      null,
      2,
    ),
  )
}
write(
  'index.html',
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Large app (${count} components)</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
)

for (let u = 0; u < 20; u++) {
  write(
    `src/utils/util${u}.ts`,
    `export interface Item${u} { id: number; label: string; tags: string[] }
export function format${u}(value: number): string {
  return value.toFixed(2).padStart(8, '0') + '-${u}'
}
export function makeItems${u}(n: number): Item${u}[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: 'item ' + i, tags: ['a', 'b'] }))
}
export const CONSTANT_${u} = ${u * 7}
`,
  )
}

for (let i = 0; i < count; i++) {
  const u = i % 20
  const withCss = i % 10 === 0
  if (withCss) {
    write(
      `src/components/Component${i}.module.css`,
      `.root { padding: ${i % 16}px; border: 1px solid #ccc; }
.title { font-weight: bold; color: #${(i * 4567).toString(16).padStart(6, '0').slice(0, 6)}; }
`,
    )
  }
  write(
    `src/components/Component${i}.tsx`,
    `import { useState, useMemo } from 'react'
import { format${u}, makeItems${u}, CONSTANT_${u}, type Item${u} } from '../utils/util${u}'
${withCss ? `import styles from './Component${i}.module.css'\n` : ''}
interface Props {
  seed?: number
  title?: string
}

export function Component${i}({ seed = ${i}, title = 'Component ${i}' }: Props) {
  const [count, setCount] = useState(0)
  const items: Item${u}[] = useMemo(() => makeItems${u}(3), [])
  const total = useMemo(() => items.reduce((sum, item) => sum + item.id, seed + CONSTANT_${u}), [items, seed])
  return (
    <section${withCss ? ' className={styles.root}' : ''} data-index={${i}}>
      <h3${withCss ? ' className={styles.title}' : ''}>{title}</h3>
      <p>{format${u}(total + count)}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
      <button onClick={() => setCount((c) => c + 1)}>+1</button>
    </section>
  )
}

export default Component${i}
`,
  )
}

for (let p = 0; p < pages; p++) {
  const start = p * perPage
  const end = Math.min(count, start + perPage)
  const imports = []
  const uses = []
  for (let i = start; i < end; i++) {
    imports.push(`import { Component${i} } from '../components/Component${i}'`)
    uses.push(`      <Component${i} />`)
  }
  write(
    `src/views/Page${p}.tsx`,
    `${imports.join('\n')}

export default function Page${p}() {
  return (
    <div>
${uses.join('\n')}
    </div>
  )
}
`,
  )
}

const pageImports = Array.from({ length: pages }, (_, p) => `import Page${p} from './views/Page${p}'`).join('\n')
const pageList = Array.from({ length: pages }, (_, p) => `Page${p}`).join(', ')
// The App component lives in its own module so that other frameworks (e.g. Next.js) can reuse it.
write(
  'src/App.tsx',
  `import { useState } from 'react'
${pageImports}

const pages = [${pageList}]

export default function App() {
  const [index, setIndex] = useState(0)
  const Page = pages[index]
  return (
    <main>
      <nav>
        {pages.map((_, i) => (
          <button key={i} onClick={() => setIndex(i)}>
            Page {i}
          </button>
        ))}
      </nav>
      <Page />
    </main>
  )
}
`,
)
write(
  'src/main.tsx',
  `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
)

if (!existsSync(join(out, 'node_modules', 'react'))) {
  spawnSync('npm install --no-audit --no-fund', { cwd: out, stdio: 'inherit', shell: true })
}
console.log(`generated ${count} components, ${pages} pages, 20 utils in ${out}`)
