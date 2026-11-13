'use client'

import { lazy } from 'react'

// Suspends while loading, with no loading.tsx and no <Suspense> around it: a client-side
// navigation to this page must wait for it (React 18 fails if the update is not a transition).
const Heavy = lazy(() => import('@/components/Heavy'))

export default function SuspendPage() {
  return <Heavy label="lazy page without suspense" />
}
