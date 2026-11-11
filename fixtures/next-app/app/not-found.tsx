import Link from 'next/link'

export default function NotFound() {
  return (
    <section>
      <h1 id="title">Page introuvable</h1>
      <Link href="/">Back home</Link>
    </section>
  )
}
