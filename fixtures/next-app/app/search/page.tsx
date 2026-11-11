import { use } from 'react'
import { SearchBox } from '@/components/SearchBox'

export default function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = use(searchParams)
  return (
    <section>
      <h1 id="title">Search</h1>
      <p id="query-prop">{q}</p>
      <SearchBox />
    </section>
  )
}
