'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function SearchBox() {
  const searchParams = useSearchParams()
  const router = useRouter()
  return (
    <div>
      <p id="query-hook">{searchParams.get('q')}</p>
      <button id="search-other" type="button" onClick={() => router.push('/search?q=rust')}>
        search rust
      </button>
    </div>
  )
}
