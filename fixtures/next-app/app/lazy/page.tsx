'use client'

import dynamic from 'next/dynamic'

const Heavy = dynamic(() => import('@/components/Heavy'), {
  ssr: false,
  loading: () => <p id="lazy-loading">loading component...</p>,
})

export default function LazyPage() {
  return (
    <section>
      <h1 id="title">Lazy</h1>
      <Heavy label="dynamic works" />
    </section>
  )
}
