'use client'

import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button id="counter" type="button" onClick={() => setCount((c) => c + 1)}>
      count is {count}
    </button>
  )
}
