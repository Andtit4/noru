'use client'

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p id="error">Something went wrong: {error.message}</p>
      <button
        id="retry"
        type="button"
        onClick={() => {
          ;(globalThis as { __fixed?: boolean }).__fixed = true
          reset()
        }}
      >
        Try again
      </button>
    </div>
  )
}
