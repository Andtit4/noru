'use client'
// noru play: <Playable> for React and Next.js. Shows a game (an iframe) with a loading screen until
// its first frame, and connects it to the page with `createHost`.

import * as React from 'react'
import { createHost } from './host.js'

const h = React.createElement

function DefaultLoading() {
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#0b0f14',
        color: '#8a96a6',
        font: '14px system-ui, sans-serif',
      },
    },
    h('div', { 'aria-label': 'Loading', role: 'status', className: 'noru-play-spinner' }),
    h('style', null, '.noru-play-spinner{width:36px;height:36px;border-radius:50%;border:3px solid #243041;border-top-color:#ff6b2c;animation:noru-play-spin .8s linear infinite}@keyframes noru-play-spin{to{transform:rotate(360deg)}}'),
  )
}

export const Playable = React.forwardRef(function Playable(props, ref) {
  const {
    src,
    title = 'Game',
    paused = false,
    muted = false,
    language,
    player,
    autoFocus = false,
    autoPause = true,
    storage,
    products,
    onPurchase,
    purchaseStore,
    onPurchaseConsumed,
    multiplayer,
    room,
    loading,
    aspectRatio = '16 / 9',
    className,
    style,
    allow = 'autoplay; fullscreen; gamepad; clipboard-write',
    sandbox = 'allow-scripts allow-same-origin allow-pointer-lock allow-popups',
    onConnect,
    onFirstFrame,
    onReady,
    onScore,
    onError,
    onWarning,
    onPause,
    onResume,
  } = props
  const iframe = React.useRef(null)
  const host = React.useRef(null)
  const [shown, setShown] = React.useState(false)
  const callbacks = {
    storage,
    products,
    onPurchase,
    purchaseStore,
    onPurchaseConsumed,
    multiplayer,
    room,
    autoFocus,
    onConnect: () => {
      setShown(false)
      if (onConnect) onConnect()
    },
    onFirstFrame: () => {
      setShown(true)
      if (onFirstFrame) onFirstFrame()
    },
    onReady,
    onScore,
    onError,
    onWarning,
    onPause,
    onResume,
  }

  React.useEffect(() => {
    if (!iframe.current) return undefined
    const created = createHost(iframe.current, { ...callbacks, autoPause, paused, audioEnabled: !muted, language, player })
    host.current = created
    return () => {
      created.destroy()
      host.current = null
    }
    // The host is created again only when the game or the auto-pause setting changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPause])

  // Latest callbacks and storage, without re-creating the host.
  React.useEffect(() => {
    if (host.current) host.current.setCallbacks(callbacks)
  })
  React.useEffect(() => {
    if (!host.current) return
    if (paused) host.current.pause()
    else host.current.resume()
  }, [paused])
  React.useEffect(() => {
    if (host.current) host.current.setAudio(!muted)
  }, [muted])
  React.useEffect(() => {
    if (host.current && language) host.current.setLanguage(language)
  }, [language])
  React.useEffect(() => {
    if (host.current) host.current.setPlayer(player)
  }, [player && player.name, player && player.avatar])

  React.useImperativeHandle(ref, () => ({
    pause: () => host.current && host.current.pause(),
    resume: () => host.current && host.current.resume(),
    get state() {
      return host.current ? host.current.state : null
    },
    get iframe() {
      return iframe.current
    },
  }))

  return h(
    'div',
    { className, style: Object.assign({ position: 'relative', width: '100%', aspectRatio, overflow: 'hidden' }, style) },
    h('iframe', {
      ref: iframe,
      src,
      title,
      allow,
      sandbox,
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block' },
    }),
    shown ? null : loading !== undefined ? loading : h(DefaultLoading),
  )
})

export default Playable
