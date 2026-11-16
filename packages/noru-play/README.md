# noru play

**Embed web games in your website — Next.js, React or plain HTML.** A tiny SDK for games (≈2 kB compressed)
and a host for pages: loading screen, pause when the game is not visible, sound on / off, saves,
scores, language. No dependencies.

```bash
npm install noru-play
```

A game is a small web app (built with [noru](https://www.npmjs.com/package/noru-bundler) or any
bundler) served from your site, e.g. `public/games/cloud-acres/`. The page shows it with `<Playable>`;
the game talks to the page with `play`.

## In the game

```js
import { play } from 'noru-play'

play.firstFrameReady()          // the first frame is on screen: the host removes its loading screen
play.gameReady()                // the player can play

play.onPause(() => game.pause())           // tab hidden, game scrolled out of view, host button...
play.onResume(() => game.resume())
play.onAudioChange((on) => game.setSound(on))

await play.save({ level: 3, best: 1200 })  // any JSON value, up to 1 MB
const progress = await play.load()          // or null
await play.sendScore(1200)

play.language       // "fr", "en"... (from the host, else the browser)
play.player         // { name, avatar } of the user logged in on the website, or null
play.inHost         // false when the game is opened on its own
play.logError(err)  // uncaught errors are reported automatically
```

Opened on its own (in development, for example), the game works **standalone**: saves go to
`localStorage` and scores to the console.

## In a Next.js / React page

```tsx
import { Playable } from 'noru-play/react'

export default function GamePage() {
  return (
    <Playable
      src="/games/cloud-acres/"
      title="Cloud Acres"
      player={{ name: user.name, avatar: user.image }}
      aspectRatio="16 / 9"
      onScore={(score) => fetch('/api/scores', { method: 'POST', body: JSON.stringify({ score }) })}
      storage={{
        load: () => fetch('/api/save').then((r) => r.json()),
        save: (data) => fetch('/api/save', { method: 'POST', body: JSON.stringify(data) }).then(() => {}),
      }}
    />
  )
}
```

| Prop | Default | |
| --- | --- | --- |
| `src` | — | URL of the game |
| `storage` | `localStorage` | where saves go: `{ load(), save(data) }` (your API, a database...) |
| `onScore(score)` | — | a score from the game; throw / reject to refuse it |
| `onReady`, `onFirstFrame`, `onError`, `onWarning`, `onPause`, `onResume` | — | events |
| `paused`, `muted` | `false` | control the game from the page |
| `autoPause` | `true` | pause when the tab is hidden or the game is less than 25 % visible |
| `language` | browser language | given to the game |
| `player` | — | the logged-in user `{ name, avatar }`, shown by the game (picture: same website or `data:` URL) |
| `loading` | spinner | shown until the first frame |
| `aspectRatio` | `"16 / 9"` | size of the game box (CSS aspect-ratio) |
| `sandbox`, `allow` | sensible defaults | iframe attributes |

A ref gives `pause()`, `resume()` and `state`.

## Without React

```js
import { createHost } from 'noru-play/host'

const host = createHost(document.querySelector('iframe'), {
  onScore: (score) => console.log(score),
})
host.pause()
host.setAudio(false)
host.destroy()
```

## Security

- Messages are only accepted from the game's iframe and its origin; by default a game only accepts
  a host from its **own origin** (same website). `play.configure({ allowedOrigins: [...] })` to
  allow others.
- The game runs in a sandboxed iframe. Saves over 1 MB and non-numeric scores are refused.
- Games and site on the same origin share cookies: only embed games you trust (your own).

MIT
