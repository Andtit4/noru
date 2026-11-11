'use client'

export default function Broken() {
  if (!(globalThis as { __fixed?: boolean }).__fixed) throw new Error('boom')
  return <h1 id="title">Recovered</h1>
}
