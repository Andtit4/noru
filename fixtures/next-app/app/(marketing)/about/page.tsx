'use client'

import { usePathname } from 'next/navigation'

export default function About() {
  const pathname = usePathname()
  return (
    <section>
      <h1 id="title">About page</h1>
      <p id="pathname">{pathname}</p>
    </section>
  )
}
