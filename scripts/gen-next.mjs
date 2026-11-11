#!/usr/bin/env node
// Generates a large Next.js App Router project (Tailwind CSS v4) to compare `next` and `noru`.
// Every page has its own components: `next dev` compiles a page the first time it is opened,
// noru bundles everything up-front.
//
// Usage: node scripts/gen-next.mjs [pages=50] [componentsPerPage=60] [outDir=bench/next-app]

import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pages = Number(process.argv[2] || 50)
const perPage = Number(process.argv[3] || 60)
const out = resolve(root, process.argv[4] || 'bench/next-app')
const count = pages * perPage

for (const dir of ['app', 'components', 'lib']) rmSync(join(out, dir), { recursive: true, force: true })
mkdirSync(join(out, 'components'), { recursive: true })
mkdirSync(join(out, 'lib'), { recursive: true })
const write = (file, content) => {
  mkdirSync(dirname(join(out, file)), { recursive: true })
  writeFileSync(join(out, file), content)
}

write(
  'package.json',
  JSON.stringify(
    {
      name: 'noru-bench-next-app',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
      dependencies: { next: '^16.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { '@tailwindcss/postcss': '^4.1.0', tailwindcss: '^4.1.0', typescript: '^5.6.0', '@types/react': '^19.0.0', '@types/node': '^22.0.0' },
    },
    null,
    2,
  ),
)
write('next.config.mjs', `/** @type {import('next').NextConfig} */\nexport default {}\n`)
write('postcss.config.mjs', `export default { plugins: { '@tailwindcss/postcss': {} } }\n`)
write(
  'tsconfig.json',
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2017',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: 'esnext',
        moduleResolution: 'bundler',
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'],
      exclude: ['node_modules'],
    },
    null,
    2,
  ),
)

write('app/globals.css', `@import "tailwindcss";\n`)

for (let u = 0; u < 20; u++) {
  write(
    `lib/util${u}.ts`,
    `export interface Item${u} { id: number; label: string }
export function format${u}(value: number): string {
  return value.toFixed(2).padStart(8, '0') + '-${u}'
}
export function makeItems${u}(n: number): Item${u}[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, label: 'item ' + i }))
}
`,
  )
}

for (let i = 0; i < count; i++) {
  const u = i % 20
  write(
    `components/Component${i}.tsx`,
    `'use client'

import { useMemo, useState } from 'react'
import { format${u}, makeItems${u} } from '@/lib/util${u}'

export function Component${i}({ seed = ${i} }: { seed?: number }) {
  const [count, setCount] = useState(0)
  const items = useMemo(() => makeItems${u}(3), [])
  return (
    <section className="rounded-lg border border-slate-200 p-[${(i % 24) + 2}px] shadow-sm" data-index={${i}}>
      <h3 className="font-semibold text-slate-800">Component ${i}</h3>
      <p className="text-sm text-slate-500">{format${u}(seed + count)}</p>
      <ul className="list-disc pl-4">
        {items.map((item) => (
          <li key={item.id}>{item.label}</li>
        ))}
      </ul>
      <button className="mt-1 rounded bg-indigo-600 px-2 text-white" onClick={() => setCount((c) => c + 1)}>
        +1
      </button>
    </section>
  )
}
`,
  )
}

const links = Array.from({ length: pages }, (_, p) => `          <Link href="/page-${p}">Page ${p}</Link>`).join('\n')
write(
  'app/layout.tsx',
  `import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = { title: 'Next benchmark (${count} components)' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white p-4">
        <nav className="mb-4 flex flex-wrap gap-2 text-sm text-indigo-700">
${links}
        </nav>
        {children}
      </body>
    </html>
  )
}
`,
)
write(
  'app/page.tsx',
  `export default function Home() {
  return <h1 id="marker-home" className="text-2xl font-bold">Home</h1>
}
`,
)
for (let p = 0; p < pages; p++) {
  const start = p * perPage
  const imports = []
  const uses = []
  for (let i = start; i < start + perPage; i++) {
    imports.push(`import { Component${i} } from '@/components/Component${i}'`)
    uses.push(`        <Component${i} />`)
  }
  write(
    `app/page-${p}/page.tsx`,
    `${imports.join('\n')}

export const metadata = { title: 'Page ${p}' }

export default function Page${p}() {
  return (
    <main>
      <h1 id="marker-page-${p}" className="text-xl font-bold">Page ${p}</h1>
      <div className="grid grid-cols-4 gap-2">
${uses.join('\n')}
      </div>
    </main>
  )
}
`,
  )
}

if (!existsSync(join(out, 'node_modules', 'next'))) {
  spawnSync('npm install --no-audit --no-fund', { cwd: out, stdio: 'inherit', shell: true })
}
console.log(`generated a Next.js app with ${pages} pages and ${count} components in ${out}`)
