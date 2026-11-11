import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'About' }

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div id="marketing-layout">{children}</div>
}
