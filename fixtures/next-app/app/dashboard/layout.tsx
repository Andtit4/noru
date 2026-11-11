'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment()
  return (
    <div id="dashboard-layout">
      <p id="segment">{segment ?? 'none'}</p>
      <Link href="/dashboard/settings" id="link-settings">
        Settings
      </Link>
      {children}
    </div>
  )
}
