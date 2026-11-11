import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: { default: 'Fixture', template: '%s | Fixture' },
  description: 'noru Next.js fixture',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" data-root-layout="yes">
      <body className={`${geist.variable} antialiased`}>
        <nav id="nav" className="flex gap-3 p-2">
          <Link href="/">Home</Link>
          <Link href="/about" id="link-about">
            About
          </Link>
          <Link href="/blog/hello-world" id="link-post">
            Post
          </Link>
          <Link href={{ pathname: '/search', query: { q: 'noru' } }} id="link-search">
            Search
          </Link>
          <Link href="/dashboard" id="link-dashboard">
            Dashboard
          </Link>
        </nav>
        <main id="main">{children}</main>
      </body>
    </html>
  )
}
