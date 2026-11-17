# noru play

**Embed web games in your website — Next.js, React or plain HTML.** A tiny SDK for games and a host
for pages: loading screen, pause when the game is not visible, sound on / off, saves, scores,
language, **things sold by your website** (coins...) and **multiplayer rooms**. No dependencies.

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
| `autoFocus` | `false` | give the keyboard focus to the game once it is shown (keyboard games) |
| `autoPause` | `true` | pause when the tab is hidden or the game is less than 25 % visible |
| `language` | browser language | given to the game |
| `player` | — | the logged-in user `{ name, avatar }`, shown by the game (picture: same website or `data:` URL) |
| `loading` | spinner | shown until the first frame |
| `aspectRatio` | `"16 / 9"` | size of the game box (CSS aspect-ratio) |
| `products`, `onPurchase(product)`, `purchaseStore` | — | sell things in the game, see below |
| `multiplayer`, `room(name)` | — | multiplayer rooms, see below |
| `sandbox`, `allow` | sensible defaults | iframe attributes |

A ref gives `pause()`, `resume()` and `state`.

## Selling things in a game (coins, packs...)

**The website takes the payment, the game delivers.** The game never sees a card or a mobile money
account: it asks, the page runs its own checkout and answers.

```tsx
<Playable
  src="/games/cloud-acres/"
  products={[
    { id: 'coins-500', title: '500 coins', price: '500 FCFA', coins: 500 },
    { id: 'coins-2000', title: '2 000 coins', price: '1 500 FCFA', coins: 2000 },
  ]}
  onPurchase={async (product) => {
    const paid = await myCheckout(product)       // your payment (card, mobile money...)
    return paid ? { purchaseId: paid.id } : null // truthy: paid; null / false: cancelled
  }}
/>
```

```js
// In the game
if (play.canPurchase) {
  const products = await play.getProducts()
  const purchase = await play.purchase('coins-500') // null if the player cancelled
  if (purchase) {
    coins += purchase.product.coins
    await play.save(progress)                      // save first...
    await play.consumePurchase(purchase.purchaseId) // ...then mark it as given
  }
}
// At start: purchases paid while the game was closing
for (const purchase of await play.getPendingPurchases()) { /* give, save, consume */ }
```

A paid purchase stays **pending** until the game consumes it, so a player never loses what they paid
for if the game closes at the wrong moment (default store: `localStorage`; with accounts, give a
`purchaseStore` `{ list(), add(purchase), remove(purchaseId) }` backed by your server). Keep the
purchase id in the save to never give it twice. Opened on its own, a game can try its shop with
`play.configure({ testProducts: [...] })` (bought for free).

## Multiplayer rooms

Players in the same **room** see each other's state (position, look...) and send each other messages.
The game says what to share; a rooms server relays it.

```js
// In the game
const room = await play.joinRoom('farm', { state: { x: 10, y: 20 } })
room.me                                   // { id, name, avatar, state } — name and picture from the website
room.players                              // Map of the other players
room.on('join', (player) => addFarmer(player))
room.on('leave', (player) => removeFarmer(player))
room.on('state', (player) => moveFarmer(player.id, player.state))
room.on('message', (data, from) => showGift(data, from))
room.setState({ x: 12, y: 20 })            // up to 16 kB of JSON
room.send({ type: 'gift', item: 'egg' })   // to everyone, or room.send(data, playerId)
room.leave()
```

```tsx
// In the page
<Playable src="/games/cloud-acres/" multiplayer="/@noru/play" />
```

- **In development**, `noru dev` (and `noru preview`) serve a rooms server at `/@noru/play`.
- **In production**, run the rooms server written in Rust: `noru play-server --port 4040
  --allow-origin https://example.com`, then `multiplayer="wss://play.example.com/"`. It holds rooms
  of up to 16 players (`--max-players`), limits messages to 16 kB and 60 per second per player, and
  answers a plain GET with `{ rooms, players }` (health check).
- `room={(name) => 'group-42:' + name}` puts groups of players apart (per page, per team...).
- Any realtime backend works: `multiplayer` also takes a transport `{ join(room, me, events) }`
  (see `noru-play/multiplayer`).
- Opened on its own, a game meets the other tabs of the same browser (no server needed).

The server only relays: it does not know the rules of the game. Anything worth money must be checked
by your server, not trusted from a player.

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
- Payments happen in the page, never in the game; the game only receives the result.
- In a room, the name and picture of a player come from the website (`player`), not from the game.
- Games and site on the same origin share cookies: only embed games you trust (your own).

MIT
