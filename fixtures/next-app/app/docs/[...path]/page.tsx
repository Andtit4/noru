'use client'

import { useParams } from 'next/navigation'

export default function Docs() {
  const params = useParams<{ path: string[] }>()
  return <h1 id="title">Docs: {params.path.join('/')}</h1>
}
