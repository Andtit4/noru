// Cloud Acres — a farm seen from above, made with noru play.
// Swipe over the fields to plant and harvest, feed the animals, run the workshops, fill the
// villagers' orders and grow the farm. It keeps working while the game is closed.

import { play, type Product, type Purchase, type Room, type RoomPlayer } from 'noru-play'
import { Sound } from './audio'
import {
  CROPS,
  ITEMS,
  PENS,
  PLACES,
  POND,
  TILE,
  TREES,
  WORKSHOPS,
  WORLD_H,
  WORLD_W,
  ZONES,
  MACHINES,
  DECORS,
  SKINS,
  SHIRTS,
  PANTS,
  HATS,
  SPRINKLER_PRICES,
  SPRINKLER_LEVEL,
  SILO_PRICES,
  SILO_LEVEL,
  WORKER,
  WORKERS,
  WORKER_IDS,
  UPGRADE_IDS,
  MAX_UPGRADE,
  NAME_MAX,
  randomFarmId,
  ANIMAL_PRICES,
  RESALE,
  ISLANDS,
  TRANSPORT,
  FRUITS,
  RUIN_QUESTS,
  STALL_OFFERS,
  STALL_MAX,
  MERCHANT_MAX,
  ENERGY,
  today,
  type SceneId,
  type FruitId,
  type TransportId,
  type WorkerId,
  type UpgradeId,
  type DecorKind,
  type MachineId,
  type Zone,
  type CropId,
  type ItemId,
  type Place,
  type Save,
} from './data'
import { drawFarmhouse, drawAnimal, drawBarn, drawBoard, drawFence, drawItem, drawPond, drawTree, drawTrough, drawWorkshop } from './art'
import { C, VILLAGERS, drawCloud, drawCoin, drawPlant, drawPlot, drawVillager, ellipse, leaf, paint, roundRect, star4 } from './draw'
import { Farm, ORDER_SLOTS, type FarmSnapshot, type WorkerTask, type Missing } from './farm'
import { texts } from './i18n'
import { HOME_HOUSE, HOUSE_DOOR, houseSolid, HOME_PAD, HOME_PIER, MARKET, ORCHARD, RUINS, arrival, interactives, sceneSize, solidOn, type Interactive, type Point } from './islands'
import {
  drawAltar,
  drawBalloon,
  drawBasket,
  drawCrystal,
  drawCrystalPlot,
  drawFerry,
  drawFruit,
  drawFruitTree,
  drawHammock,
  drawHut,
  drawKeeper,
  drawLantern,
  drawLightBridge,
  drawMerchant,
  drawMural,
  drawPalm,
  drawPier,
  drawRune,
  drawSpire,
  drawSpirit,
  drawStall,
  drawStardust,
  drawStatue,
  drawWaterfall,
} from './islandArt'
import { clockMode, daylightAt, formatHour, hourOfDay, setClockMode, type Daylight } from './time'
import { drawDecor, drawFarmer, drawFarmerFace, drawForest, drawSilo, drawSprinkler, drawTractor, drawTruck, type Look } from './extras'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
const sound = new Sound()
// Language and player come from the website once noru play is connected (see the end of the file).
let t = texts(play.language)
const FONT = '"Nunito", "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, -apple-system, sans-serif'
const WORLD_PX_W = WORLD_W * TILE
const WORLD_PX_H = WORLD_H * TILE
// ?speed=10 makes time go faster (to try the game quickly).
const speedUp = Math.min(Math.max(Number(new URLSearchParams(location.search).get('speed')) || 1, 1), 50)

/** Your farm (the one saved). */
let home = new Farm(null)
/** The farm on screen: yours, or the one of a friend you visit. */
let farm = home
/** The island on screen: your farm (or a friend's), or another island. */
let scene: SceneId = 'home'
let width = 0
let height = 0
let dpr = 1
let ui = 1 // interface scale
const cam = { x: 5.2 * TILE, y: WORLD_PX_H * 0.34, zoom: 1 }
let started = false
let paused = false
let clock = 0
let dirty = false
let saveTimer = 0
let selected: CropId = 'wheat'
type Panel = null | 'barn' | 'orders' | 'shop' | 'avatar' | 'online' | 'settings' | { buy: Place } | { zone: Zone } | { visitor: string } | { person: string } | { travel: 'dock' | 'pad' } | { tree: number } | 'merchant' | 'stall' | 'keeper' | { seller: string }
let panel: Panel = null
let toast: { title: string; text: string; life: number; max?: number } | null = null
let levelBanner: { level: number; news: string[]; life: number } | null = null
let coinBump = 0
let seedBarRight = 0
let shopTab = 0
let tool: 'seed' | 'tractor' = 'seed'
let placing: DecorKind | null = null
/** The decoration being placed comes from the stock (free). */
let placingStock = false
let hover: { x: number; y: number } | null = null // world, for the decoration being placed

// The player logged in on the website (noru play), shown in the profile badge.
let player = play.player
const playerImage = new Image()
let playerImageReady = false
function loadPlayer() {
  player = play.player
  if (player && player.avatar && !playerImage.src) {
    playerImage.onload = () => (playerImageReady = true)
    playerImage.src = player.avatar
  }
}
loadPlayer()

// The farmer walks where the player acts; the tractor works the fields.
const HOME = { x: 3.5 * TILE, y: 4.9 * TILE }
const farmer = { x: HOME.x, y: HOME.y, tx: HOME.x, ty: HOME.y, facing: 1, idle: 0 }
const TRACTOR_HOME = { x: 1.3 * TILE, y: 4.75 * TILE }
const tractor = { x: TRACTOR_HOME.x, y: TRACTOR_HOME.y, facing: 1, job: null as null | { place: Place; order: number[]; i: number } }
const TRUCK_HOME = { x: 8.7 * TILE, y: 3.75 * TILE }
// Workers (when hired) walk to ripe plots, animals and workshops, each to their own job.
interface Worker { x: number; y: number; facing: number; task: WorkerTask | null; wait: number; fullAt: number; asleep?: boolean }
const WORKER_HOME: Record<WorkerId, { x: number; y: number }> = {
  field: { x: 2.2 * TILE, y: 5 * TILE },
  animal: { x: 12.5 * TILE, y: 4.55 * TILE },
  craft: { x: 13 * TILE, y: 9.1 * TILE },
}
const WORKER_LOOK: Record<WorkerId, Look> = {
  field: { skin: SKINS[3], shirt: '#7bc950', pants: '#5c4a3d', hat: 'straw' },
  animal: { skin: SKINS[1], shirt: '#ffb627', pants: '#3d6fb6', hat: 'cap' },
  craft: { skin: SKINS[4], shirt: '#9b6bd1', pants: '#2f3a4a', hat: 'bandana' },
}
const workers = Object.fromEntries(
  WORKER_IDS.map((id) => [id, { ...WORKER_HOME[id], facing: 1, task: null, wait: 0, fullAt: -10 }]),
) as Record<WorkerId, Worker>

function taskPoint(task: WorkerTask) {
  if (task.kind === 'plot') return { x: (task.place.x + (task.index % task.place.w) + 0.5) * TILE, y: (task.place.y + Math.floor(task.index / task.place.w) + 0.8) * TILE }
  return { x: (task.place.x + task.place.w / 2) * TILE, y: (task.place.y + task.place.h) * TILE + 12 }
}

/** A sleep of the farmer in the house (the screen dims, the energy fills). */
let sleeping: { t: number; night: boolean } | null = null
const SLEEP_TIME = 4.5

function goToSleep() {
  if (sleeping || travel) return
  const night = light.night > 0.5
  if (!night && home.energy >= ENERGY.max - 1) {
    toast = { title: t.notTired, text: '', life: 2 }
    return
  }
  panel = null
  placeFarmer(HOUSE_DOOR.x * TILE, HOUSE_DOOR.y * TILE)
  sleeping = { t: 0, night }
  sound.dayEnd()
}

function updateSleep(dt: number) {
  if (!sleeping) return
  sleeping.t += dt
  if (sleeping.t < SLEEP_TIME) return
  home.sleep(sleeping.night)
  toast = { title: sleeping.night ? t.goodMorning : t.napDone, text: `⚡ ${Math.round(home.energy)}`, life: 3 }
  sleeping = null
  sound.golden()
  persist()
}

function updateWorker(id: WorkerId, dt: number) {
  const w = workers[id]
  if (!farm.workerActive(id)) {
    w.task = null
    w.asleep = false
    w.x = WORKER_HOME[id].x
    w.y = WORKER_HOME[id].y
    return
  }
  // At night, the workers go to bed in the house; they come out in the morning.
  if (light.night > 0.6) {
    w.task = null
    if (w.asleep) return
    const dx = HOUSE_DOOR.x * TILE - w.x
    const dy = HOUSE_DOOR.y * TILE - w.y
    const d = Math.hypot(dx, dy)
    if (d < 6) w.asleep = true
    else {
      w.x += (dx / d) * Math.min(d, 130 * dt)
      w.y += (dy / d) * Math.min(d, 130 * dt)
      if (Math.abs(dx) > 1) w.facing = dx > 0 ? 1 : -1
    }
    return
  }
  if (w.asleep) {
    w.asleep = false
    w.x = HOUSE_DOOR.x * TILE
    w.y = HOUSE_DOOR.y * TILE
  }
  w.wait -= dt
  if (!w.task && w.wait <= 0) {
    // The nearest thing to do.
    let best: WorkerTask | null = null
    let bestD = Infinity
    for (const task of farm.workerTasks(id)) {
      const p = taskPoint(task)
      const d = Math.hypot(p.x - w.x, p.y - w.y)
      if (d < bestD) {
        bestD = d
        best = task
      }
    }
    w.task = best
    if (!best) w.wait = 1
  }
  const target = w.task ? taskPoint(w.task) : WORKER_HOME[id]
  const dx = target.x - w.x
  const dy = target.y - w.y
  const d = Math.hypot(dx, dy)
  if (d > 3) {
    const step = Math.min(d, 150 * dt)
    w.x += (dx / d) * step
    w.y += (dy / d) * step
    if (Math.abs(dx) > 1) w.facing = dx > 0 ? 1 : -1
    return
  }
  if (!w.task) return
  const task = w.task
  w.task = null
  w.wait = 0.45
  const result = farm.workerDo(task)
  if (result === 'full') {
    if (clock - w.fullAt > 5) {
      w.fullAt = clock
      barnFull(w.x, w.y - 60)
    }
    w.wait = 3
  } else if (result === 'fed') {
    sound.plant()
    floatText(w.x, w.y - 66, t.fed, '#e8ffd6', 14)
    changed()
  } else if (result === 'started') {
    sound.plant()
    floatText(w.x, w.y - 66, `+1 ${t.items[WORKSHOPS[task.place.workshop!].output]}…`, '#e8ffd6', 14)
    changed()
  } else if (result) {
    sound.harvest(2)
    burst(w.x, w.y - 20, 8, ['#7bc950', '#ffe08a', '#fff'], 0.5)
    flyToBarn(result.item, w.x, w.y - 20, result.count)
    floatText(w.x, w.y - 66, `+${result.count} ${t.items[result.item]}`, '#e8ffd6', 14)
    changed()
  }
}

function lookOf(a: { skin: number; hat: number; shirt: number; pants: number }): Look {
  const at = <T>(list: readonly T[], i: number) => list[((Math.floor(i) || 0) % list.length + list.length) % list.length]
  return { skin: at(SKINS, a.skin), shirt: at(SHIRTS, a.shirt), pants: at(PANTS, a.pants), hat: at(HATS, a.hat) }
}

function look(): Look {
  return lookOf(home.s.avatar)
}

// --- coins sold by the website (noru play purchases) -----------------------------------------

// ?shop=test: products bought for free, to try the shop when the game runs on its own.
if (new URLSearchParams(location.search).get('shop') === 'test') {
  play.configure({
    testProducts: [
      { id: 'coins-500', title: '500', price: 'Test', coins: 500 },
      { id: 'coins-1500', title: '1 500', price: 'Test', coins: 1500 },
      { id: 'coins-5000', title: '5 000', price: 'Test', coins: 5000 },
    ],
  })
}
let products: Product[] | null = null // null: loading, or not sold here
let paying = false

const productCoins = (product: Product) => Math.max(0, Math.floor(Number(product.coins) || 0))

/** Gives the coins of a paid purchase, saves, then tells the website it was given. */
async function deliverPurchase(purchase: Purchase) {
  const coins = productCoins(purchase.product)
  if (home.creditPurchase(purchase.purchaseId, coins)) {
    // Saved before the website forgets the purchase: never lost, never given twice.
    dirty = false
    await play.save(home.toSave())
    toast = { title: t.thanksPurchase, text: `+${coins} ${t.coinsAdded}`, life: 3.5 }
    flyCoins(width / 2, height / 2, coins)
    burst(width / 2, height / 2, 50, ['#ffd54a', '#ffe08a', '#fff'], 1.6, true, true)
    sound.golden()
  }
  await play.consumePurchase(purchase.purchaseId)
}

async function loadShop() {
  if (!play.canPurchase) return
  try {
    products = await play.getProducts()
    // Paid while the game was closing: given now.
    for (const purchase of await play.getPendingPurchases()) await deliverPurchase(purchase)
  } catch (error) {
    play.logWarning(error)
  }
}

function buyProduct(product: Product) {
  if (paying) return
  paying = true
  play
    .purchase(product.id)
    .then((purchase) => {
      if (purchase) return deliverPurchase(purchase)
      toast = { title: t.purchaseCancelled, text: product.title, life: 2 }
    })
    .catch((error) => {
      play.logWarning(error)
      sound.denied()
      toast = { title: t.purchaseFailed, text: String((error && error.message) || error).slice(0, 90), life: 3.5 }
    })
    .finally(() => (paying = false))
}

// --- multiplayer (noru play rooms) ------------------------------------------------------------
// Everyone online meets in the lobby room ('cloud-acres'): who is there, invitations, waves and
// gifts. Each farm also has its own room ('farm.<id>', a new id each session): its owner and the
// friends they invited. A friend sees the owner's real farm (snapshots sent by the owner) and helps
// on it: their actions are sent to the owner, whose game applies them, so the crops go to the
// owner's barn. The name and picture of a player come from the website when it has accounts.

const myFarmId = randomFarmId()
const ROOM_LOBBY = 'cloud-acres'
const farmRoomName = (id: string) => 'farm.' + id
const FARM_ID = /^[a-z0-9]{6,24}$/

/** In the lobby: level, look, farm room, farm room visited ('' at home). */
interface LobbyState { l: number; a: number[]; f: string; at: string }
type LobbyMessage =
  | { type: 'wave' }
  | { type: 'gift'; item: ItemId; count: number }
  | { type: 'invite'; farm: string; token: string }
  | { type: 'answer'; token: string; yes: boolean; busy?: boolean }
/** On a farm: position, facing, walking, look, level, and the invitation's token (friends). */
interface Shared { x: number; y: number; f: number; w: boolean; a: number[]; l: number; k?: string }
/** What a friend does on the farm they visit: a plot (harvest / plant), or a pen / workshop. */
type Act = { a: 'plot'; p: string; i: number; c: CropId } | { a: 'place'; p: string }
type FarmMessage =
  | { type: 'welcome'; token: string; snap: FarmSnapshot }
  | { type: 'snap'; snap: FarmSnapshot }
  | { type: 'act'; act: Act }
  | { type: 'wave' }
  | { type: 'bye' }
  | { type: 'hello'; token: string }

interface Person { id: string; name: string; image: HTMLImageElement | null; look: Look; level: number }
interface Lobbyist extends Person { farmId: string; at: string }
interface Visitor extends Person { x: number; y: number; tx: number; ty: number; facing: number; walking: boolean; emote: { text: string; life: number } | null; host: boolean }

let lobby: Room<LobbyState, LobbyMessage> | null = null
let lobbyJoining = false
/** The other players online (lobby ids). */
const online = new Map<string, Lobbyist>()
/** The room of the farm on screen: yours, or the one of the friend you visit. */
let farmRoom: Room<Shared, FarmMessage> | null = null
let farmJoining = false
/** People on the farm on screen: your guests, or the owner and their other guests. */
const visitors = new Map<string, Visitor>()
/** Invitations you sent: token -> friend (lobby id). */
const invitesSent = new Map<string, { to: string; until: number }>()
/** Friends on your farm (farm room ids), with a limit of actions per second. */
const guests = new Map<string, { token: string; acts: number; second: number }>()
/** An invitation you received. */
let invitation: { from: Lobbyist; farm: string; token: string; life: number; max: number } | null = null
/** The farm you visit (host: the owner's id in their farm room, once they welcomed you). */
let visit: { farmId: string; token: string; name: string; host: string; since: number; waiting: number } | null = null
/** The cloud curtain between two farms: k goes 0 -> 1 (covered), then back to 0. */
let travel: { k: number; dir: 1 | -1; mid: (() => void) | null; ready: () => boolean } | null = null
let sentState = ''
let sentLobby = ''
let stateTimer = 0
let snapTimer = 0
let snapDirty = false
let helloTimer = 0
let myEmote: { text: string; life: number } | null = null
let roomWarned = false
const giftsFrom = new Map<string, number>()
const pendingActs: { act: Act; at: number }[] = []

const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const avatarOf = (f: Farm) => [f.s.avatar.skin, f.s.avatar.hat, f.s.avatar.shirt, f.s.avatar.pants]

function lookFrom(a: unknown): Look | null {
  return Array.isArray(a) ? lookOf({ skin: num(a[0], 0), hat: num(a[1], 0), shirt: num(a[2], 0), pants: num(a[3], 0) }) : null
}

/** Your name for the others: the website's account, or your nickname. */
function myName() {
  return (player && player.name) || home.s.name || `${t.farmer} ${myFarmId.slice(0, 3).toUpperCase()}`
}

const canGoOnline = () => play.canJoinRooms && home.s.online

/** Sends without throwing (a message too large, a room closing...). */
function safely(send: () => void) {
  try {
    send()
  } catch (error) {
    play.logWarning(error)
  }
}

function personOf(p: RoomPlayer<unknown>): Person {
  // Pictures of the website only (same origin, or data: URLs).
  const image = p.avatar && (p.avatar.startsWith('/') || p.avatar.startsWith('data:image/')) ? Object.assign(new Image(), { src: p.avatar }) : null
  return { id: p.id, name: (p.name || `${t.farmer} ${p.id.slice(-3).toUpperCase()}`).slice(0, 40), image, look: lookOf({ skin: 2, hat: 1, shirt: 1, pants: 0 }), level: 1 }
}

// The lobby.

function lobbyState(): LobbyState {
  return { l: home.level, a: avatarOf(home), f: myFarmId, at: visit && visit.host ? visit.farmId : '' }
}

function applyLobby(o: Lobbyist, s: LobbyState | null) {
  if (!s || typeof s !== 'object') return
  o.level = Math.max(1, Math.floor(num(s.l, 1)))
  o.look = lookFrom(s.a) || o.look
  o.farmId = typeof s.f === 'string' && FARM_ID.test(s.f) ? s.f : ''
  o.at = typeof s.at === 'string' && FARM_ID.test(s.at) ? s.at : ''
}

function lobbyistOf(p: RoomPlayer<LobbyState>): Lobbyist {
  const o: Lobbyist = { ...personOf(p), farmId: '', at: '' }
  applyLobby(o, p.state)
  return o
}

async function joinLobby() {
  if (lobby || lobbyJoining || !canGoOnline()) return
  lobbyJoining = true
  try {
    const joined = await play.joinRoom<LobbyState, LobbyMessage>(ROOM_LOBBY, { state: lobbyState(), name: myName() })
    if (!canGoOnline()) {
      joined.leave()
      return
    }
    lobby = joined
    roomWarned = false
    sentLobby = JSON.stringify(lobbyState())
    online.clear()
    for (const p of joined.players.values()) online.set(p.id, lobbyistOf(p))
    joined.on('join', (p) => online.set(p.id, lobbyistOf(p)))
    joined.on('leave', (p) => {
      online.delete(p.id)
      if (invitation && invitation.from.id === p.id) invitation = null
      if (panel && typeof panel === 'object' && 'person' in panel && panel.person === p.id) panel = null
    })
    joined.on('state', (p) => {
      const o = online.get(p.id)
      if (o) applyLobby(o, p.state)
    })
    joined.on('message', onLobbyMessage)
    joined.on('close', (reason) => {
      if (lobby === joined) {
        lobby = null
        online.clear()
        invitation = null
      }
      // Lost connection: try again a bit later.
      if (reason !== 'left') setTimeout(joinLobby, 5000)
    })
  } catch (error) {
    if (!roomWarned) play.logWarning(error)
    roomWarned = true
    setTimeout(joinLobby, 15000)
  } finally {
    lobbyJoining = false
  }
}

function leaveLobby() {
  const room = lobby
  lobby = null
  online.clear()
  invitation = null
  invitesSent.clear()
  if (room) room.leave()
}

function onLobbyMessage(data: LobbyMessage, from: RoomPlayer<LobbyState>) {
  const o = online.get(from.id)
  if (!o || !data || typeof data !== 'object') return
  if (data.type === 'wave') {
    toast = { title: `👋 ${o.name}`, text: t.hello, life: 2.5 }
    const v = [...visitors.values()].find((x) => x.name === o.name)
    if (v) v.emote = { text: '👋 ' + t.hello, life: 2.5 }
    sound.coin()
  } else if (data.type === 'gift') {
    const count = Math.floor(Number(data.count))
    if (!Object.prototype.hasOwnProperty.call(ITEMS, data.item) || !(count >= 1 && count <= 5)) return
    // Up to 30 gifts from each farmer per session.
    const given = giftsFrom.get(from.id) || 0
    if (given >= 30) return
    giftsFrom.set(from.id, given + count)
    const got = home.receiveGift(data.item, count)
    if (!got) {
      barnFull(farmer.x, farmer.y - 60)
      return
    }
    if (farm === home) flyToBarn(data.item, farmer.x, farmer.y - 40, got)
    toast = { title: `🎁 ${o.name}`, text: `${t.offers} ${got} ${t.items[data.item].toLowerCase()}`, life: 3.5 }
    sound.order()
    persist()
  } else if (data.type === 'invite') {
    if (typeof data.farm !== 'string' || !FARM_ID.test(data.farm) || typeof data.token !== 'string' || data.token.length > 48) return
    if (visit || travel || invitation || !started) {
      safely(() => lobby?.send({ type: 'answer', token: data.token, yes: false, busy: true }, from.id))
      return
    }
    invitation = { from: o, farm: data.farm, token: data.token, life: 30, max: 30 }
    sound.order()
  } else if (data.type === 'answer') {
    const sent = invitesSent.get(data.token)
    if (!sent || sent.to !== from.id || data.yes) return
    invitesSent.delete(data.token)
    toast = { title: o.name, text: data.busy ? t.busy : t.declined, life: 3 }
    sound.denied()
  }
}

function invitedAlready(id: string) {
  for (const sent of invitesSent.values()) if (sent.to === id) return true
  return false
}

function invite(o: Lobbyist) {
  if (!lobby || visit || invitedAlready(o.id)) return
  const token = randomFarmId() + randomFarmId()
  invitesSent.set(token, { to: o.id, until: clock + 60 })
  safely(() => lobby?.send({ type: 'invite', farm: myFarmId, token }, o.id))
  toast = { title: t.inviteSent, text: o.name, life: 2.5 }
  sound.coin()
  joinFarmRoom()
}

function acceptInvitation() {
  const inv = invitation
  if (!inv || !lobby || travel) return
  invitation = null
  safely(() => lobby?.send({ type: 'answer', token: inv.token, yes: true }, inv.from.id))
  panel = null
  placing = null
  tool = 'seed'
  if (dirty) persist()
  sound.buy()
  startTravel(
    () => {
      leaveMarket()
      scene = 'home'
      leaveFarmRoom()
      visit = { farmId: inv.farm, token: inv.token, name: inv.from.name, host: '', since: clock, waiting: 10 }
      joinFarmRoom()
    },
    () => !visit || !!visit.host,
  )
}

function declineInvitation() {
  const inv = invitation
  if (!inv) return
  invitation = null
  safely(() => lobby?.send({ type: 'answer', token: inv.token, yes: false }, inv.from.id))
}

function wavePerson(id: string) {
  if (!lobby) return
  safely(() => lobby?.send({ type: 'wave' }, id))
  myEmote = { text: '👋 ' + t.hello, life: 2.5 }
  sound.coin()
}

function giveTo(id: string, item: ItemId) {
  if (!lobby || !online.has(id) || !home.giveGift(item, 1)) return
  safely(() => lobby?.send({ type: 'gift', item, count: 1 }, id))
  floatText(farmer.x, farmer.y - 74, `${t.giftSent} 1 ${t.items[item].toLowerCase()}`, '#fff6b3', 15)
  sound.harvest(1)
  changed()
}

// The farm room: friends on your farm, or you on a friend's farm.

function sharedState(): Shared {
  const walking = Math.hypot(farmer.tx - farmer.x, farmer.ty - farmer.y) > 2 || [...held].some((k) => KEYS[k])
  const s: Shared = { x: Math.round(farmer.x), y: Math.round(farmer.y), f: farmer.facing, w: walking, a: avatarOf(home), l: home.level }
  if (visit) s.k = visit.token
  return s
}

function applyShared(v: Visitor, s: Shared | null) {
  if (!s || typeof s !== 'object') return
  v.tx = Math.min(Math.max(num(s.x, v.tx), 0), WORLD_PX_W)
  v.ty = Math.min(Math.max(num(s.y, v.ty), 0), WORLD_PX_H)
  v.facing = s.f === -1 ? -1 : 1
  v.walking = !!s.w
  v.look = lookFrom(s.a) || v.look
  v.level = Math.max(1, Math.floor(num(s.l, 1)))
}

function visitorOf(p: RoomPlayer<Shared>): Visitor {
  const v: Visitor = { ...personOf(p), x: HOME.x, y: HOME.y, tx: HOME.x, ty: HOME.y, facing: 1, walking: false, emote: null, host: false }
  applyShared(v, p.state)
  v.x = v.tx
  v.y = v.ty
  return v
}

async function joinFarmRoom() {
  if (farmRoom || farmJoining || !canGoOnline()) return
  const target = visit ? visit.farmId : myFarmId
  farmJoining = true
  try {
    const joined = await play.joinRoom<Shared, FarmMessage>(farmRoomName(target), { state: sharedState(), name: myName() })
    if (!canGoOnline() || (visit ? visit.farmId : myFarmId) !== target) {
      joined.leave()
      return
    }
    farmRoom = joined
    sentState = JSON.stringify(sharedState())
    visitors.clear()
    for (const p of joined.players.values()) onFarmJoin(p)
    joined.on('join', onFarmJoin)
    joined.on('leave', onFarmLeave)
    joined.on('state', (p) => {
      const v = visitors.get(p.id)
      if (v) applyShared(v, p.state)
      else onFarmJoin(p)
    })
    joined.on('message', onFarmMessage)
    joined.on('close', (reason) => {
      if (farmRoom !== joined) return
      farmRoom = null
      visitors.clear()
      guests.clear()
      if (reason === 'left') return
      if (visit) goHome(null)
      else setTimeout(joinFarmRoom, 5000)
    })
  } catch (error) {
    if (!roomWarned) play.logWarning(error)
    roomWarned = true
    if (visit) returnHome(t.inviteExpired)
    else setTimeout(joinFarmRoom, 15000)
  } finally {
    farmJoining = false
  }
}

function leaveFarmRoom() {
  const room = farmRoom
  farmRoom = null
  visitors.clear()
  guests.clear()
  if (room) room.leave()
}

function onFarmJoin(p: RoomPlayer<Shared>) {
  if (visitors.has(p.id)) return
  if (visit) {
    // On a friend's farm: everyone there (the owner is the one who welcomed you).
    const v = visitorOf(p)
    v.host = p.id === visit.host
    visitors.set(p.id, v)
    return
  }
  // On your farm: only the friends you invited come in.
  const token = p.state && typeof p.state === 'object' ? p.state.k : undefined
  if (typeof token === 'string') admitGuest(p, token)
}

/** A friend arrives with the token of your invitation: welcome, with your farm. */
function admitGuest(p: RoomPlayer<Shared>, token: string) {
  if (!invitesSent.has(token) || !farmRoom || guests.has(p.id)) return
  invitesSent.delete(token)
  guests.set(p.id, { token, acts: 0, second: 0 })
  const v = visitorOf(p)
  visitors.set(p.id, v)
  const room = farmRoom
  safely(() => room.send({ type: 'welcome', token, snap: home.snapshot() }, p.id))
  toast = { title: v.name, text: t.guestArrived, life: 3.5 }
  burst(v.x, v.y - 30, 24, ['#ffd54a', '#7fd6c8', '#ff9db0', '#fff'], 1, true)
  sound.golden()
}

function onFarmLeave(p: RoomPlayer<Shared>) {
  const v = visitors.get(p.id)
  visitors.delete(p.id)
  if (panel && typeof panel === 'object' && 'visitor' in panel && panel.visitor === p.id) panel = null
  if (visit && p.id === visit.host) {
    goHome(`${visit.name} ${t.hostLeft}`)
    return
  }
  if (guests.delete(p.id) && v) toast = { title: v.name, text: t.guestLeft, life: 3 }
}

function onFarmMessage(data: FarmMessage, from: RoomPlayer<Shared>) {
  if (!data || typeof data !== 'object') return
  if (data.type === 'wave') {
    const v = visitors.get(from.id)
    if (v && (visit || guests.has(from.id))) {
      v.emote = { text: '👋 ' + t.hello, life: 2.5 }
      sound.coin()
    }
    return
  }
  if (visit) {
    if (data.type === 'welcome' && data.token === visit.token && !visit.host) {
      const view = Farm.view(data.snap)
      if (!view) return
      visit.host = from.id
      farm = view
      const v = visitors.get(from.id)
      if (v) v.host = true
      placeFarmer(HOME.x + 1.6 * TILE, HOME.y + 0.2 * TILE)
      burst(farmer.x, farmer.y - 30, 30, ['#ffd54a', '#7fd6c8', '#ff9db0', '#fff'], 1.1, true)
      sound.golden()
    } else if (data.type === 'snap' && visit.host && from.id === visit.host && farm !== home) {
      if (farm.applySnapshot(data.snap)) replayPending()
    } else if (data.type === 'bye' && from.id === visit.host) goHome(t.sentHome)
    return
  }
  const guest = guests.get(from.id)
  if (data.type === 'hello' && typeof data.token === 'string') {
    // A friend still waiting for the welcome (it may have been lost): sent again.
    const room = farmRoom
    if (!guest) admitGuest(from, data.token)
    else if (guest.token === data.token && room) safely(() => room.send({ type: 'welcome', token: data.token, snap: home.snapshot() }, from.id))
    return
  }
  if (!guest || data.type !== 'act') return
  // At most 12 actions a second per friend.
  const second = Math.floor(clock)
  if (guest.second !== second) {
    guest.second = second
    guest.acts = 0
  }
  if (++guest.acts <= 12) runGuestAct(from.id, data.act)
}

/** Sends a friend back home (from your farm). */
function sendHome(id: string) {
  if (!farmRoom || !guests.has(id)) return
  const room = farmRoom
  safely(() => room.send({ type: 'bye' }, id))
  guests.delete(id)
  visitors.delete(id)
  panel = null
}

// Visiting.

type ActResult =
  | { kind: 'harvest'; item: CropId; count: number }
  | { kind: 'collect'; item: ItemId; count: number }
  | { kind: 'plant' }
  | { kind: 'fed' }
  | { kind: 'started'; item: ItemId }
  | { kind: 'full' }
  | null

/** The rules of an action of a friend, on a farm (yours when they send it, theirs to predict it). */
function doAct(f: Farm, act: Act): ActResult {
  if (!act || typeof act !== 'object') return null
  const place = PLACES.find((p) => p.id === act.p)
  if (!place || !f.usable(place)) return null
  if (act.a === 'plot') {
    if (place.kind !== 'field') return null
    const i = Math.floor(Number(act.i))
    if (!(i >= 0 && i < place.w * place.h)) return null
    const plot = f.plots(place)[i]
    if (!plot.crop) {
      const crop = CROPS.find((c) => c.id === act.c)
      if (!crop || crop.level > f.level) return null
      return f.plant(place, i, crop.id) === 'ok' ? { kind: 'plant' } : null
    }
    if (plot.readyAt > f.clock) return null
    const count = Math.min(f.harvestYield(), f.space())
    const crop = f.harvest(place, i)
    if (crop === 'full') return { kind: 'full' }
    return crop ? { kind: 'harvest', item: crop, count } : null
  }
  if (act.a === 'place' && place.kind === 'pen') {
    const status = f.penStatus(place)
    if (status === 'ready') {
      const product = f.collectPen(place)
      if (product === 'full') return { kind: 'full' }
      return product ? { kind: 'collect', item: product.item, count: product.count } : null
    }
    if (status === 'hungry') return f.feed(place) === 'ok' ? { kind: 'fed' } : null
  }
  if (act.a === 'place' && place.kind === 'workshop') {
    const output = WORKSHOPS[place.workshop!].output
    const collected = f.collectWorkshop(place)
    if (collected === 'full') return { kind: 'full' }
    if (collected) return { kind: 'collect', item: output, count: collected }
    return f.startWorkshop(place) === 'ok' ? { kind: 'started', item: output } : null
  }
  return null
}

/** On your farm: what a friend did, applied for real (crops go to your barn). */
function runGuestAct(id: string, act: Act) {
  const v = visitors.get(id)
  const result = doAct(home, act)
  if (!v || !result) return
  const place = PLACES.find((p) => p.id === act.p)!
  let wx = (place.x + place.w / 2) * TILE
  let wy = place.y * TILE + TILE * 0.5
  if (act.a === 'plot') {
    wx = (place.x + (act.i % place.w) + 0.5) * TILE
    wy = (place.y + Math.floor(act.i / place.w) + 0.5) * TILE
    popPlot(place, act.i)
  } else bumpPlace(place)
  if (result.kind === 'harvest' || result.kind === 'collect') {
    flyToBarn(result.item, wx, wy, result.count)
    floatText(wx, wy - 26, `${v.name} +${result.count} ${t.items[result.item]}`, '#fff6b3', 14)
    burst(wx, wy, 8, ['#ffe08a', '#9ee07a', '#fff'], 0.5)
    sound.harvest(1)
  } else if (result.kind === 'plant') burst(wx, wy + 10, 4, ['#b5774a', '#d49a62'], 0.4)
  else if (result.kind === 'fed') floatText(wx, wy - 26, `${v.name} · ${t.fed}`, '#e8ffd6', 14)
  else if (result.kind === 'started') floatText(wx, wy - 26, `${v.name} · +1 ${t.items[result.item]}…`, '#e8ffd6', 14)
  changed()
}

/** On a friend's farm: sends an action to the owner (it is already shown, predicted). */
function sendAct(act: Act) {
  if (!visit || !visit.host || !farmRoom) return
  const room = farmRoom
  const host = visit.host
  safely(() => room.send({ type: 'act', act }, host))
  pendingActs.push({ act, at: clock })
  while (pendingActs.length > 40) pendingActs.shift()
}

/** A snapshot from the owner may not include your last actions yet: they are applied again. */
function replayPending() {
  while (pendingActs.length && clock - pendingActs[0].at > 1.5) pendingActs.shift()
  for (const { act } of pendingActs) if (act.a === 'plot') doAct(farm, act)
}

/** Back to your own farm (the cloud curtain is already closed, or there is no curtain). */
function returnHome(message: string | null) {
  if (!visit) return
  const away = clock - visit.since
  leaveFarmRoom()
  visit = null
  farm = home
  home.fastForward(away * speedUp)
  home.rest(away / ENERGY.regenEvery)
  pendingActs.length = 0
  placeFarmer(HOME.x, HOME.y)
  joinFarmRoom()
  if (message) toast = { title: message, text: '', life: 3 }
}

function goHome(message: string | null) {
  if (!visit || (travel && travel.dir === 1)) return
  panel = null
  startTravel(() => returnHome(message), () => true)
}

function startTravel(mid: () => void, ready: () => boolean) {
  travel = { k: 0, dir: 1, mid, ready }
  sound.shoo()
}

function placeFarmer(x: number, y: number) {
  Object.assign(farmer, { x, y, tx: x, ty: y, idle: 0 })
  cam.x = x
  cam.y = y - 40
  followCamera = keyboard
  walkPlot = ''
  clampCamera()
}

/** Turns online play on or off (settings). */
function setOnline(on: boolean) {
  home.s.online = on
  persist()
  if (on) {
    joinLobby()
    joinFarmRoom()
    return
  }
  if (visit) returnHome(null)
  leaveMarket()
  leaveFarmRoom()
  leaveLobby()
}

/** After a new nickname: the others see it once the rooms are joined again. */
function renameInRooms() {
  if (lobby) {
    leaveLobby()
    joinLobby()
  }
  if (farmRoom && !visit && guests.size === 0) {
    leaveFarmRoom()
    joinFarmRoom()
  }
}

function updateRooms(dt: number) {
  for (const v of visitors.values()) {
    const dx = v.tx - v.x
    const dy = v.ty - v.y
    const d = Math.hypot(dx, dy)
    if (d > 400) {
      v.x = v.tx
      v.y = v.ty
    } else if (d > 1) {
      const step = Math.min(d, Math.max(190, d * 6) * dt)
      v.x += (dx / d) * step
      v.y += (dy / d) * step
      if (Math.abs(dx) > 1) v.facing = dx > 0 ? 1 : -1
    }
    if (v.emote && (v.emote.life -= dt) <= 0) v.emote = null
  }
  if (myEmote && (myEmote.life -= dt) <= 0) myEmote = null
  if (invitation && (invitation.life -= dt) <= 0) declineInvitation()
  for (const [token, sent] of invitesSent) if (clock > sent.until) invitesSent.delete(token)
  // The owner did not welcome you: back home. Until then, say hello every second.
  if (visit && !visit.host) {
    const room = farmRoom
    const token = visit.token
    helloTimer -= dt
    if (room && helloTimer <= 0) {
      helloTimer = 1
      safely(() => room.send({ type: 'hello', token }))
    }
    if ((visit.waiting -= dt) <= 0) returnHome(t.inviteExpired)
  }
  stateTimer += dt
  if (stateTimer > 0.15) {
    stateTimer = 0
    const room = farmRoom
    if (room) {
      const state = sharedState()
      const text = JSON.stringify(state)
      if (text !== sentState) {
        sentState = text
        safely(() => room.setState(state))
      }
    }
    const hall = lobby
    if (hall) {
      const state = lobbyState()
      const text = JSON.stringify(state)
      if (text !== sentLobby) {
        sentLobby = text
        safely(() => hall.setState(state))
      }
    }
  }
  // Your farm, sent to your guests: soon after a change, and every 2 seconds.
  snapTimer += dt
  if (farmRoom && !visit && guests.size && ((snapDirty && snapTimer > 0.25) || snapTimer > 2)) {
    const room = farmRoom
    snapTimer = 0
    snapDirty = false
    safely(() => room.send({ type: 'snap', snap: home.snapshot() }))
  }
  if (travel) {
    if (travel.dir === 1) {
      travel.k = Math.min(1, travel.k + dt * 2.4)
      if (travel.k >= 1) {
        const mid = travel.mid
        travel.mid = null
        if (mid) mid()
        if (travel && travel.ready()) travel.dir = -1
      }
    } else {
      travel.k -= dt * 1.7
      if (travel.k <= 0) travel = null
    }
  }
}

function visitorAt(wx: number, wy: number) {
  for (const v of visitors.values()) if (Math.abs(wx - v.x) < 26 && wy > v.y - 64 && wy < v.y + 12) return v
  return null
}

function nearVisitor() {
  let best: Visitor | null = null
  let bestD = 56
  for (const v of visitors.values()) {
    const d = Math.hypot(v.x - farmer.x, v.y - farmer.y)
    if (d < bestD) {
      bestD = d
      best = v
    }
  }
  return best
}

function goTo(x: number, y: number) {
  const size = sceneSize(scene)
  farmer.tx = Math.min(Math.max(x, 20), size.w - 20)
  farmer.ty = Math.min(Math.max(y, 40), size.h - 10)
  farmer.idle = 0
}

// Keyboard: the farmer walks with the arrow keys (or WASD / ZQSD), the camera follows them.
const held = new Set<string>()
const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], q: [-1, 0], d: [1, 0], w: [0, -1], z: [0, -1], s: [0, 1],
}
let keyboard = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)
let followCamera = false
let walkPlot = '' // plot under the farmer's feet (plants / harvests once per plot entered)

/** Things the farmer cannot walk through. */
function solidAt(x: number, y: number) {
  if (scene !== 'home') return solidOn(scene, x, y, home.bridgeOpen())
  if (houseSolid(x, y)) return true
  if (x < 12 || y < 30 || x > WORLD_PX_W - 12 || y > WORLD_PX_H - 6) return true
  for (const p of PLACES) {
    if (p.kind === 'field') continue
    if (p.zone && !farm.owns(p.zone)) continue
    if (!farm.owns(p.id)) continue
    const top = p.kind === 'pen' ? p.y * TILE + 14 : p.y * TILE + p.h * TILE * 0.35
    if (x > p.x * TILE + 6 && x < (p.x + p.w) * TILE - 6 && y > top && y < (p.y + p.h) * TILE - 2) return true
  }
  for (const z of ZONES) if (!farm.owns(z.id) && x > z.x * TILE && y > z.y * TILE && y < (z.y + z.h) * TILE) return true
  if (x > POND.x * TILE && x < (POND.x + POND.w) * TILE && y > POND.y * TILE + 8 && y < (POND.y + POND.h) * TILE - 4) return true
  if (farm.s.silo > 0 && x > 0.35 * TILE && x < 1.6 * TILE && y > 1.6 * TILE && y < 3.7 * TILE) return true
  return false
}

/** The building / pen / sign the farmer stands next to (for Space). */
function nearPlace() {
  let best: Place | null = null
  let bestD = 70
  for (const p of PLACES) {
    if (p.kind === 'field' || (p.zone && !farm.owns(p.zone))) continue
    const cx = Math.min(Math.max(farmer.x, p.x * TILE), (p.x + p.w) * TILE)
    const cy = Math.min(Math.max(farmer.y, p.y * TILE), (p.y + p.h) * TILE)
    const d = Math.hypot(cx - farmer.x, cy - farmer.y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function nearZone() {
  return ZONES.find((z) => !farm.owns(z.id) && farmer.x > z.x * TILE - 60 && farmer.y > z.y * TILE && farmer.y < (z.y + z.h) * TILE)
}

function useNearby() {
  const visitor = scene === 'home' ? nearVisitor() : null
  if (visitor) {
    panel = { visitor: visitor.id }
    return
  }
  const it = nearInteractive()
  if (it) {
    interact(it)
    return
  }
  if (scene !== 'home') return
  const place = nearPlace()
  if (place) {
    const keep = { tx: farmer.tx, ty: farmer.ty }
    tapPlace(place)
    // Space does not make the farmer walk away.
    farmer.tx = keep.tx
    farmer.ty = keep.ty
    return
  }
  const zone = nearZone()
  if (zone && !visit) panel = { zone }
}
let barnBump = 0

// --- effects ---------------------------------------------------------------------------------

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; star: boolean; screen: boolean; puff?: boolean }
interface FloatText { x: number; y: number; text: string; life: number; color: string; size: number }
interface Flyer { item: ItemId | 'coin'; x0: number; y0: number; x1: number; y1: number; t: number; duration: number; arrive: () => void }
let particles: Particle[] = []
let floats: FloatText[] = [] // world space
let flyers: Flyer[] = [] // screen space

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

function burst(x: number, y: number, count: number, colors: string[], power = 1, stars = false, screen = false) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const v = rand(40, 160) * power
    const life = rand(0.4, 0.9)
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * power, life, max: life, size: rand(2, 4.5), color: pick(colors), star: stars && Math.random() < 0.5, screen })
  }
}

function dust(x: number, y: number) {
  particles.push({ x: x + rand(-6, 6), y: y - 2, vx: rand(-12, 12), vy: rand(-14, -4), life: 0.5, max: 0.5, size: rand(4, 7), color: 'rgba(240, 225, 190, 0.8)', star: false, screen: false, puff: true })
}

function floatText(wx: number, wy: number, text: string, color = '#ffffff', size = 18) {
  floats.push({ x: wx, y: wy, text, life: 1, color, size })
}

// --- camera ----------------------------------------------------------------------------------

/** Sky around the island that the camera can show (the cliff hangs under it). */
const MARGIN = { side: 1.6 * TILE, top: 1.2 * TILE, bottom: 3.2 * TILE }

function minZoom() {
  const { w, h } = sceneSize(scene)
  return Math.max(width / (w + MARGIN.side * 2), height / (h + MARGIN.top + MARGIN.bottom))
}

function clampCamera() {
  cam.zoom = Math.min(Math.max(cam.zoom, minZoom()), 2.4)
  const halfW = width / 2 / cam.zoom
  const halfH = height / 2 / cam.zoom
  const { w, h } = sceneSize(scene)
  cam.x = Math.min(Math.max(cam.x, halfW - MARGIN.side), w + MARGIN.side - halfW)
  cam.y = Math.min(Math.max(cam.y, halfH - MARGIN.top), h + MARGIN.bottom - halfH)
}

const toScreen = (wx: number, wy: number) => ({ x: (wx - cam.x) * cam.zoom + width / 2, y: (wy - cam.y) * cam.zoom + height / 2 })
const toWorld = (sx: number, sy: number) => ({ x: (sx - width / 2) / cam.zoom + cam.x, y: (sy - height / 2) / cam.zoom + cam.y })

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  ui = Math.min(Math.max(Math.min(width, height) / 420, 0.75), 1.5)
  // About 15 tiles across in landscape (the whole barn and the first fields).
  fitCamera()
  clampCamera()
}

// --- the ground, drawn once ------------------------------------------------------------------

const ground = document.createElement('canvas')
function paintGround() {
  ground.width = WORLD_PX_W
  ground.height = WORLD_PX_H
  const g = ground.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = C.grass
  g.fillRect(0, 0, WORLD_PX_W, WORLD_PX_H)
  // Soft patches of lighter and deeper grass, like brush strokes.
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * WORLD_PX_W
    const y = Math.random() * WORLD_PX_H
    g.fillStyle = Math.random() < 0.5 ? 'rgba(200, 235, 140, 0.28)' : 'rgba(110, 170, 70, 0.18)'
    g.beginPath()
    g.ellipse(x, y, rand(40, 120), rand(20, 60), rand(0, Math.PI), 0, Math.PI * 2)
    g.fill()
  }
  // Clover, grass tufts, little flowers and pebbles.
  for (let i = 0; i < 1100; i++) {
    const x = Math.random() * WORLD_PX_W
    const y = Math.random() * WORLD_PX_H
    const r = Math.random()
    if (r < 0.08) {
      const color = pick(['#ffffff', '#ffe27a', '#ffb3c6', '#c9b6ff'])
      for (let k = 0; k < 5; k++) {
        g.fillStyle = color
        g.beginPath()
        g.arc(x + Math.cos(k * 1.26) * 2.6, y + Math.sin(k * 1.26) * 2.6, 2, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#ffb300'
      g.beginPath()
      g.arc(x, y, 1.4, 0, Math.PI * 2)
      g.fill()
    } else if (r < 0.2) {
      g.fillStyle = 'rgba(95, 160, 60, 0.45)'
      for (let k = 0; k < 3; k++) {
        g.beginPath()
        g.arc(x + Math.cos(k * 2.1) * 3, y + Math.sin(k * 2.1) * 3, 3, 0, Math.PI * 2)
        g.fill()
      }
    } else if (r < 0.23) {
      g.fillStyle = 'rgba(160, 150, 175, 0.6)'
      g.beginPath()
      g.ellipse(x, y, 4, 3, 0, 0, Math.PI * 2)
      g.fill()
    } else {
      g.strokeStyle = 'rgba(70, 130, 45, 0.4)'
      g.lineWidth = 1.6
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(x, y)
      g.quadraticCurveTo(x - 1, y - 4, x - 3, y - 6)
      g.moveTo(x, y)
      g.lineTo(x, y - 7)
      g.moveTo(x, y)
      g.quadraticCurveTo(x + 1, y - 4, x + 3, y - 6)
      g.stroke()
    }
  }
  // Sand paths with stepping stones.
  const paths: [number, number][][] = [
    [[0.6, 4.5], [31.6, 4.5]],
    [[10.1, 0.4], [10.1, 14.6]],
    [[10.1, 9], [31.6, 9]],
    [[5.5, 4.5], [5.5, 14.6]],
    [[3.5, 3.6], [3.5, 4.5]],
    [[7, 3.6], [7, 4.5]],
  ]
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const [color, w] of [
    ['rgba(61, 42, 69, 0.55)', 46],
    [C.sandEdge, 43],
    [C.sand, 35],
  ] as [string, number][]) {
    g.strokeStyle = color
    g.lineWidth = w
    for (const path of paths) {
      g.beginPath()
      path.forEach(([x, y], i) => (i ? g.lineTo(x * TILE, y * TILE) : g.moveTo(x * TILE, y * TILE)))
      g.stroke()
    }
  }
  for (const path of paths) {
    const length = Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]) * TILE
    for (let d = 20; d < length; d += 34) {
      const k = d / length
      const x = (path[0][0] + (path[1][0] - path[0][0]) * k) * TILE + rand(-5, 5)
      const y = (path[0][1] + (path[1][1] - path[0][1]) * k) * TILE + rand(-5, 5)
      g.fillStyle = 'rgba(200, 165, 110, 0.45)'
      g.beginPath()
      g.ellipse(x + 1, y + 2, rand(7, 10), rand(5, 7), rand(0, 1), 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#fbeccb'
      g.beginPath()
      g.ellipse(x, y, rand(7, 10), rand(5, 7), rand(0, 1), 0, Math.PI * 2)
      g.fill()
    }
  }
  for (let i = 0; i < 220; i++) {
    const path = pick(paths)
    const k = Math.random()
    const x = (path[0][0] + (path[1][0] - path[0][0]) * k) * TILE + rand(-14, 14)
    const y = (path[0][1] + (path[1][1] - path[0][1]) * k) * TILE + rand(-14, 14)
    g.fillStyle = 'rgba(170, 130, 80, 0.35)'
    g.beginPath()
    g.arc(x, y, rand(1, 2.2), 0, Math.PI * 2)
    g.fill()
  }
}

// --- animals wandering in their pens ---------------------------------------------------------

interface Walker { x: number; y: number; tx: number; ty: number; wait: number; facing: number }
const walkers: Record<string, Walker[]> = {}

function penWalkers(place: Place) {
  const list = walkers[place.id] || (walkers[place.id] = [])
  // As many as there are animals in the pen (bought or sold).
  const count = farm.penAnimals(place)
  while (list.length < count) {
    const x = (place.x + rand(0.6, place.w - 0.6)) * TILE
    const y = (place.y + rand(0.9, place.h - 0.5)) * TILE
    list.push({ x, y, tx: x, ty: y, wait: rand(0, 3), facing: Math.random() < 0.5 ? 1 : -1 })
  }
  if (list.length > count) list.length = count
  return list
}

function updateWalkers(dt: number) {
  if (asleep()) return
  for (const place of PLACES) {
    if (place.kind !== 'pen' || !farm.usable(place)) continue
    const speed = place.animal === 'chicken' ? 40 : 22
    for (const w of penWalkers(place)) {
      const dx = w.tx - w.x
      const dy = w.ty - w.y
      const d = Math.hypot(dx, dy)
      if (d < 2) {
        w.wait -= dt
        if (w.wait <= 0) {
          w.tx = (place.x + rand(0.6, place.w - 0.6)) * TILE
          w.ty = (place.y + rand(0.9, place.h - 0.5)) * TILE
          w.wait = rand(1.5, 4)
        }
      } else {
        w.x += (dx / d) * speed * dt
        w.y += (dy / d) * speed * dt
        w.facing = dx >= 0 ? 1 : -1
      }
    }
  }
}

// --- actions ---------------------------------------------------------------------------------

function changed() {
  dirty = true
  snapDirty = true
}

function persist() {
  dirty = false
  saveTimer = 0
  play.save(home.toSave()).catch((error) => play.logWarning(error))
}

let menuY = 0
function screenOfBarnButton() {
  return barnButton.x ? { x: barnButton.x, y: barnButton.y } : { x: width - 46 * ui, y: menuY || height - 46 * ui }
}

function flyToBarn(item: ItemId, wx: number, wy: number, count = 1) {
  const from = toScreen(wx, wy)
  // On a friend's farm, things go to their barn (on the map).
  const barn = PLACES[0]
  const to = farm === home ? screenOfBarnButton() : toScreen((barn.x + barn.w / 2) * TILE, (barn.y + barn.h * 0.6) * TILE)
  for (let i = 0; i < Math.min(count, 4); i++) {
    flyers.push({ item, x0: from.x + rand(-6, 6), y0: from.y + rand(-6, 6), x1: to.x, y1: to.y, t: -i * 0.08, duration: 0.65, arrive: () => (barnBump = 1) })
  }
}

function flyCoins(sx: number, sy: number, amount: number) {
  const n = Math.min(6, Math.max(1, Math.round(amount / 8)))
  for (let i = 0; i < n; i++) {
    flyers.push({
      item: 'coin',
      x0: sx + rand(-10, 10),
      y0: sy + rand(-10, 10),
      x1: coinChip.x || width - 128 * ui,
      y1: coinChip.y || 33 * ui,
      t: -i * 0.06,
      duration: 0.6,
      arrive: () => {
        coinBump = 1
        sound.coin()
      },
    })
  }
}

function missingText(missing: Missing) {
  return `${t.missing} ${missing.map((m) => `${m.count} ${t.items[m.item].toLowerCase()}`).join(', ')}`
}

function placeAt(wx: number, wy: number) {
  return PLACES.find((p) => (!p.zone || farm.owns(p.zone)) && wx >= p.x * TILE && wx <= (p.x + p.w) * TILE && wy >= p.y * TILE && wy <= (p.y + p.h) * TILE)
}

/** A land plot not bought yet. */
function zoneAt(wx: number, wy: number) {
  return ZONES.find((z) => !farm.owns(z.id) && wx >= z.x * TILE && wx <= (z.x + z.w) * TILE && wy >= z.y * TILE && wy <= (z.y + z.h) * TILE)
}

function plotAt(wx: number, wy: number) {
  const place = placeAt(wx, wy)
  if (!place || place.kind !== 'field' || !farm.usable(place)) return null
  const col = Math.min(place.w - 1, Math.floor(wx / TILE - place.x))
  const row = Math.min(place.h - 1, Math.floor(wy / TILE - place.y))
  return { place, index: row * place.w + col }
}

function placeName(place: Place) {
  if (place.animal) return t.animals[place.animal]
  if (place.workshop) return t.workshops[place.workshop]
  if (place.kind === 'field') return `${t.places.field} ${place.id.replace('field', '')}`
  return t.places[place.kind]
}

function barnFull(wx: number, wy: number) {
  sound.denied()
  floatText(wx, wy, t.barnFull, '#ffe0e0', 16)
}

function tapPlace(place: Place) {
  const cx = (place.x + place.w / 2) * TILE
  const top = place.y * TILE
  goTo(cx, (place.y + place.h) * TILE + 12)
  bumpPlace(place)
  if (visit) {
    // On a friend's farm: only pens and workshops (their barn, orders and shop are theirs).
    if (!farm.usable(place) || (place.kind !== 'pen' && place.kind !== 'workshop')) {
      floatText(cx, top, t.notYourFarm, '#ffe0e0', 15)
      return
    }
    sendAct({ a: 'place', p: place.id })
  }
  if (!farm.owns(place.id)) {
    panel = { buy: place }
    return
  }
  if (place.kind === 'barn') panel = 'barn'
  else if (place.kind === 'board') panel = 'orders'
  else if (place.kind === 'pen') {
    const status = farm.penStatus(place)
    if (status !== 'busy' && !enough(ENERGY.animals, cx, top)) return
    if (status !== 'busy') home.tire(ENERGY.animals)
    if (status === 'ready') {
      const product = farm.collectPen(place)
      if (product === 'full') barnFull(cx, top)
      else if (product) {
        sound.harvest(3)
        flyToBarn(product.item, cx, top + TILE, product.count)
        floatText(cx, top, `+${product.count} ${t.items[product.item]}`, '#fff6b3')
        burst(cx, top + TILE, 14, ['#fff', '#ffe08a'], 0.8, true)
        changed()
      }
    } else if (status === 'hungry') {
      const result = farm.feed(place)
      if (result === 'ok') {
        sound.plant()
        floatText(cx, top, t.feed, '#e8ffd6')
        burst(cx, top + place.h * TILE * 0.6, 10, ['#f2c14e', '#ff8a2b', '#ffd93d'], 0.5)
        changed()
      } else {
        sound.denied()
        floatText(cx, top, missingText(result), '#ffe0e0', 15)
      }
    } else {
      const left = Math.ceil(farm.s.pens[place.id].readyAt - farm.clock)
      floatText(cx, top, `${left} s`, '#ffffff', 16)
    }
  } else if (place.kind === 'workshop') {
    if (!enough(ENERGY.workshop, cx, top)) return
    home.tire(ENERGY.workshop)
    const collected = farm.collectWorkshop(place)
    if (collected === 'full') {
      barnFull(cx, top)
      return
    }
    if (collected) {
      const output = WORKSHOPS[place.workshop!].output
      sound.order()
      flyToBarn(output, cx, top + TILE, collected)
      floatText(cx, top, `+${collected} ${t.items[output]}`, '#fff6b3')
      burst(cx, top + TILE, 18, ['#fff', '#ffe08a', '#ff8fab'], 0.9, true)
      changed()
      return
    }
    const result = farm.startWorkshop(place)
    if (result === 'ok') {
      sound.plant()
      floatText(cx, top, `+1 ${t.items[WORKSHOPS[place.workshop!].output]}…`, '#e8ffd6', 15)
      changed()
    } else {
      sound.denied()
      floatText(cx, top, result === 'full' ? t.queueFull : missingText(result), '#ffe0e0', 15)
    }
  }
}

/** Enough energy for some work? Otherwise the farmer says they are too tired. */
let lastTired = -10
function enough(cost: number, wx: number, wy: number) {
  if (home.energy >= cost) return true
  if (clock - lastTired > 1.5) {
    lastTired = clock
    sound.denied()
    floatText(wx, wy - 30, t.tooTired, '#ffe0e0', 15)
    if (!toast) toast = { title: t.tooTired, text: t.goSleep, life: 3 }
  }
  return false
}

// Swipe planting / harvesting.
let chain = 0
const touchedPlots = new Set<string>()
let lastDenied = -1

function touchPlot(hit: { place: Place; index: number } | null) {
  if (!hit) return
  const key = hit.place.id + ':' + hit.index
  if (touchedPlots.has(key)) return
  touchedPlots.add(key)
  actOnPlot(hit)
}

/** Plants or harvests a plot (`free`: the tractor does it, the farmer does not get tired). */
function actOnPlot(hit: { place: Place; index: number }, free = false) {
  const plot = farm.plots(hit.place)[hit.index]
  const col = hit.index % hit.place.w
  const row = Math.floor(hit.index / hit.place.w)
  const wx = (hit.place.x + col + 0.5) * TILE
  const wy = (hit.place.y + row + 0.5) * TILE
  if (!plot.crop) {
    if (!free && !enough(ENERGY.sow, wx, wy)) return
    const result = farm.plant(hit.place, hit.index, selected)
    if (result === 'ok') {
      if (!free) home.tire(ENERGY.sow)
      sendAct({ a: 'plot', p: hit.place.id, i: hit.index, c: selected })
      popPlot(hit.place, hit.index)
      sound.plant()
      burst(wx, wy + 10, 5, ['#8a5a36', '#a87148'], 0.4)
      changed()
    } else if (result === 'coins' && clock - lastDenied > 1) {
      lastDenied = clock
      sound.denied()
      floatText(wx, wy - 20, t.noCoins, '#ffe0e0', 15)
    }
  } else if (plot.readyAt <= farm.clock) {
    if (!free && !enough(ENERGY.harvest, wx, wy)) return
    const crop = farm.harvest(hit.place, hit.index)
    if (crop && crop !== 'full' && !free) home.tire(ENERGY.harvest)
    if (crop === 'full') {
      if (clock - lastDenied > 1) {
        lastDenied = clock
        barnFull(wx, wy - 20)
      }
    } else if (crop) {
      sendAct({ a: 'plot', p: hit.place.id, i: hit.index, c: selected })
      popPlot(hit.place, hit.index)
      chain++
      sound.harvest(chain - 1)
      burst(wx, wy, 8, [CROPS.find((c) => c.id === crop)!.color, '#7bc950', '#fff'], 0.5)
      flyToBarn(crop, wx, wy, farm.harvestYield())
      changed()
    }
  }
}

function endSwipe(wx: number, wy: number) {
  if (chain >= 4) {
    const bonus = chain
    home.s.coins += bonus
    floatText(wx, wy - 30, `COMBO x${chain} +${bonus}`, '#ffffff', 20)
    const s = toScreen(wx, wy)
    flyCoins(s.x, s.y, bonus)
    changed()
  }
  chain = 0
  touchedPlots.clear()
}

function sendTractor(place: Place) {
  if (tractor.job) {
    floatText((place.x + place.w / 2) * TILE, place.y * TILE, t.tractorBusy, '#ffe0e0', 15)
    sound.denied()
    return
  }
  const order: number[] = []
  for (let row = 0; row < place.h; row++) {
    for (let k = 0; k < place.w; k++) order.push(row * place.w + (row % 2 ? place.w - 1 - k : k))
  }
  tractor.job = { place, order, i: 0 }
  chain = 0
  sound.plant()
}

function updateTractor(dt: number) {
  const job = tractor.job
  let target = TRACTOR_HOME
  if (job) {
    const index = job.order[job.i]
    target = { x: (job.place.x + (index % job.place.w) + 0.5) * TILE, y: (job.place.y + Math.floor(index / job.place.w) + 0.75) * TILE }
  }
  const dx = target.x - tractor.x
  const dy = target.y - tractor.y
  const d = Math.hypot(dx, dy)
  const speed = job && job.i > 0 ? 150 : 260
  if (d > 3) {
    const step = Math.min(d, speed * dt)
    tractor.x += (dx / d) * step
    tractor.y += (dy / d) * step
    if (Math.abs(dx) > 1) tractor.facing = dx > 0 ? 1 : -1
  } else if (job) {
    const hit = { place: job.place, index: job.order[job.i] }
    actOnPlot(hit, true)
    if (!farm.plots(hit.place)[hit.index].crop) actOnPlot(hit, true)
    job.i++
    if (job.i >= job.order.length) {
      endSwipe(tractor.x, tractor.y)
      tractor.job = null
    }
  }
}

function updateFarmer(dt: number) {
  let kx = 0
  let ky = 0
  if (!panel && !paused && started && !travel) {
    for (const key of held) {
      const dir = KEYS[key]
      if (dir) {
        kx += dir[0]
        ky += dir[1]
      }
    }
  }
  if (kx || ky) {
    const len = Math.hypot(kx, ky)
    const step = 190 * dt * (home.energy < 1 ? 0.55 : 1)
    const nx = farmer.x + (kx / len) * step
    const ny = farmer.y + (ky / len) * step
    // Slide along walls: try both axes, then each one.
    if (!solidAt(nx, ny)) {
      farmer.x = nx
      farmer.y = ny
    } else if (!solidAt(nx, farmer.y)) farmer.x = nx
    else if (!solidAt(farmer.x, ny)) farmer.y = ny
    if (kx) farmer.facing = kx > 0 ? 1 : -1
    farmer.tx = farmer.x
    farmer.ty = farmer.y
    farmer.idle = 0
    followCamera = true
    // Walking over a field plants and harvests, one plot at a time (with a combo).
    const hit = scene === 'home' ? plotAt(farmer.x, farmer.y - 6) : null
    const key = hit ? hit.place.id + ':' + hit.index : ''
    if (key !== walkPlot) {
      if (!hit && walkPlot) endSwipe(farmer.x, farmer.y)
      walkPlot = key
      if (hit) {
        actOnPlot(hit)
        // Same plot: planting right after harvesting it, like the tractor.
        if (!farm.plots(hit.place)[hit.index].crop && tool === 'seed') actOnPlot(hit)
      }
    }
    return
  }
  const dx = farmer.tx - farmer.x
  const dy = farmer.ty - farmer.y
  const d = Math.hypot(dx, dy)
  if (d > 2) {
    const step = Math.min(d, 170 * dt * (home.energy < 1 ? 0.55 : 1))
    farmer.x += (dx / d) * step
    farmer.y += (dy / d) * step
    if (Math.abs(dx) > 1) farmer.facing = dx > 0 ? 1 : -1
  } else {
    farmer.idle += dt
    // A little walk around the barn now and then (not when the player drives the farmer).
    if (farmer.idle > 7 && !keyboard) goTo(HOME.x + rand(-1.5, 2.5) * TILE, HOME.y + rand(-0.2, 0.3) * TILE)
  }
}

function canPlaceDecor(wx: number, wy: number) {
  if (wx < 30 || wy < 50 || wx > WORLD_PX_W - 30 || wy > WORLD_PX_H - 10) return false
  if (PLACES.some((p) => wx > p.x * TILE - 20 && wx < (p.x + p.w) * TILE + 20 && wy > p.y * TILE - 10 && wy < (p.y + p.h) * TILE + 30)) return false
  if (ZONES.some((z) => !farm.owns(z.id) && wx > z.x * TILE && wy > z.y * TILE && wy < (z.y + z.h) * TILE)) return false
  if (wx > POND.x * TILE - 20 && wx < (POND.x + POND.w) * TILE + 20 && wy > POND.y * TILE - 10 && wy < (POND.y + POND.h) * TILE + 20) return false
  if (farm.s.decor.some((d) => Math.hypot(d.x - wx, d.y - wy) < 44)) return false
  if (wx > (HOME_HOUSE.x - 0.4) * TILE && wx < (HOME_HOUSE.x + HOME_HOUSE.w + 0.4) * TILE && wy > HOME_HOUSE.y * TILE && wy < (HOME_HOUSE.y + HOME_HOUSE.h + 0.6) * TILE) return false
  if (Math.hypot(TRUCK_HOME.x - wx, TRUCK_HOME.y - wy) < 50 || Math.hypot(TRACTOR_HOME.x - wx, TRACTOR_HOME.y - wy) < 50) return false
  return true
}

function placeDecorAt(wx: number, wy: number) {
  if (!placing) return
  if (!canPlaceDecor(wx, wy)) {
    sound.denied()
    floatText(wx, wy - 20, t.notHere, '#ffe0e0', 15)
    return
  }
  if (placingStock ? farm.placeFromStock(placing, wx, wy) : farm.placeDecor(placing, wx, wy) === 'ok') {
    sound.buy()
    burst(wx, wy - 10, 24, ['#ffd54a', '#7bc950', '#ff8fab', '#fff'], 0.9, true)
    goTo(wx + 30, wy + 10)
    persist()
  } else sound.denied()
  placing = null
}

function handleFarmEvents() {
  const events = farm.events.splice(0)
  if (farm !== home) return
  for (const event of events) {
    if (event.type === 'truck-out') {
      sound.coin()
      floatText(TRUCK_HOME.x, TRUCK_HOME.y - 50, t.delivery + '…', '#e8f4ff', 15)
    } else {
      floatText(TRUCK_HOME.x, TRUCK_HOME.y - 50, '+' + event.coins, '#fff6b3', 20)
      const p = toScreen(TRUCK_HOME.x, TRUCK_HOME.y - 30)
      flyCoins(p.x, p.y, event.coins)
      changed()
    }
  }
}

/** Where the truck is on its trip (out along the road, then back). */
function truckPosition(k: number) {
  const route = [TRUCK_HOME, { x: TRUCK_HOME.x, y: 4.5 * TILE }, { x: WORLD_PX_W + 80, y: 4.5 * TILE }]
  const lengths = [route[1].y - route[0].y, route[2].x - route[1].x]
  const total = lengths[0] + lengths[1]
  const along = (k < 0.5 ? k / 0.5 : (1 - k) / 0.5) * total
  const out = k < 0.5
  if (along <= lengths[0]) return { x: route[0].x, y: route[0].y + along, facing: out ? 1 : -1 }
  return { x: route[1].x + (along - lengths[0]), y: route[1].y + (out ? 0 : 0), facing: out ? 1 : -1 }
}

function levelUp(level: number) {
  const news: string[] = []
  for (const crop of CROPS) if (crop.level === level) news.push(t.items[crop.id])
  for (const place of PLACES) if (place.level === level) news.push(placeName(place))
  levelBanner = { level, news: [...new Set(news)], life: 3.5 }
  sound.golden()
  burst(width / 2, height * 0.35, 60, ['#ffd54a', '#7bc950', '#ff8fab', '#6ec6ff', '#fff'], 2, true, true)
}

// --- update ----------------------------------------------------------------------------------

let dustTimer = 0

function update(dt: number) {
  clock += dt
  updateNight(dt)
  if (started && !paused) farm.advance(dt * speedUp)
  updateWalkers(dt)
  updateFarmer(dt)
  if (started && !paused && farm === home) for (const id of WORKER_IDS) updateWorker(id, dt)
  updateRooms(dt)
  updateIslands(dt)
  updateSleep(dt)
  updateLife(dt)
  for (const r of rings) r.life -= dt * 2
  rings = rings.filter((r) => r.life > 0)
  dustTimer -= dt
  if (dustTimer <= 0 && started && (Math.hypot(farmer.tx - farmer.x, farmer.ty - farmer.y) > 2 || (!panel && [...held].some((k) => KEYS[k])))) {
    dustTimer = 0.14
    dust(farmer.x, farmer.y)
  }
  if (followCamera) {
    const k = Math.min(1, dt * 4)
    cam.x += (farmer.x - cam.x) * k
    cam.y += (farmer.y - 40 - cam.y) * k
    clampCamera()
  }
  updateTractor(dt)
  handleFarmEvents()
  coinBump = Math.max(0, coinBump - dt * 4)
  barnBump = Math.max(0, barnBump - dt * 4)
  for (const p of particles) {
    if (!p.puff) p.vy += 260 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.life -= dt
  }
  particles = particles.filter((p) => p.life > 0)
  for (const f of floats) {
    f.y -= 30 * dt
    f.life -= dt * 0.7
  }
  floats = floats.filter((f) => f.life > 0)
  for (const f of flyers) {
    f.t += dt
    if (f.t >= f.duration) f.arrive()
  }
  flyers = flyers.filter((f) => f.t < f.duration)
  if (toast) {
    if (toast.max === undefined) toast.max = toast.life
    toast.life -= dt
    if (toast.life <= 0) toast = null
  }
  if (levelBanner) {
    levelBanner.life -= dt
    if (levelBanner.life <= 0) levelBanner = null
  }
  saveTimer += dt
  if (dirty && saveTimer > 4) persist()
}

// --- drawing helpers -------------------------------------------------------------------------

const clamp01 = (k: number) => Math.min(1, Math.max(0, k))
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3)
const easeBack = (k: number) => {
  const c = 1.70158
  const x = clamp01(k) - 1
  return 1 + (c + 1) * x * x * x + c * x * x
}

/** A color lighter (k > 0) or darker (k < 0). */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16)
  const f = (v: number) => Math.round(Math.min(255, Math.max(0, k < 0 ? v * (1 + k) : v + (255 - v) * k)))
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`
}

const INK_TEXT = 'rgba(61, 42, 69, 0.85)'

function text(value: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 800, outline: string | null = INK_TEXT) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  if (outline) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(2.5, size * 0.22)
    ctx.strokeStyle = outline
    ctx.strokeText(value, x, y)
  }
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

/** The size at which a text fits in `maxW` pixels. */
function fitSize(value: string, maxW: number, size: number, weight = 800) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`
  const w = ctx.measureText(value).width
  return w > maxW ? Math.max(8, (size * maxW) / w) : size
}

function clip(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

interface Button { x: number; y: number; w: number; h: number; action: () => void; enabled: boolean }
let buttons: Button[] = []
/** The mouse (hover) and the last press (buttons sink when pressed). */
let mouse: { x: number; y: number } | null = null
let press: { x: number; y: number; at: number } | null = null
const inside = (b: { x: number; y: number; w: number; h: number }, p: { x: number; y: number } | null) => !!p && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

/** A card of paper with an ink outline and a soft shadow. */
function card(x: number, y: number, w: number, h: number, r: number, color: string = C.paper, ink = 2.5) {
  ctx.fillStyle = 'rgba(61, 42, 69, 0.2)'
  roundRect(ctx, x + 2, y + 5, w, h, r)
  ctx.fill()
  roundRect(ctx, x, y, w, h, r)
  paint(ctx, color, ink)
}

/** A thick button that sinks when pressed and lights up under the mouse. */
function button(label: string, x: number, y: number, w: number, h: number, color: string, enabled: boolean, action: () => void, icon?: (cx: number, cy: number, s: number) => void) {
  const pressed = !!press && clock - press.at < 0.16 && inside({ x, y, w, h }, press)
  const hover = enabled && inside({ x, y, w, h }, mouse)
  const depth = Math.max(3, h * 0.13)
  const hf = h - depth
  const top = pressed ? y + depth * 0.75 : hover ? y - 1 : y
  const face = enabled ? (hover ? shade(color, 0.12) : color) : '#d5ccc2'
  const edge = enabled ? shade(color, -0.32) : '#aea398'
  const r = Math.min(hf / 2, 14 * ui)
  roundRect(ctx, x, y + depth, w, hf, r)
  paint(ctx, edge, 2)
  roundRect(ctx, x, top, w, hf, r)
  paint(ctx, face, 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  roundRect(ctx, x + r * 0.6, top + hf * 0.12, w - r * 1.2, hf * 0.26, hf * 0.13)
  ctx.fill()
  const iconW = icon ? hf * 0.8 : 0
  const size = fitSize(label, w - 14 * ui - iconW, Math.min(hf * 0.46, 17 * ui), 900)
  ctx.font = `900 ${Math.round(size)}px ${FONT}`
  const tw = ctx.measureText(label).width
  const startX = x + (w - tw - iconW) / 2
  if (icon) icon(startX + iconW * 0.4, top + hf / 2, hf * 0.32)
  text(label, startX + iconW + tw / 2, top + hf / 2 + 1, size, enabled ? '#fff' : '#f4efe9', 'center', 900, enabled ? 'rgba(61, 42, 69, 0.55)' : 'rgba(61,42,69,0.3)')
  buttons.push({ x, y, w, h, action, enabled })
}

const coinIcon = (cx: number, cy: number, s: number) => drawCoin(ctx, cx, cy, s)

function coinButton(price: number, x: number, y: number, w: number, h: number, color: string, enabled: boolean, action: () => void) {
  button(String(price), x, y, w, h, color, enabled, action, coinIcon)
}

/** An on / off switch (settings). */
function toggle(on: boolean, x: number, y: number, w: number, h: number, enabled: boolean, action: () => void) {
  const k = on ? 1 : 0
  roundRect(ctx, x, y, w, h, h / 2)
  paint(ctx, !enabled ? '#d5ccc2' : on ? C.teal : '#d8cfe0', 2)
  const r = h / 2 - 3
  const cx = x + h / 2 + (w - h) * k
  ellipse(ctx, cx, y + h / 2 + 1, r, r, 'rgba(61,42,69,0.2)')
  ellipse(ctx, cx, y + h / 2, r, r, '#fff', 0, 2)
  buttons.push({ x, y, w, h, enabled, action })
}

function bubble(x: number, y: number, r: number, draw: () => void, bounce = 0) {
  const by = y - Math.abs(Math.sin(clock * 4)) * bounce
  ctx.fillStyle = 'rgba(61, 42, 69, 0.18)'
  ctx.beginPath()
  ctx.arc(x + 2, by + 4, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x - r * 0.32, by + r * 0.8)
  ctx.lineTo(x, by + r * 1.4)
  ctx.lineTo(x + r * 0.32, by + r * 0.8)
  ctx.arc(x, by, r, Math.PI * 0.62, Math.PI * 0.38)
  ctx.closePath()
  paint(ctx, C.paper, 2)
  ctx.save()
  ctx.translate(0, by - y)
  draw()
  ctx.restore()
}

function ring(x: number, y: number, r: number, k: number, color: string) {
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(61, 42, 69, 0.15)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2)
  ctx.stroke()
}

/** A small label under a character (workers, other farmers). */
function nameTag(label: string, x: number, y: number, background: string, color: string) {
  ctx.font = '900 11px ' + FONT
  const w = ctx.measureText(label).width + 16
  roundRect(ctx, x - w / 2, y, w, 19, 9.5)
  paint(ctx, background, 1.5)
  text(label, x, y + 10, 11, color, 'center', 900, null)
}

/** A speech bubble over a character (a wave, a gift). */
function emoteBubble(label: string, x: number, y: number, life: number) {
  const k = easeBack(Math.min(1, (2.5 - life) * 5))
  ctx.globalAlpha = Math.min(1, life * 2)
  ctx.font = '900 14px ' + FONT
  const w = ctx.measureText(label).width + 22
  ctx.save()
  ctx.translate(x, y + 14)
  ctx.scale(k, k)
  ctx.beginPath()
  roundRect(ctx, -w / 2, -28, w, 28, 14)
  paint(ctx, C.paper, 2)
  ctx.beginPath()
  ctx.moveTo(-6, -1)
  ctx.lineTo(0, 8)
  ctx.lineTo(6, -1)
  paint(ctx, C.paper)
  text(label, 0, -14, 14, C.text, 'center', 900, null)
  ctx.restore()
  ctx.globalAlpha = 1
}

/** Gold stars: the level of an upgrade (2 or 3), on the fields, pens and workshops. */
function upgradeStars(level: number, x: number, y: number) {
  if (level <= 1) return
  for (let i = 0; i < level - 1; i++) {
    const sx = x + i * 15
    const s = 1 + Math.sin(clock * 3 + i) * 0.08
    ctx.fillStyle = C.ink
    star4(ctx, sx, y + 1, 8.5 * s)
    ctx.fillStyle = C.gold
    star4(ctx, sx, y, 7 * s)
  }
}

/** A round picture: the website's picture of a player, or their farmer's face. */
function face(person: { image: HTMLImageElement | null; look: Look }, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#cfe9ff'
  ctx.fill()
  ctx.clip()
  if (person.image && person.image.complete && person.image.naturalWidth) ctx.drawImage(person.image, cx - r, cy - r, r * 2, r * 2)
  else drawFarmerFace(ctx, person.look, cx, cy + r * 0.12, r * 1.7, clock)
  ctx.restore()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}

// --- the sky, the island and the light of the day ----------------------------------------------

/** The light of the moment (the player's clock, or fast days). */
function daylight() {
  return daylightAt(hourOfDay(clock))
}

/** Cloud puffs around the island (world coordinates), some far below it, some in front. */
const PUFFS: { x: number; y: number; s: number; near: boolean }[] = (() => {
  const list: { x: number; y: number; s: number; near: boolean }[] = []
  const r = (i: number) => {
    const n = Math.sin(i * 91.7 + 13.1) * 43758.5453
    return n - Math.floor(n)
  }
  for (let i = 0; i < 16; i++) list.push({ x: (i / 15) * WORLD_PX_W, y: WORLD_PX_H + 120 + r(i) * 60, s: 90 + r(i + 40) * 70, near: i % 2 === 0 })
  for (let i = 0; i < 14; i++) list.push({ x: (i / 13) * WORLD_PX_W, y: -50 - r(i + 7) * 50, s: 70 + r(i + 9) * 50, near: false })
  for (let i = 0; i < 6; i++) {
    list.push({ x: -70 - r(i + 3) * 40, y: (i / 5) * WORLD_PX_H, s: 80 + r(i + 5) * 40, near: i % 2 === 1 })
    list.push({ x: WORLD_PX_W + 70 + r(i + 8) * 40, y: (i / 5) * WORLD_PX_H, s: 80 + r(i + 2) * 40, near: i % 2 === 0 })
  }
  return list
})()

function drawPuffs(near: boolean) {
  for (const [i, p] of PUFFS.entries()) {
    if (p.near !== near) continue
    const dx = Math.sin(clock * 0.15 + i) * 16
    const dy = Math.cos(clock * 0.11 + i * 2) * 6
    if (!near) drawCloud(ctx, p.x + dx, p.y + dy + 16, p.s, 'rgba(160, 150, 210, 0.25)')
    drawCloud(ctx, p.x + dx, p.y + dy, p.s, near ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.8)')
  }
}

/** The island: grass on top, and its cliff of earth with hanging roots under the farm. */
function drawIsland() {
  const W = WORLD_PX_W
  const H = WORLD_PX_H
  drawPuffs(false)
  ctx.beginPath()
  ctx.moveTo(10, H - 50)
  ctx.lineTo(W - 10, H - 50)
  const steps = 26
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * W
    const n = Math.sin(i * 12.9898) * 43758.5453
    const drop = 70 + (n - Math.floor(n)) * 70 + Math.sin(i * 0.8) * 20
    ctx.lineTo(x, H + drop)
  }
  ctx.closePath()
  const g = ctx.createLinearGradient(0, H - 40, 0, H + 150)
  g.addColorStop(0, '#b97d4f')
  g.addColorStop(0.5, '#93603d')
  g.addColorStop(1, '#6d4430')
  paint(ctx, '#93603d', 3)
  ctx.save()
  ctx.clip()
  ctx.fillStyle = g
  ctx.fillRect(0, H - 60, W, 240)
  ctx.strokeStyle = 'rgba(61, 42, 69, 0.25)'
  ctx.lineWidth = 3
  for (const k of [30, 62, 98]) {
    ctx.beginPath()
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H + k + Math.sin(x * 0.02 + k) * 6)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255, 220, 170, 0.25)'
  for (let i = 0; i < 40; i++) {
    ctx.beginPath()
    ctx.arc((i * 97) % W, H + 20 + ((i * 53) % 110), 3 + (i % 3), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // Hanging roots and vines, swaying.
  for (let i = 0; i < 18; i++) {
    const x = 60 + ((i * 263) % (W - 120))
    const len = 40 + ((i * 37) % 70)
    const sway = Math.sin(clock * 1.2 + i) * 6
    ctx.strokeStyle = i % 3 ? '#6a4a36' : C.leafDark
    ctx.lineWidth = i % 3 ? 2 : 3
    ctx.beginPath()
    ctx.moveTo(x, H + 30)
    ctx.quadraticCurveTo(x + sway, H + 30 + len * 0.6, x + sway * 1.6, H + 30 + len)
    ctx.stroke()
    if (i % 3 === 0) for (let k = 1; k < 4; k++) leaf(ctx, x + sway * (k / 3), H + 30 + (len * k) / 4, 8, k % 2 ? 0.9 : -0.9, C.leaf)
  }
  drawPuffs(true)
  // The grass.
  ctx.save()
  roundRect(ctx, 0, 0, W, H, 60)
  ctx.clip()
  ctx.drawImage(ground, 0, 0)
  ctx.restore()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 3
  roundRect(ctx, 0, 0, W, H, 60)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 4
  roundRect(ctx, 5, 5, W - 10, H - 10, 56)
  ctx.stroke()
}

// --- life on the island: butterflies, birds, fireflies -----------------------------------------

interface Butterfly { x: number; y: number; tx: number; ty: number; color: string; phase: number }
const butterflies: Butterfly[] = Array.from({ length: 6 }, (_, i) => {
  const x = rand(1, 22) * TILE
  const y = rand(1, 14) * TILE
  return { x, y, tx: x, ty: y, color: [C.rose, C.gold, '#ffffff', '#b99cff', C.sky, C.coral][i], phase: rand(0, 6) }
})
let flock: { x: number; y: number; dir: number } | null = null
let flockTimer = 8

function updateLife(dt: number) {
  for (const b of butterflies) {
    const dx = b.tx - b.x
    const dy = b.ty - b.y
    const d = Math.hypot(dx, dy)
    if (d < 8) {
      b.tx = Math.min(Math.max(b.x + rand(-180, 180), 40), WORLD_PX_W - 40)
      b.ty = Math.min(Math.max(b.y + rand(-140, 140), 40), WORLD_PX_H - 40)
    } else {
      b.x += (dx / d) * 40 * dt + Math.sin(clock * 3 + b.phase) * 0.6
      b.y += (dy / d) * 40 * dt + Math.cos(clock * 4 + b.phase) * 0.6
    }
  }
  flockTimer -= dt
  if (!flock && flockTimer <= 0) {
    const dir = Math.random() < 0.5 ? 1 : -1
    flock = { x: dir > 0 ? -200 : WORLD_PX_W + 200, y: rand(1, 12) * TILE, dir }
  }
  if (flock) {
    flock.x += flock.dir * 110 * dt
    flock.y -= 8 * dt
    if (flock.x < -300 || flock.x > WORLD_PX_W + 300) {
      flock = null
      flockTimer = rand(18, 35)
    }
  }
}

function drawButterflies() {
  for (const b of butterflies) {
    const flap = Math.abs(Math.sin(clock * 14 + b.phase))
    const y = b.y - 30 + Math.sin(clock * 2 + b.phase) * 4
    ellipse(ctx, b.x, b.y, 4, 1.5, 'rgba(61,42,69,0.12)')
    for (const side of [-1, 1]) ellipse(ctx, b.x + side * 3.5 * flap, y, 3.5 * flap + 0.5, 4.5, b.color, side * 0.4, 1)
    ellipse(ctx, b.x, y, 1, 3, C.ink)
  }
}

function drawFlock() {
  if (!flock) return
  for (let i = 0; i < 5; i++) {
    const x = flock.x - flock.dir * (Math.abs(i - 2) * 26)
    const y = flock.y + (i - 2) * 16
    const flap = Math.sin(clock * 9 + i) * 6
    ellipse(ctx, x + 30, y + 140, 7, 3, 'rgba(61,42,69,0.1)')
    ctx.strokeStyle = C.ink
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(x - 9, y - flap)
    ctx.quadraticCurveTo(x - 4, y - 3, x, y)
    ctx.quadraticCurveTo(x + 4, y - 3, x + 9, y - flap)
    ctx.stroke()
  }
}

// --- night: stars, the moon, lights, shooting stars, sleeping animals --------------------------

/** The light of this frame (updated every frame). */
let light: Daylight = daylightAt(12)
let crowed = false

/** Animals sleep in the middle of the night. */
const asleep = () => light.night > 0.6

const STARS = Array.from({ length: 90 }, (_, i) => {
  const n = Math.sin(i * 127.1 + 31.7) * 43758.5453
  const m = Math.sin(i * 269.5 + 11.3) * 43758.5453
  return { x: n - Math.floor(n), y: (m - Math.floor(m)) * 0.75, s: 0.6 + ((i * 37) % 10) / 8, p: i * 1.7 }
})

function drawStars(l: Daylight) {
  if (l.night <= 0.02) return
  for (const star of STARS) {
    const twinkle = 0.55 + 0.45 * Math.sin(clock * 2 + star.p)
    ctx.globalAlpha = l.night * twinkle
    ctx.fillStyle = '#fff8e6'
    star4(ctx, star.x * width, star.y * height, star.s * ui)
  }
  // The moon, with a soft halo.
  const mx = width * 0.82
  const my = height * 0.13
  const r = 20 * ui
  ctx.globalAlpha = l.night
  ellipse(ctx, mx, my, r * 2.6, r * 2.6, 'rgba(255, 245, 210, 0.08)')
  ellipse(ctx, mx, my, r * 1.6, r * 1.6, 'rgba(255, 245, 210, 0.12)')
  ellipse(ctx, mx, my, r, r, '#fff6dc')
  ellipse(ctx, mx - r * 0.3, my - r * 0.2, r * 0.22, r * 0.18, 'rgba(200, 190, 160, 0.5)')
  ellipse(ctx, mx + r * 0.35, my + r * 0.25, r * 0.15, r * 0.13, 'rgba(200, 190, 160, 0.45)')
  ellipse(ctx, mx + r * 0.1, my - r * 0.45, r * 0.1, r * 0.08, 'rgba(200, 190, 160, 0.4)')
  ctx.globalAlpha = 1
}

function glow(x: number, y: number, r: number, color: string, strength: number) {
  if (strength <= 0.01) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color.replace('A', String(0.55 * strength)))
  g.addColorStop(0.45, color.replace('A', String(0.22 * strength)))
  g.addColorStop(1, color.replace('A', '0'))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** At night: lit windows, street lamps, and a lantern around each farmer. */
function drawNightLights(l: Daylight) {
  const k = l.night
  if (k <= 0.02) return
  ctx.globalCompositeOperation = 'lighter'
  const warm = 'rgba(255, 196, 110, A)'
  for (const place of PLACES) {
    if (!farm.usable(place)) continue
    const x = place.x * TILE
    const y = place.y * TILE
    const w = place.w * TILE
    const h = place.h * TILE
    if (place.kind === 'barn') {
      glow(x + w * 0.5, y + h * 0.24, 70, warm, k)
      glow(x + w * 0.5, y + h * 0.85, 60, warm, k * 0.6)
    } else if (place.kind === 'workshop') {
      glow(x + w * 0.5, y + h * 0.75, 70, warm, k * 0.8)
    } else if (place.kind === 'board') glow(x + w * 0.5, y + h * 0.4, 50, warm, k * 0.5)
  }
  for (const d of farm.s.decor) if (d.kind === 'lamp' || d.kind === 'lantern') glow(d.x, d.y - 50, 110, warm, k)
  glow((HOME_HOUSE.x + HOME_HOUSE.w * 0.5) * TILE, (HOME_HOUSE.y + HOME_HOUSE.h * 0.62) * TILE, 90, warm, k)
  // The farmer's lantern.
  const flicker = 1 + Math.sin(clock * 9) * 0.03 + Math.sin(clock * 23) * 0.02
  glow(farmer.x, farmer.y - 26, 140 * flicker, 'rgba(255, 214, 140, A)', k)
  for (const v of visitors.values()) glow(v.x, v.y - 26, 110, 'rgba(255, 214, 140, A)', k * 0.8)
  ctx.globalCompositeOperation = 'source-over'
  // The lantern itself, in the farmer's hand.
  if (k > 0.3) {
    const lx = farmer.x + farmer.facing * 14
    const ly = farmer.y - 22 + Math.sin(clock * 6) * 1
    ctx.globalAlpha = Math.min(1, (k - 0.3) * 3)
    roundRect(ctx, lx - 4, ly - 6, 8, 10, 3)
    paint(ctx, '#ffe7a0', 1.2)
    ellipse(ctx, lx, ly - 1, 2, 3, '#fff6d0')
    ctx.globalAlpha = 1
  }
}

interface ShootingStar { x: number; y: number; vx: number; vy: number; life: number }
let shooting: ShootingStar | null = null
let shootingTimer = 12

function updateNight(dt: number) {
  light = daylight()
  // The rooster at dawn.
  if (light.hour >= 6 && light.hour < 6.2) {
    if (!crowed && started && !paused) {
      crowed = true
      sound.crow()
    }
  } else crowed = false
  // Shooting stars at night: catch them for coins.
  if (shooting) {
    shooting.x += shooting.vx * dt
    shooting.y += shooting.vy * dt
    shooting.life -= dt
    if (shooting.life <= 0) shooting = null
  } else if (light.night > 0.7 && started && farm === home) {
    shootingTimer -= dt
    if (shootingTimer <= 0) {
      shootingTimer = rand(18, 40)
      const fromLeft = Math.random() < 0.5
      const vx = (fromLeft ? 1 : -1) * rand(320, 420)
      shooting = { x: cam.x - (fromLeft ? 1 : -1) * (width / cam.zoom) * 0.45, y: cam.y - (height / cam.zoom) * rand(0.15, 0.35), vx, vy: rand(90, 150), life: 2.6 }
    }
  }
}

function drawShootingStars(l: Daylight) {
  if (!shooting || l.night <= 0.3) return
  const s = shooting
  const a = Math.min(1, s.life)
  const tail = 0.35
  const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * tail, s.y - s.vy * tail)
  g.addColorStop(0, `rgba(255, 250, 220, ${a})`)
  g.addColorStop(1, 'rgba(255, 250, 220, 0)')
  ctx.strokeStyle = g
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(s.x, s.y)
  ctx.lineTo(s.x - s.vx * tail, s.y - s.vy * tail)
  ctx.stroke()
  ctx.fillStyle = `rgba(255, 255, 240, ${a})`
  star4(ctx, s.x, s.y, 5 + Math.sin(clock * 20) * 1.5)
}

/** A tap on a shooting star catches it. */
function catchShootingStar(sx: number, sy: number) {
  if (!shooting) return false
  const p = toScreen(shooting.x, shooting.y)
  if (Math.hypot(p.x - sx, p.y - sy) > 46 * ui) return false
  const coins = 10 + Math.floor(Math.random() * 21)
  home.s.coins += coins
  burst(shooting.x, shooting.y, 30, ['#fff8d0', '#ffe08a', '#b9a6ff', '#fff'], 1.2, true)
  floatText(shooting.x, shooting.y - 20, `★ +${coins}`, '#fff6b3', 20)
  flyCoins(p.x, p.y, coins)
  sound.golden()
  shooting = null
  changed()
  return true
}

function drawFireflies(dusk: number) {
  if (dusk <= 0.05) return
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const [tx, ty] = TREES[i % TREES.length]
    const x = tx * TILE + Math.sin(clock * 0.7 + i * 1.7) * 60
    const y = ty * TILE - 20 + Math.cos(clock * 0.9 + i * 2.3) * 40
    const glow = dusk * (0.5 + 0.5 * Math.sin(clock * 3 + i))
    ellipse(ctx, x, y, 9, 9, `rgba(255, 240, 150, ${0.18 * glow})`)
    ellipse(ctx, x, y, 2.2, 2.2, `rgba(255, 250, 200, ${glow})`)
  }
  ctx.globalCompositeOperation = 'source-over'
}

// --- world -----------------------------------------------------------------------------------

/** When things were last planted / harvested / tapped, for their little bounce. */
const plotPops = new Map<string, number>()
const placeBumps = new Map<string, number>()
interface Ring { x: number; y: number; life: number; color: string }
let rings: Ring[] = []

function popPlot(place: Place, index: number) {
  plotPops.set(place.id + ':' + index, clock)
  const x = (place.x + (index % place.w) + 0.5) * TILE
  const y = (place.y + Math.floor(index / place.w) + 0.7) * TILE
  rings.push({ x, y, life: 1, color: 'rgba(255, 245, 220, 0.9)' })
}

function bumpPlace(place: Place) {
  placeBumps.set(place.id, clock)
}

/** Draws a building with a squash when it was just tapped. */
function bumped(id: string, cx: number, base: number, draw: () => void) {
  const at = placeBumps.get(id)
  const k = at === undefined ? 1 : clamp01((clock - at) / 0.5)
  if (k >= 1) {
    draw()
    return
  }
  const amp = Math.sin(k * Math.PI * 3) * (1 - k) * 0.09
  ctx.save()
  ctx.translate(cx, base)
  ctx.scale(1 + amp, 1 - amp)
  ctx.translate(-cx, -base)
  draw()
  ctx.restore()
}

function woodenSign(x: number, y: number, w: number, h: number, highlight: boolean) {
  roundRect(ctx, x - 4, y + h - 6, 8, 30, 3)
  paint(ctx, C.woodDark, 2)
  roundRect(ctx, x - w / 2, y, w, h, 10)
  paint(ctx, highlight ? '#ffeec2' : '#f3e7d6', 2.5)
  roundRect(ctx, x - w / 2 + 4, y + 4, w - 8, h - 8, 7)
  ctx.strokeStyle = 'rgba(139, 90, 54, 0.3)'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function drawLockedSign(place: Place) {
  const x = (place.x + place.w / 2) * TILE
  const y = (place.y + place.h / 2) * TILE
  const canBuy = farm.level >= place.level && farm === home
  ctx.setLineDash([12, 9])
  ctx.lineDashOffset = -clock * 12
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.lineWidth = 3
  roundRect(ctx, place.x * TILE + 6, place.y * TILE + 6, place.w * TILE - 12, place.h * TILE - 12, 18)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.fill()
  woodenSign(x, y - 26, 104, 36, canBuy && farm.s.coins >= place.price)
  if (canBuy) {
    drawCoin(ctx, x - 26, y - 8, 9)
    text(String(place.price), x + 8, y - 8, 16, '#8a5a1a', 'center', 900, null)
    if (farm.s.coins >= place.price) {
      ctx.fillStyle = `rgba(110, 200, 80, ${0.6 + 0.4 * Math.sin(clock * 5)})`
      star4(ctx, x + 48, y - 26, 5)
    }
  } else text(`🔒 ${t.levelNeeded} ${place.level}`, x, y - 8, 14, C.muted, 'center', 800, null)
}

function drawField(place: Place) {
  const plots = farm.plots(place)
  const wet = farm.s.sprinkler > 0
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i]
    const x = (place.x + (i % place.w) + 0.5) * TILE
    const y = (place.y + Math.floor(i / place.w) + 0.5) * TILE
    drawPlot(ctx, x, y, TILE * 0.9, 0, wet)
    if (!plot.crop) continue
    const growth = farm.growth(plot)
    const ripe = plot.readyAt <= farm.clock
    const at = plotPops.get(place.id + ':' + i)
    const pop = at === undefined ? 0 : Math.max(0, 1 - (clock - at) / 0.6)
    drawPlant(ctx, plot.crop, x, y, TILE * 0.9, growth, ripe, false, false, clock, pop)
    if (ripe) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + 0.5 * Math.sin(clock * 6 + i)})`
      star4(ctx, x + TILE * 0.3, y - TILE * 0.3, 2.8)
    }
  }
}

function drawPen(place: Place) {
  const px = place.x * TILE
  const py = place.y * TILE
  const pen = PENS[place.animal!]
  drawFence(ctx, px + 8, py + 18, place.w * TILE - 16, place.h * TILE - 24)
  const status = farm.penStatus(place)
  drawTrough(ctx, px + place.w * TILE * 0.5, py + 44, TILE * 0.9, status !== 'hungry', '#f2c14e')
  if (place.animal === 'chicken') {
    // Little coop with a teal roof.
    roundRect(ctx, px + 16, py + 6, 46, 36, 6)
    paint(ctx, '#f6dfbd', 2)
    ctx.beginPath()
    ctx.moveTo(px + 9, py + 14)
    ctx.quadraticCurveTo(px + 39, py - 16, px + 69, py + 14)
    ctx.closePath()
    paint(ctx, C.teal, 2)
    ctx.beginPath()
    ctx.moveTo(px + 31, py + 42)
    ctx.lineTo(px + 31, py + 30)
    ctx.arc(px + 39, py + 30, 8, Math.PI, 0)
    ctx.lineTo(px + 47, py + 42)
    paint(ctx, '#7a5236', 1.5)
  }
  const list = [...penWalkers(place)].sort((a, b) => a.y - b.y)
  for (const w of list) {
    const moving = Math.hypot(w.tx - w.x, w.ty - w.y) > 2
    drawAnimal(ctx, pen.kind, w.x, w.y, pen.kind === 'chicken' ? 26 : pen.kind === 'cow' ? 54 : 40, clock + w.x, w.facing, moving)
  }
  // Asleep at night: little z's.
  if (asleep()) {
    for (const [i, w] of list.entries()) {
      const k = (clock * 0.5 + i * 0.37) % 1
      ctx.globalAlpha = Math.sin(k * Math.PI)
      text('z', w.x + 8 + k * 10, w.y - 30 - k * 26, 10 + k * 6, '#ffffff', 'center', 900)
      ctx.globalAlpha = 1
    }
  } else if (status === 'hungry' && list.length) {
    const w = list[0]
    const k = (clock * 0.6) % 1
    if (k < 0.5) text('?', w.x + 10, w.y - 40 - k * 20, 16, '#fff', 'center', 900)
  }
}

function drawPlaceBubble(place: Place) {
  const x = (place.x + place.w / 2) * TILE
  const y = place.y * TILE - 6
  if (place.kind === 'pen') {
    const pen = PENS[place.animal!]
    const status = farm.penStatus(place)
    if (status === 'ready') bubble(x, y, 20, () => drawItem(ctx, pen.product.item, x, y, 26), 6)
    else if (status === 'busy') {
      bubble(x, y, 20, () => {
        ring(x, y, 14, farm.penProgress(place), '#7bc950')
        drawItem(ctx, pen.product.item, x, y, 16)
      })
    } else {
      const enough = farm.count(pen.feed.item) >= pen.feed.count
      bubble(
        x,
        y,
        20,
        () => {
          ctx.globalAlpha = enough ? 1 : 0.45
          drawItem(ctx, pen.feed.item, x - 4, y, 22)
          ctx.globalAlpha = 1
          text(`${pen.feed.count}`, x + 10, y + 8, 13, enough ? '#2e7d32' : '#c0392b', 'center', 900, C.paper)
        },
        enough ? 3 : 0,
      )
    }
  } else if (place.kind === 'workshop') {
    const type = WORKSHOPS[place.workshop!]
    const ready = farm.readyCount(place)
    const progress = farm.workshopProgress(place)
    if (ready) {
      bubble(
        x,
        y,
        20,
        () => {
          drawItem(ctx, type.output, x, y, 26)
          if (ready > 1) text(`x${ready}`, x + 14, y + 10, 13, C.text, 'center', 900, C.paper)
        },
        6,
      )
    } else if (progress >= 0) {
      bubble(x, y, 20, () => {
        ring(x, y, 14, progress, C.gold)
        drawItem(ctx, type.output, x, y, 16)
      })
    } else {
      const enough = farm.missing(type.inputs).length === 0
      bubble(
        x,
        y,
        20,
        () => {
          ctx.globalAlpha = enough ? 1 : 0.45
          drawItem(ctx, type.output, x, y, 22)
          ctx.globalAlpha = 1
        },
        enough ? 3 : 0,
      )
    }
    const queued = farm.queue(place).length
    if (queued > 1) text(`${queued}/${farm.queueMax()}`, x, (place.y + place.h) * TILE + 6, 12, '#fff', 'center', 800)
  } else if (place.kind === 'board' && farm === home) {
    const deliverable = farm.s.orders.filter((_, i) => farm.canDeliver(i)).length
    if (deliverable) bubble(x, y, 16, () => text('✓', x, y, 20, '#2e9d5a', 'center', 900, null), 5)
  }
}

function drawWorld(light: Daylight) {
  if (scene !== 'home') {
    drawIslandWorld(light)
    return
  }
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, light.top)
  sky.addColorStop(1, light.bottom)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  drawStars(light)
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  drawIsland()
  drawPond(ctx, POND.x * TILE, POND.y * TILE, POND.w * TILE, POND.h * TILE, clock)
  // The pier (cloud ferry) and the balloon pad.
  drawPier(ctx, HOME_PIER.x * TILE, HOME_PIER.y * TILE, HOME_PIER.length * TILE, clock)
  if (farm === home && home.s.transport.ferry) drawFerry(ctx, HOME_PIER.x * TILE + 60, (HOME_PIER.y + HOME_PIER.length) * TILE + 20, 90, clock)
  ellipse(ctx, HOME_PAD.x * TILE, HOME_PAD.y * TILE, 50, 20, '#e6d7b8', 0, 2)
  ellipse(ctx, HOME_PAD.x * TILE, HOME_PAD.y * TILE, 34, 12, '#d6c49c')
  // Flat things first: fields and pens.
  for (const place of PLACES) {
    if (!farm.usable(place)) continue
    if (place.kind === 'field') drawField(place)
    if (place.kind === 'pen') drawPen(place)
  }
  if (farm.s.sprinkler > 0) {
    for (const place of PLACES) {
      if (place.kind !== 'field' || !farm.usable(place)) continue
      drawSprinkler(ctx, place.x * TILE + 4, place.y * TILE + 6, clock + place.x)
      if (farm.s.sprinkler > 1) drawSprinkler(ctx, (place.x + place.w) * TILE - 4, (place.y + place.h) * TILE - 2, clock + place.y)
    }
  }
  for (const r of rings) {
    ctx.strokeStyle = r.color.replace(/[\d.]+\)$/, `${r.life * 0.9})`)
    ctx.lineWidth = 3 * r.life
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, 10 + (1 - r.life) * 30, 4 + (1 - r.life) * 12, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Then buildings, trees and characters, back to front.
  const tall: { y: number; draw: () => void }[] = []
  for (const place of PLACES) {
    const x = place.x * TILE
    const y = place.y * TILE
    const w = place.w * TILE
    const h = place.h * TILE
    if (place.zone && !farm.owns(place.zone)) continue
    if (!farm.owns(place.id)) {
      tall.push({ y: y + h, draw: () => drawLockedSign(place) })
      continue
    }
    const cx = x + w / 2
    if (place.kind === 'barn') tall.push({ y: y + h, draw: () => bumped(place.id, cx, y + h, () => drawBarn(ctx, x, y, w, h, clock)) })
    if (place.kind === 'board') tall.push({ y: y + h, draw: () => bumped(place.id, cx, y + h, () => drawBoard(ctx, x, y, w, h, farm === home ? farm.s.orders.filter((o) => o.nextAt === 0).length : 0, clock)) })
    if (place.kind === 'workshop') tall.push({ y: y + h, draw: () => bumped(place.id, cx, y + h, () => drawWorkshop(ctx, place.workshop!, x, y, w, h, clock, farm.workshopProgress(place) >= 0)) })
  }
  for (const [tx, ty, s] of TREES) tall.push({ y: ty * TILE + 20, draw: () => drawTree(ctx, tx * TILE, ty * TILE, 70 * s, clock) })
  {
    const hx = HOME_HOUSE.x * TILE
    const hy = HOME_HOUSE.y * TILE
    const sleepingHere = farm === home && (!!sleeping || WORKER_IDS.some((id) => workers[id].asleep && home.workerActive(id)))
    tall.push({ y: hy + HOME_HOUSE.h * TILE, draw: () => drawFarmhouse(ctx, hx, hy, HOME_HOUSE.w * TILE, HOME_HOUSE.h * TILE, clock, light.night, sleepingHere) })
  }
  if (farm === home && home.s.transport.balloon) tall.push({ y: HOME_PAD.y * TILE, draw: () => drawBalloon(ctx, HOME_PAD.x * TILE, HOME_PAD.y * TILE, 100, clock) })
  for (const d of farm.s.decor) tall.push({ y: d.y, draw: () => drawDecor(ctx, d.kind, d.x, d.y, clock) })
  if (farm.s.silo > 0) tall.push({ y: 3.7 * TILE, draw: () => drawSilo(ctx, 0.35 * TILE, 0.7 * TILE, 1.25 * TILE, 3 * TILE, farm.s.silo) })
  const farmerWalking = Math.hypot(farmer.tx - farmer.x, farmer.ty - farmer.y) > 2 || (started && !panel && [...held].some((k) => KEYS[k]))
  tall.push({
    y: farmer.y,
    draw: () => {
      if (sleeping) return
      drawFarmer(ctx, look(), farmer.x, farmer.y, 46, clock, farmer.facing, farmerWalking)
      if (home.energy < 15) {
        // Tired: drops of sweat.
        for (let i = 0; i < 2; i++) {
          const k = (clock * 1.2 + i * 0.5) % 1
          ellipse(ctx, farmer.x + 14 + i * 5, farmer.y - 48 + k * 18, 2, 3, `rgba(120, 200, 255, ${1 - k})`)
        }
      }
      if (visit || visitors.size) nameTag(clip(myName(), 16), farmer.x, farmer.y + 4, C.gold, C.text)
    },
  })
  if (myEmote) {
    const e = myEmote
    tall.push({ y: 1e9 - 1, draw: () => emoteBubble(e.text, farmer.x, farmer.y - 70, e.life) })
  }
  for (const id of WORKER_IDS) {
    if (!farm.workerActive(id) || (farm === home && workers[id].asleep)) continue
    const w = workers[id]
    const at = farm === home ? w : WORKER_HOME[id]
    const walking = farm === home && !!w.task
    tall.push({
      y: at.y,
      draw: () => {
        drawFarmer(ctx, WORKER_LOOK[id], at.x, at.y, 44, clock + 1.7 + WORKER_IDS.indexOf(id), farm === home ? w.facing : 1, walking)
        const left = farm.workerLeft(id)
        nameTag(`${t.workerTag[id]} · ${Number.isFinite(left) ? Math.ceil(left / 60) + ' min' : '∞'}`, at.x, at.y + 4, '#9ee07a', C.text)
      },
    })
  }
  for (const v of visitors.values()) {
    tall.push({
      y: v.y,
      draw: () => {
        const moving = v.walking || Math.hypot(v.tx - v.x, v.ty - v.y) > 2
        drawFarmer(ctx, v.look, v.x, v.y, 46, clock + v.id.length, v.facing, moving)
        nameTag(`${v.host ? '🏠 ' : ''}${clip(v.name, 16)} · ${t.level} ${v.level}`, v.x, v.y + 4, v.host ? C.mint : C.paper, C.text)
      },
    })
    if (v.emote) {
      const e = v.emote
      tall.push({ y: 1e9 - 1, draw: () => emoteBubble(e.text, v.x, v.y - 70, e.life) })
    }
  }
  if (keyboard && started && !panel && !travel) {
    const near = nearVisitor() || nearInteractive() || nearPlace() || null
    const zone = near || visit ? null : nearZone()
    if (near || zone) {
      const hx = farmer.x
      const hy = farmer.y - 76 - Math.abs(Math.sin(clock * 4)) * 4
      tall.push({
        y: 1e9,
        draw: () => {
          ctx.font = '900 13px ' + FONT
          const w = ctx.measureText(t.use).width + 20
          roundRect(ctx, hx - w / 2, hy - 12, w, 24, 12)
          paint(ctx, C.text, 1.5)
          text(t.use, hx, hy, 13, '#fff', 'center', 900, null)
        },
      })
    }
  }
  if (farm.s.machines.tractor) {
    const at = farm === home ? tractor : { ...TRACTOR_HOME, facing: 1, job: null }
    const moving = farm === home && (!!tractor.job || Math.hypot(tractor.x - TRACTOR_HOME.x, tractor.y - TRACTOR_HOME.y) > 3)
    tall.push({ y: at.y, draw: () => drawTractor(ctx, at.x, at.y, 54, at.facing, clock, moving) })
  }
  if (farm.s.machines.truck) {
    const trip = farm.truckTrip()
    const p = trip < 0 ? { x: TRUCK_HOME.x, y: TRUCK_HOME.y, facing: -1 } : truckPosition(trip)
    tall.push({ y: p.y, draw: () => drawTruck(ctx, p.x, p.y, 60, p.facing, clock, trip >= 0, trip >= 0 && trip < 0.5) })
  }
  if (placing && hover) {
    const ok = canPlaceDecor(hover.x, hover.y)
    const at = { ...hover }
    tall.push({
      y: at.y,
      draw: () => {
        ctx.globalAlpha = 0.6 + 0.2 * Math.sin(clock * 6)
        drawDecor(ctx, placing as string, at.x, at.y, clock)
        ctx.globalAlpha = 1
        ctx.strokeStyle = ok ? 'rgba(110, 200, 80, 0.95)' : 'rgba(230, 70, 80, 0.95)'
        ctx.lineWidth = 3
        ctx.setLineDash([8, 6])
        ctx.lineDashOffset = -clock * 20
        ctx.beginPath()
        ctx.ellipse(at.x, at.y, 30, 12, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      },
    })
  }
  tall.sort((a, b) => a.y - b.y).forEach((item) => item.draw())
  // Land plots not bought yet: forest, and a sign.
  for (const zone of ZONES) {
    if (farm.owns(zone.id)) continue
    drawForest(ctx, zone.x * TILE, zone.y * TILE, zone.w * TILE, zone.h * TILE, clock)
    const cx = (zone.x + zone.w / 2) * TILE
    const cy = (zone.y + zone.h / 2) * TILE
    const canBuy = farm.level >= zone.level && farm === home
    woodenSign(cx, cy - 46, 160, 56, canBuy && farm.s.coins >= zone.price)
    text(t.zones[zone.id], cx, cy - 30, 15, C.text, 'center', 900, null)
    if (canBuy) {
      drawCoin(ctx, cx - 26, cy - 9, 9)
      text(String(zone.price), cx + 8, cy - 9, 16, '#8a5a1a', 'center', 900, null)
    } else text('🔒 ' + t.levelNeeded + ' ' + zone.level, cx, cy - 9, 14, C.muted, 'center', 800, null)
  }
  for (const place of PLACES) {
    if (!farm.usable(place)) continue
    drawPlaceBubble(place)
    if (place.kind === 'field') upgradeStars(farm.upgradeLevel('fields'), (place.x + place.w) * TILE - 15 * (farm.upgradeLevel('fields') - 1), place.y * TILE + 4)
    if (place.kind === 'pen') upgradeStars(farm.upgradeLevel('pens'), (place.x + place.w) * TILE - 18 - 15 * (farm.upgradeLevel('pens') - 1), place.y * TILE + 22)
    if (place.kind === 'workshop') upgradeStars(farm.upgradeLevel('workshops'), place.x * TILE + 10, (place.y + place.h) * TILE - 6)
  }
  drawButterflies()
  // Cloud shadows drifting over the farm.
  for (let i = 0; i < 4; i++) {
    const cx = ((clock * 14 + i * 520) % (WORLD_PX_W + 600)) - 300
    const cy = 120 + i * 230
    ctx.globalAlpha = 0.06
    drawCloud(ctx, cx, cy, 220, '#3d2a45')
    ctx.globalAlpha = 1
  }
  // The light of the hour.
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = light.tint
  ctx.fillRect(-4 * TILE, -4 * TILE, WORLD_PX_W + 8 * TILE, WORLD_PX_H + 8 * TILE)
  ctx.globalCompositeOperation = 'source-over'
  drawNightLights(light)
  drawShootingStars(light)
  drawFireflies(Math.max(light.dusk, light.night * 0.8))
  for (const p of particles) {
    if (p.screen) continue
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5)
    ctx.fillStyle = p.color
    if (p.puff) ellipse(ctx, p.x, p.y, p.size * (1.6 - p.life / p.max), p.size * 0.7 * (1.6 - p.life / p.max), p.color)
    else if (p.star) star4(ctx, p.x, p.y, p.size * 0.8)
    else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  for (const f of floats) {
    const k = 1 - f.life
    const s = k < 0.15 ? easeBack(k / 0.15) : 1
    ctx.globalAlpha = Math.min(1, f.life * 2)
    text(f.text, f.x, f.y, f.size * s, f.color)
  }
  ctx.globalAlpha = 1
  drawFlock()
  ctx.restore()
}

// --- the other islands: travel, the orchard, the market, the celestial ruins ------------------

const AFI_LOOK: Look = { skin: SKINS[4], shirt: '#e8574a', pants: '#2f9e5b', hat: 'bandana' }
const ISLAND_IDS = ['orchard', 'market', 'ruins'] as const

/** Why you cannot leave your farm now (or null). */
function cannotLeave() {
  if (visit) return t.notWhileVisiting
  if (guests.size) return t.notWithGuests
  return null
}

/** The camera at its usual zoom, for the island on screen. */
function fitCamera() {
  const { w, h } = sceneSize(scene)
  cam.zoom = Math.max(Math.min(width / (15 * TILE), height / (9 * TILE)), Math.max(width / w, height / h) * 0.9, minZoom())
  clampCamera()
}

function travelTo(dest: SceneId) {
  if (travel) return
  if (dest !== 'home') {
    const why = cannotLeave()
    if (why) {
      toast = { title: why, text: '', life: 2.5 }
      sound.denied()
      return
    }
    const paid = home.payFare(dest)
    if (paid !== 'ok') {
      sound.denied()
      floatText(farmer.x, farmer.y - 60, paid === 'coins' ? t.noCoins : t.locked, '#ffe0e0', 15)
      return
    }
    flyCoins(width / 2, height / 2, 1)
    persist()
  }
  panel = null
  placing = null
  tool = 'seed'
  sound.buy()
  startTravel(
    () => {
      leaveMarket()
      scene = dest
      const at = arrival(dest)
      placeFarmer(at.x, at.y)
      fitCamera()
      for (const b of butterflies) {
        const { w, h } = sceneSize(dest)
        b.x = b.tx = rand(0.1, 0.9) * w
        b.y = b.ty = rand(0.1, 0.9) * h
      }
      if (dest === 'market') joinMarket()
      if (dest !== 'home') toast = { title: t.islands[dest], text: dest === 'ruins' && home.ruins.quest === 0 ? t.questNew + ' : ' + t.questNames.lanterns : t.islandHelp[dest] ?? '', life: 3.5 }
    },
    () => true,
  )
}

// Grounds of the islands, painted once.
const islandGrounds: Partial<Record<SceneId, HTMLCanvasElement>> = {}

function islandGround(s: SceneId) {
  let canvas = islandGrounds[s]
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  const { w, h } = sceneSize(s)
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const blots = (count: number, colors: string[], rx: [number, number]) => {
    for (let i = 0; i < count; i++) {
      g.fillStyle = pick(colors)
      g.beginPath()
      g.ellipse(Math.random() * w, Math.random() * h, rand(rx[0], rx[1]), rand(rx[0], rx[1]) * 0.5, rand(0, Math.PI), 0, Math.PI * 2)
      g.fill()
    }
  }
  const tufts = (count: number, color: string) => {
    g.strokeStyle = color
    g.lineWidth = 1.6
    g.lineCap = 'round'
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w
      const y = Math.random() * h
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x - 2, y - 6)
      g.moveTo(x, y)
      g.lineTo(x + 2, y - 6)
      g.stroke()
    }
  }
  const path = (points: [number, number][], width: number, edge: string, fill: string) => {
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const [color, lw] of [
      ['rgba(61, 42, 69, 0.5)', width + 10],
      [edge, width + 6],
      [fill, width],
    ] as [string, number][]) {
      g.strokeStyle = color
      g.lineWidth = lw
      g.beginPath()
      points.forEach(([x, y], i) => (i ? g.lineTo(x * TILE, y * TILE) : g.moveTo(x * TILE, y * TILE)))
      g.stroke()
    }
  }
  if (s === 'orchard') {
    g.fillStyle = '#93cf5e'
    g.fillRect(0, 0, w, h)
    blots(140, ['rgba(190, 235, 130, 0.3)', 'rgba(90, 160, 60, 0.2)'], [40, 110])
    tufts(900, 'rgba(60, 120, 40, 0.4)')
    // Red laterite paths.
    path([[12, 13.6], [12, 4.4]], 34, '#b8603a', '#d4794a')
    path([[1.6, 7.9], [22.4, 7.9]], 30, '#b8603a', '#d4794a')
    for (let i = 0; i < 120; i++) {
      g.fillStyle = pick(['#ff5a6e', '#ffd34a', '#ffffff', '#ff8fc8'])
      g.beginPath()
      g.arc(Math.random() * w, Math.random() * h, 2.4, 0, Math.PI * 2)
      g.fill()
    }
  } else if (s === 'market') {
    g.fillStyle = '#a8d672'
    g.fillRect(0, 0, w, h)
    blots(90, ['rgba(200, 235, 140, 0.3)', 'rgba(110, 170, 70, 0.18)'], [40, 100])
    tufts(500, 'rgba(70, 130, 45, 0.4)')
    // The plaza: cobblestones.
    g.save()
    roundRect(g, 1.4 * TILE, 3 * TILE, 17.2 * TILE, 7.4 * TILE, 3 * TILE)
    g.fillStyle = '#e9d3a6'
    g.fill()
    g.strokeStyle = 'rgba(61, 42, 69, 0.55)'
    g.lineWidth = 3
    g.stroke()
    g.clip()
    for (let y = 3 * TILE; y < 10.4 * TILE; y += 18) {
      for (let x = 1.4 * TILE + ((y / 18) % 2) * 12; x < 18.6 * TILE; x += 24) {
        g.fillStyle = pick(['#f3e1b8', '#e0c693', '#ead1a0'])
        g.beginPath()
        g.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.restore()
    path([[10, 11.8], [10, 10]], 30, '#d9bd88', '#efdcb0')
  } else {
    // The ruins: stone platforms over the void (the void stays transparent).
    for (const r of Object.values(RUINS.platforms)) {
      g.save()
      roundRect(g, r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 36)
      g.fillStyle = '#5d527f'
      g.fill()
      g.clip()
      for (let y = r.y * TILE; y < (r.y + r.h) * TILE; y += 40) {
        for (let x = r.x * TILE + ((y / 40) % 2) * 20; x < (r.x + r.w) * TILE; x += 40) {
          g.fillStyle = pick(['#665b8a', '#5a4f7d', '#6e6394', '#62578a'])
          roundRect(g, x + 2, y + 2, 36, 36, 6)
          g.fill()
        }
      }
      blots(30, ['rgba(110, 200, 150, 0.22)', 'rgba(150, 120, 230, 0.2)'], [20, 60])
      for (let i = 0; i < 60; i++) {
        g.fillStyle = 'rgba(200, 255, 230, 0.5)'
        g.beginPath()
        g.arc(r.x * TILE + Math.random() * r.w * TILE, r.y * TILE + Math.random() * r.h * TILE, 1.6, 0, Math.PI * 2)
        g.fill()
      }
      g.restore()
      roundRect(g, r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 36)
      g.strokeStyle = '#2b2048'
      g.lineWidth = 3
      g.stroke()
    }
    for (const [id, r] of Object.entries(RUINS.bridges)) {
      if (id === 'secret') continue
      roundRect(g, r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 10)
      g.fillStyle = '#8b80a8'
      g.fill()
      g.strokeStyle = '#2b2048'
      g.lineWidth = 2.5
      g.stroke()
      g.strokeStyle = 'rgba(40, 30, 70, 0.35)'
      g.lineWidth = 1.5
      const vertical = r.h > r.w
      for (let k = 14; k < (vertical ? r.h : r.w) * TILE; k += 16) {
        g.beginPath()
        if (vertical) {
          g.moveTo(r.x * TILE + 4, r.y * TILE + k)
          g.lineTo((r.x + r.w) * TILE - 4, r.y * TILE + k)
        } else {
          g.moveTo(r.x * TILE + k, r.y * TILE + 4)
          g.lineTo(r.x * TILE + k, (r.y + r.h) * TILE - 4)
        }
        g.stroke()
      }
    }
  }
  islandGrounds[s] = canvas
  return canvas
}

/** An island seen from above with its cliff of earth (orchard, market). */
function drawIslandShape(s: SceneId) {
  const { w: W, h: H } = sceneSize(s)
  for (let i = 0; i < 14; i++) {
    const x = (i / 13) * W
    drawCloud(ctx, x + Math.sin(clock * 0.15 + i) * 14, H + 110 + (i % 3) * 30, 90 + (i % 4) * 20, 'rgba(255,255,255,0.8)')
  }
  ctx.beginPath()
  ctx.moveTo(10, H - 50)
  ctx.lineTo(W - 10, H - 50)
  for (let i = 18; i >= 0; i--) {
    const x = (i / 18) * W
    const n = Math.sin(i * 12.9898 + W) * 43758.5453
    ctx.lineTo(x, H + 60 + (n - Math.floor(n)) * 60)
  }
  ctx.closePath()
  paint(ctx, s === 'orchard' ? '#a8573a' : '#93603d', 3)
  for (let i = 0; i < 8; i++) drawCloud(ctx, (i / 7) * W + Math.sin(clock * 0.2 + i) * 10, H + 70 + (i % 2) * 20, 80 + (i % 3) * 18, 'rgba(255,255,255,0.95)')
  ctx.save()
  roundRect(ctx, 0, 0, W, H, 60)
  ctx.clip()
  ctx.drawImage(islandGround(s), 0, 0)
  ctx.restore()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 3
  roundRect(ctx, 0, 0, W, H, 60)
  ctx.stroke()
}

/** The ruins: platforms floating in a violet sky, each with its rocky underside. */
function drawRuinsShape() {
  for (const r of Object.values(RUINS.platforms)) {
    const x = r.x * TILE
    const w = r.w * TILE
    const y = (r.y + r.h) * TILE
    ctx.beginPath()
    ctx.moveTo(x + 20, y - 30)
    ctx.lineTo(x + w - 20, y - 30)
    for (let i = 8; i >= 0; i--) {
      const px2 = x + (i / 8) * w
      const n = Math.sin(i * 7.7 + x) * 43758.5453
      ctx.lineTo(px2, y + 30 + (n - Math.floor(n)) * 70 * Math.sin((i / 8) * Math.PI))
    }
    ctx.closePath()
    paint(ctx, '#3a2c5e', 3)
    // Crystals hanging under the rock.
    for (let i = 1; i < 4; i++) {
      const cx = x + (i / 4) * w
      ctx.beginPath()
      ctx.moveTo(cx - 8, y + 20)
      ctx.lineTo(cx, y + 50 + i * 6)
      ctx.lineTo(cx + 8, y + 20)
      ctx.closePath()
      paint(ctx, i % 2 ? '#9fd8ff' : '#e2a8ff', 1.5)
    }
  }
  ctx.drawImage(islandGround('ruins'), 0, 0)
}

// The orchard.

function emptySpot(x: number, y: number) {
  ellipse(ctx, x, y, 26, 11, 'rgba(120, 70, 40, 0.35)', 0, 1.5)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x - 6, y)
  ctx.lineTo(x + 6, y)
  ctx.moveTo(x, y - 5)
  ctx.lineTo(x, y + 5)
  ctx.stroke()
}

// The market (an online room: the players there, and their stalls).

interface StallOffer { i: ItemId; c: number; p: number }
interface MarketState { x: number; y: number; f: number; w: boolean; a: number[]; l: number; o: StallOffer[] }
type MarketMessage =
  | { type: 'buy'; req: string; item: ItemId; count: number; price: number }
  | { type: 'sold'; req: string; item: ItemId; count: number; price: number }
  | { type: 'nosale'; req: string }
  | { type: 'wave' }
interface Shopper extends Visitor { offers: StallOffer[] }

let marketRoom: Room<MarketState, MarketMessage> | null = null
let marketJoining = false
const shoppers = new Map<string, Shopper>()
const pendingBuys = new Map<string, { seller: string; until: number }>()
let sentMarket = ''

function marketState(): MarketState {
  const s = sharedState()
  return { x: s.x, y: s.y, f: s.f, w: s.w, a: s.a, l: s.l, o: home.s.stall.map((o) => ({ i: o.item, c: o.count, p: o.price })) }
}

function offersOf(raw: unknown): StallOffer[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, STALL_OFFERS)
    .filter((o) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(ITEMS, o.i))
    .map((o) => ({ i: o.i as ItemId, c: Math.max(0, Math.min(STALL_MAX, Math.floor(num(o.c, 0)))), p: Math.max(1, Math.min(9999, Math.floor(num(o.p, 1)))) }))
    .filter((o) => o.c > 0)
}

function shopperOf(p: RoomPlayer<MarketState>): Shopper {
  const v = visitorOf(p as unknown as RoomPlayer<Shared>)
  return { ...v, offers: offersOf(p.state && p.state.o) }
}

async function joinMarket() {
  if (marketRoom || marketJoining || !canGoOnline()) return
  marketJoining = true
  try {
    const joined = await play.joinRoom<MarketState, MarketMessage>('market', { state: marketState(), name: myName() })
    if (scene !== 'market') {
      joined.leave()
      return
    }
    marketRoom = joined
    sentMarket = ''
    shoppers.clear()
    for (const p of joined.players.values()) shoppers.set(p.id, shopperOf(p))
    joined.on('join', (p) => shoppers.set(p.id, shopperOf(p)))
    joined.on('leave', (p) => {
      shoppers.delete(p.id)
      if (panel && typeof panel === 'object' && 'seller' in panel && panel.seller === p.id) panel = null
    })
    joined.on('state', (p) => {
      const s = shoppers.get(p.id)
      if (!s) return
      applyShared(s, p.state as unknown as Shared)
      s.offers = offersOf(p.state && p.state.o)
    })
    joined.on('message', onMarketMessage)
    joined.on('close', () => {
      if (marketRoom === joined) {
        marketRoom = null
        shoppers.clear()
      }
    })
  } catch (error) {
    play.logWarning(error)
  } finally {
    marketJoining = false
  }
}

function leaveMarket() {
  const room = marketRoom
  marketRoom = null
  shoppers.clear()
  pendingBuys.clear()
  if (room) room.leave()
}

function onMarketMessage(data: MarketMessage, from: RoomPlayer<MarketState>) {
  const s = shoppers.get(from.id)
  if (!s || !data || typeof data !== 'object') return
  const room = marketRoom
  if (data.type === 'wave') {
    s.emote = { text: '👋 ' + t.hello, life: 2.5 }
    sound.coin()
  } else if (data.type === 'buy' && room) {
    // Someone buys from your stall: checked against your offer, then you are paid.
    const count = Math.floor(Number(data.count))
    const ok = typeof data.req === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, data.item) && count >= 1 && count <= STALL_MAX && home.sellFromStall(data.item, count, Math.floor(Number(data.price)))
    if (ok) {
      safely(() => room.send({ type: 'sold', req: data.req, item: data.item, count, price: Math.floor(Number(data.price)) }, from.id))
      toast = { title: `${t.soldTo} ${clip(s.name, 16)}`, text: `${count} ${t.items[data.item].toLowerCase()} · +${count * Math.floor(Number(data.price))}`, life: 3 }
      flyCoins(width / 2, height / 3, count * Math.floor(Number(data.price)))
      sound.order()
      persist()
    } else safely(() => room.send({ type: 'nosale', req: String(data.req).slice(0, 40) }, from.id))
  } else if (data.type === 'sold' || data.type === 'nosale') {
    const pending = pendingBuys.get(data.req)
    if (!pending || pending.seller !== from.id) return
    pendingBuys.delete(data.req)
    if (data.type === 'nosale') {
      toast = { title: t.outOfStock, text: '', life: 2.5 }
      sound.denied()
      return
    }
    const count = Math.floor(Number(data.count))
    const price = Math.floor(Number(data.price))
    if (!Object.prototype.hasOwnProperty.call(ITEMS, data.item) || !(count >= 1)) return
    home.receiveBought(data.item, count, price)
    toast = { title: `${t.boughtFrom} ${clip(s.name, 16)}`, text: `${count} ${t.items[data.item].toLowerCase()}`, life: 3 }
    flyToBarn(data.item, farmer.x, farmer.y - 40, count)
    sound.buy()
    persist()
  }
}

/** Buys from another player's stall: your coins and your barn are checked first. */
function buyFrom(id: string, offer: StallOffer, count: number) {
  const room = marketRoom
  if (!room || pendingBuys.size) return
  if (home.s.coins < count * offer.p) {
    toast = { title: t.noCoins, text: '', life: 2 }
    sound.denied()
    return
  }
  if (home.space() < count) {
    barnFull(farmer.x, farmer.y - 60)
    return
  }
  const req = randomFarmId()
  pendingBuys.set(req, { seller: id, until: clock + 8 })
  safely(() => room.send({ type: 'buy', req, item: offer.i, count, price: offer.p }, id))
  sound.plant()
}

// The celestial ruins.

interface Spirit { x: number; y: number; phase: number; hue: string }
const spirits: Spirit[] = Array.from({ length: 6 }, (_, i) => ({ x: rand(2, 26) * TILE, y: rand(1, 14) * TILE, phase: i * 1.3, hue: ['rgba(190, 160, 255, A)', 'rgba(150, 230, 255, A)', 'rgba(255, 190, 230, A)'][i % 3] }))
let bridgeShownAt = -1
const dustTaken: number[] = RUINS.dust.map(() => -100)

/** Star dust lying on the sanctuary at night (last quest). */
function dustVisible(i: number) {
  return scene === 'ruins' && home.ruins.quest === 4 && home.bridgeOpen() && light.night > 0.5 && clock - dustTaken[i] > 20
}

function updateIslands(dt: number) {
  // Shoppers walk smoothly; your state goes to the market room.
  for (const v of shoppers.values()) {
    const dx = v.tx - v.x
    const dy = v.ty - v.y
    const d = Math.hypot(dx, dy)
    if (d > 400) Object.assign(v, { x: v.tx, y: v.ty })
    else if (d > 1) {
      const step = Math.min(d, Math.max(190, d * 6) * dt)
      v.x += (dx / d) * step
      v.y += (dy / d) * step
      if (Math.abs(dx) > 1) v.facing = dx > 0 ? 1 : -1
    }
    if (v.emote && (v.emote.life -= dt) <= 0) v.emote = null
  }
  const room = marketRoom
  if (room && stateTimer === 0) {
    const state = marketState()
    const text = JSON.stringify(state)
    if (text !== sentMarket) {
      sentMarket = text
      safely(() => room.setState(state))
    }
  }
  for (const [req, p] of pendingBuys) {
    if (clock > p.until) {
      pendingBuys.delete(req)
      toast = { title: t.noReply, text: '', life: 2.5 }
    }
  }
  if (scene !== 'ruins') return
  // Spirits drift; the nearest one follows the farmer.
  spirits.forEach((s, i) => {
    const tx = i === 0 ? farmer.x - farmer.facing * 40 : s.x + Math.sin(clock * 0.4 + s.phase) * 30
    const ty = i === 0 ? farmer.y - 70 : s.y + Math.cos(clock * 0.5 + s.phase) * 20
    s.x += (tx - s.x) * Math.min(1, dt * (i === 0 ? 2 : 0.3))
    s.y += (ty - s.y) * Math.min(1, dt * (i === 0 ? 2 : 0.3))
  })
  if (home.bridgeOpen() && bridgeShownAt < 0) bridgeShownAt = clock
  // Picking up star dust by walking over it.
  RUINS.dust.forEach((p, i) => {
    if (!dustVisible(i)) return
    if (Math.hypot(farmer.x - p.x * TILE, farmer.y - p.y * TILE) < 34 && home.collectStardust()) {
      dustTaken[i] = clock
      burst(p.x * TILE, p.y * TILE, 20, ['#fff8d0', '#ffe08a', '#d8c8ff'], 0.8, true)
      floatText(p.x * TILE, p.y * TILE - 30, `★ ${home.ruins.stardust}/5`, '#fff6b3', 16)
      sound.harvest(home.ruins.stardust)
      changed()
    }
  })
}

/** What is next to the farmer on this island (for Space and the hint). */
function nearInteractive() {
  let best: Interactive | null = null
  let bestD = 64
  for (const it of interactives(scene, home.bridgeOpen())) {
    const d = Math.hypot(it.at.x - farmer.x, it.at.y - farmer.y)
    if (d < bestD) {
      bestD = d
      best = it.what
    }
  }
  return best
}

/** What was tapped on this island. */
function interactiveAt(wx: number, wy: number) {
  let best: Interactive | null = null
  let bestD = 52
  for (const it of interactives(scene, home.bridgeOpen())) {
    const d = Math.hypot(it.at.x - wx, it.at.y - 10 - wy)
    if (d < bestD) {
      bestD = d
      best = it.what
    }
  }
  return best
}

function interact(it: Interactive) {
  const at = interactives(scene, home.bridgeOpen()).find((i) => JSON.stringify(i.what) === JSON.stringify(it))?.at ?? { x: farmer.x, y: farmer.y }
  if (it.kind === 'house') goToSleep()
  else if (it.kind === 'dock' || it.kind === 'pad') panel = { travel: it.kind }
  else if (it.kind === 'tree') {
    const ripe = home.treeReady(it.spot) && home.treeGrowth(it.spot) >= 1
    if (!ripe) {
      panel = { tree: it.spot }
      return
    }
    if (!enough(ENERGY.tree, at.x, at.y - 40)) return
    const got = home.harvestTree(it.spot)
    if (got && got !== 'full') home.tire(ENERGY.tree)
    if (got === 'full') barnFull(at.x, at.y - 60)
    else if (got) {
      flyToBarn(got.item, at.x, at.y - 50, got.count)
      floatText(at.x, at.y - 80, `+${got.count} ${t.items[got.item]}`, '#fff6b3', 16)
      burst(at.x, at.y - 50, 14, [FRUITS[got.item].color, '#7bc950', '#fff'], 0.7)
      sound.harvest(2)
      changed()
    }
  } else if (it.kind === 'hut') {
    toast = { title: 'Afi', text: t.treeHelp, life: 3 }
    sound.coin()
  } else if (it.kind === 'merchant') panel = 'merchant'
  else if (it.kind === 'stall') panel = 'stall'
  else if (it.kind === 'keeper') panel = 'keeper'
  else if (it.kind === 'crystal') {
    const c = home.crystal(it.plot)
    if (c && home.crystalGrowth(it.plot) >= 1) {
      if (!enough(ENERGY.crystal, at.x, at.y - 30)) return
      const got = home.harvestCrystal(it.plot)
      if (got && got !== 'full') home.tire(ENERGY.crystal)
      if (got === 'full') barnFull(at.x, at.y - 40)
      else if (got) {
        flyToBarn(got, at.x, at.y - 30, 1)
        floatText(at.x, at.y - 60, `+1 ${t.items[got]}`, '#f0e0ff', 16)
        burst(at.x, at.y - 30, 18, ['#d8c8ff', '#9fd8ff', '#fff'], 0.8, true)
        sound.golden()
        changed()
      }
    } else if (c) floatText(at.x, at.y - 50, `${t.crystalGrowing} · ${Math.ceil(c.readyAt - home.clock)} s`, '#ffffff', 14)
    else {
      const result = home.plantStar(it.plot)
      if (result === 'ok') {
        sound.plant()
        burst(at.x, at.y - 10, 12, ['#d8c8ff', '#fff'], 0.5, true)
        rings.push({ x: at.x, y: at.y, life: 1, color: 'rgba(220, 200, 255, 0.9)' })
        changed()
      } else {
        sound.denied()
        floatText(at.x, at.y - 40, result === 'locked' ? t.locked : result === 'coins' ? t.noCoins : '', '#ffe0e0', 14)
      }
    }
  } else if (it.kind === 'lantern') {
    if (home.lightLantern(it.index)) {
      sound.golden()
      burst(at.x, at.y - 50, 24, ['#ffd98a', '#fff3c4', '#ffb35a'], 0.9, true)
      floatText(at.x, at.y - 90, t.lanternLit, '#fff6b3', 15)
      changed()
    }
  } else if (it.kind === 'rune') {
    const result = home.touchRune(it.index)
    if (result === 'wrong') {
      sound.denied()
      toast = { title: t.runeWrong, text: '', life: 2.5 }
    } else if (result) {
      sound.harvest(home.ruins.runeStep)
      burst(at.x, at.y - 30, 14, ['#d8c8ff', '#fff'], 0.6, true)
      if (result === 'done') toast = { title: t.done, text: t.keeper, life: 3 }
      changed()
    }
  } else if (it.kind === 'mural') {
    toast = { title: t.questNames.runes, text: t.questText.runes, life: 4 }
  } else if (it.kind === 'altar') {
    if (home.ruins.quest === 4 && home.canHandIn()) handInQuest(at)
    else toast = { title: `★ ${home.ruins.stardust}/5`, text: t.stardustNight, life: 3 }
  }
}

function handInQuest(at: Point) {
  const before = home.ruins.quest
  const coins = home.handIn()
  if (!coins) return
  sound.order()
  burst(at.x, at.y - 40, 40, ['#ffd54a', '#d8c8ff', '#9fd8ff', '#fff'], 1.4, true)
  const p = toScreen(at.x, at.y - 40)
  flyCoins(p.x, p.y, coins)
  toast = { title: `${t.done} ${t.questNames[RUIN_QUESTS[before].id]}`, text: before === 3 ? t.bridgeOpen : before === RUIN_QUESTS.length - 1 ? `${t.starKeeper} · ${t.shardReady}` : `+${coins}`, life: 4.5 }
  if (before === RUIN_QUESTS.length - 1) burst(width / 2, height * 0.4, 70, ['#ffd54a', '#fff8d0', '#b9a6ff'], 2, true, true)
  persist()
}

/** The keeper's "!" when a quest can be given. */
function keeperHasNews() {
  return home.canHandIn() || (home.ruins.quest >= RUIN_QUESTS.length && home.canOffer(today()))
}

// Drawing an island.

function drawIslandWorld(l: Daylight) {
  const ruins = scene === 'ruins'
  const { w: W, h: H } = sceneSize(scene)
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, ruins ? '#140f38' : l.top)
  sky.addColorStop(1, ruins ? '#53348a' : l.bottom)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  if (ruins) {
    drawStars({ ...l, night: Math.max(0.75, l.night) })
    // Ribbons of an aurora.
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = ['rgba(140, 255, 210, 0.12)', 'rgba(180, 140, 255, 0.12)', 'rgba(255, 160, 220, 0.1)'][i]
      ctx.lineWidth = 30
      ctx.beginPath()
      for (let x = 0; x <= width; x += 30) ctx.lineTo(x, height * (0.15 + i * 0.08) + Math.sin(x * 0.006 + clock * 0.3 + i) * 30)
      ctx.stroke()
    }
  } else drawStars(l)
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)
  if (ruins) {
    for (let i = 0; i < 7; i++) drawSpire(ctx, ((i * 613) % W) + 40, H * (0.25 + (i % 3) * 0.3), 120 + (i % 3) * 50, clock)
    drawRuinsShape()
    // The secret bridge of light.
    const r = RUINS.bridges.secret
    if (home.bridgeOpen()) drawLightBridge(ctx, r.x * TILE, r.y * TILE, (r.x + r.w) * TILE, r.h * TILE, bridgeShownAt < 0 ? 0 : Math.min(1, (clock - bridgeShownAt) / 1.5), clock)
  } else drawIslandShape(scene)
  const tall: { y: number; draw: () => void }[] = []
  const bubbles: (() => void)[] = []
  if (scene === 'orchard') {
    const pier = ORCHARD.pier
    drawPier(ctx, pier.x * TILE, pier.y * TILE, pier.length * TILE, clock)
    drawFerry(ctx, pier.x * TILE + 60, (pier.y + pier.length) * TILE + 20, 90, clock)
    drawWaterfall(ctx, ORCHARD.waterfall.x * TILE, H - 6, 34, 140, clock)
    const hut = ORCHARD.hut
    tall.push({ y: (hut.y + hut.h) * TILE, draw: () => drawHut(ctx, hut.x * TILE, hut.y * TILE, hut.w * TILE, hut.h * TILE, clock) })
    tall.push({ y: ORCHARD.keeper.y * TILE, draw: () => drawFarmer(ctx, AFI_LOOK, ORCHARD.keeper.x * TILE, ORCHARD.keeper.y * TILE, 44, clock * 0.6, -1, false) })
    for (const [x, y, fruit] of ORCHARD.baskets) tall.push({ y: y * TILE, draw: () => drawBasket(ctx, fruit, x * TILE, y * TILE, 40) })
    for (const [x, y] of ORCHARD.palms) tall.push({ y: y * TILE, draw: () => drawPalm(ctx, x * TILE, y * TILE, 120, clock) })
    const hm = ORCHARD.hammock
    tall.push({ y: hm.y * TILE, draw: () => drawHammock(ctx, hm.x1 * TILE, hm.y * TILE, hm.x2 * TILE, clock) })
    ORCHARD.spots.forEach((p, spot) => {
      const tree = home.tree(spot)
      const x = p.x * TILE
      const y = p.y * TILE
      if (!tree) {
        tall.push({ y: y - 30, draw: () => emptySpot(x, y) })
        return
      }
      const growth = home.treeGrowth(spot)
      const ready = growth >= 1 && home.treeReady(spot)
      tall.push({ y, draw: () => drawFruitTree(ctx, tree.fruit, x, y, 110, growth, ready, clock) })
      if (ready) bubbles.push(() => bubble(x, y - 140, 20, () => drawItem(ctx, tree.fruit, x, y - 140, 26), 6))
      else if (growth >= 1) bubbles.push(() => bubble(x, y - 140, 18, () => ring(x, y - 140, 13, 1 - (tree.readyAt - home.clock) / FRUITS[tree.fruit].every, C.gold)))
    })
  } else if (scene === 'market') {
    const pier = MARKET.pier
    drawPier(ctx, pier.x * TILE, pier.y * TILE, pier.length * TILE, clock)
    drawFerry(ctx, pier.x * TILE + 60, (pier.y + pier.length) * TILE + 20, 90, clock)
    const wanted = home.merchantWants(today())
    const ms = MARKET.merchantStall
    tall.push({ y: (ms.y + ms.h) * TILE, draw: () => drawStall(ctx, ms.x * TILE, ms.y * TILE, ms.w * TILE, ms.h * TILE, clock, (gx, gy) => [-50, -16, 18, 52].forEach((dx) => drawItem(ctx, wanted, gx + dx, gy - 6, 26))) })
    tall.push({ y: MARKET.merchant.y * TILE, draw: () => drawMerchant(ctx, MARKET.merchant.x * TILE, MARKET.merchant.y * TILE, 60, clock) })
    bubbles.push(() => bubble(MARKET.merchant.x * TILE + 40, MARKET.merchant.y * TILE - 90, 18, () => text('×2', MARKET.merchant.x * TILE + 40, MARKET.merchant.y * TILE - 90, 15, C.coral, 'center', 900, null), 4))
    const mine = MARKET.myStall
    tall.push({ y: (mine.y + mine.h) * TILE, draw: () => drawStall(ctx, mine.x * TILE, mine.y * TILE, mine.w * TILE, mine.h * TILE, clock, (gx, gy) => home.s.stall.forEach((o, i) => drawItem(ctx, o.item, gx + (i - 1) * 40, gy - 6, 28))) })
    bubbles.push(() => nameTag(t.myStall, (mine.x + mine.w / 2) * TILE, (mine.y + mine.h) * TILE + 6, C.gold, C.text))
    const fruits: FruitId[] = ['orange', 'mango', 'cacao']
    MARKET.stalls.forEach((r, i) => tall.push({ y: (r.y + r.h) * TILE, draw: () => drawStall(ctx, r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, clock + i, (gx, gy) => drawBasket(ctx, fruits[i % 3], gx, gy, 46)) }))
    tall.push({ y: MARKET.fountain.y * TILE + 10, draw: () => drawDecor(ctx, 'fountain', MARKET.fountain.x * TILE, MARKET.fountain.y * TILE, clock) })
    for (const [x, y] of MARKET.palms) tall.push({ y: y * TILE, draw: () => drawPalm(ctx, x * TILE, y * TILE, 120, clock) })
    for (const s of shoppers.values()) {
      tall.push({
        y: s.y,
        draw: () => {
          drawFarmer(ctx, s.look, s.x, s.y, 46, clock + s.id.length, s.facing, s.walking || Math.hypot(s.tx - s.x, s.ty - s.y) > 2)
          nameTag(`${clip(s.name, 14)}${s.offers.length ? ' · 🛒' : ''}`, s.x, s.y + 4, s.offers.length ? C.gold : C.paper, C.text)
        },
      })
      if (s.emote) {
        const e = s.emote
        tall.push({ y: 1e9 - 1, draw: () => emoteBubble(e.text, s.x, s.y - 70, e.life) })
      }
    }
  } else if (ruins) {
    const pad = RUINS.pad
    tall.push({ y: pad.y * TILE, draw: () => drawBalloon(ctx, pad.x * TILE, pad.y * TILE, 110, clock) })
    tall.push({ y: RUINS.keeper.y * TILE, draw: () => drawKeeper(ctx, RUINS.keeper.x * TILE, RUINS.keeper.y * TILE, 80, clock) })
    if (keeperHasNews()) bubbles.push(() => bubble(RUINS.keeper.x * TILE, RUINS.keeper.y * TILE - 120, 16, () => text('!', RUINS.keeper.x * TILE, RUINS.keeper.y * TILE - 120, 20, C.plum, 'center', 900, null), 5))
    RUINS.plots.forEach((p, plot) => {
      const c = home.crystal(plot)
      const growth = home.crystalGrowth(plot)
      tall.push({ y: p.y * TILE, draw: () => drawCrystalPlot(ctx, p.x * TILE, p.y * TILE, 70, c ? c.kind : null, growth, !!c && growth >= 1, clock) })
    })
    RUINS.lanterns.forEach((p, i) => tall.push({ y: p.y * TILE, draw: () => drawLantern(ctx, p.x * TILE, p.y * TILE, 70, home.lanternLit(i), clock) }))
    const step = home.ruins.runeStep
    RUINS.runes.forEach((p, i) => {
      const active = home.ruins.quest > 3 || home.ruins.runeOrder.slice(0, step).includes(i)
      tall.push({ y: p.y * TILE, draw: () => drawRune(ctx, i, p.x * TILE, p.y * TILE, 70, active, clock) })
    })
    const m = RUINS.mural
    tall.push({ y: (m.y + m.h) * TILE, draw: () => drawMural(ctx, m.x * TILE, m.y * TILE, m.w * TILE, m.h * TILE, home.ruins.runeOrder, clock) })
    for (const [x, y, broken] of RUINS.statues) tall.push({ y: y * TILE, draw: () => drawStatue(ctx, x * TILE, y * TILE, 80, broken) })
    if (home.bridgeOpen()) tall.push({ y: RUINS.altar.y * TILE, draw: () => drawAltar(ctx, RUINS.altar.x * TILE, RUINS.altar.y * TILE, 100, home.ruins.quest === 4 ? home.ruins.stardust : 0, home.ruins.quest >= 4, clock) })
    RUINS.dust.forEach((p, i) => {
      if (dustVisible(i)) tall.push({ y: p.y * TILE, draw: () => drawStardust(ctx, p.x * TILE, p.y * TILE, clock) })
    })
  }
  const walking = Math.hypot(farmer.tx - farmer.x, farmer.ty - farmer.y) > 2 || (started && !panel && [...held].some((k) => KEYS[k]))
  tall.push({
    y: farmer.y,
    draw: () => {
      drawFarmer(ctx, look(), farmer.x, farmer.y, 46, clock, farmer.facing, walking)
      if (shoppers.size) nameTag(clip(myName(), 16), farmer.x, farmer.y + 4, C.gold, C.text)
    },
  })
  if (myEmote) {
    const e = myEmote
    tall.push({ y: 1e9 - 1, draw: () => emoteBubble(e.text, farmer.x, farmer.y - 70, e.life) })
  }
  if (keyboard && started && !panel && !travel && nearInteractive()) {
    const hx = farmer.x
    const hy = farmer.y - 76 - Math.abs(Math.sin(clock * 4)) * 4
    tall.push({
      y: 1e9,
      draw: () => {
        ctx.font = '900 13px ' + FONT
        const w = ctx.measureText(t.use).width + 20
        roundRect(ctx, hx - w / 2, hy - 12, w, 24, 12)
        paint(ctx, C.text, 1.5)
        text(t.use, hx, hy, 13, '#fff', 'center', 900, null)
      },
    })
  }
  tall.sort((a, b) => a.y - b.y).forEach((item) => item.draw())
  for (const b of bubbles) b()
  if (!ruins) drawButterflies()
  for (const r of rings) {
    ctx.strokeStyle = r.color.replace(/[\d.]+\)$/, `${r.life * 0.9})`)
    ctx.lineWidth = 3 * r.life
    ctx.beginPath()
    ctx.ellipse(r.x, r.y, 10 + (1 - r.life) * 30, 4 + (1 - r.life) * 12, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  // The light: the hour (the ruins keep their own violet dusk).
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = ruins ? (l.night > 0.5 ? '#9c94d8' : '#cfc6f2') : l.tint
  ctx.fillRect(-4 * TILE, -4 * TILE, W + 8 * TILE, H + 8 * TILE)
  ctx.globalCompositeOperation = 'lighter'
  const k = ruins ? 1 : l.night
  if (k > 0.02) {
    const warm = 'rgba(255, 196, 110, A)'
    glow(farmer.x, farmer.y - 26, 140, 'rgba(255, 214, 140, A)', ruins ? 0.6 : k)
    if (scene === 'orchard') glow((ORCHARD.hut.x + ORCHARD.hut.w / 2) * TILE, (ORCHARD.hut.y + ORCHARD.hut.h * 0.8) * TILE, 90, warm, k)
    if (scene === 'market') for (const r of [MARKET.merchantStall, MARKET.myStall, ...MARKET.stalls]) glow((r.x + r.w / 2) * TILE, (r.y + r.h * 0.6) * TILE, 90, warm, k * 0.8)
    if (scene === 'orchard' || scene === 'market') {
      const pier = scene === 'orchard' ? ORCHARD.pier : MARKET.pier
      glow(pier.x * TILE, (pier.y + pier.length) * TILE - 40, 80, warm, k)
    }
    if (ruins) {
      RUINS.lanterns.forEach((p, i) => home.lanternLit(i) && glow(p.x * TILE, p.y * TILE - 50, 130, warm, 1))
      RUINS.plots.forEach((p, i) => home.crystal(i) && glow(p.x * TILE, p.y * TILE - 30, 60, 'rgba(200, 170, 255, A)', 0.7))
      glow(RUINS.keeper.x * TILE, RUINS.keeper.y * TILE - 60, 90, 'rgba(190, 150, 255, A)', 0.8)
      for (const s of spirits) glow(s.x, s.y, 50, s.hue, 0.9)
    }
  }
  ctx.globalCompositeOperation = 'source-over'
  if (ruins) spirits.forEach((s, i) => drawSpirit(ctx, s.x, s.y + Math.sin(clock * 2 + i) * 4, 7, clock + i, s.hue))
  else {
    drawShootingStars(l)
    drawFireflies(Math.max(l.dusk, l.night * 0.8))
  }
  for (const p of particles) {
    if (p.screen) continue
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5)
    ctx.fillStyle = p.color
    if (p.puff) ellipse(ctx, p.x, p.y, p.size * (1.6 - p.life / p.max), p.size * 0.7 * (1.6 - p.life / p.max), p.color)
    else if (p.star) star4(ctx, p.x, p.y, p.size * 0.8)
    else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
  for (const f of floats) {
    const kk = 1 - f.life
    ctx.globalAlpha = Math.min(1, f.life * 2)
    text(f.text, f.x, f.y, f.size * (kk < 0.15 ? easeBack(kk / 0.15) : 1), f.color)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

/** On another island: its name, and the way home. */
function drawIslandBanner() {
  if (scene === 'home') return
  const title = t.islands[scene]
  const left = 205 * ui
  const right = width - 154 * ui
  const roomy = right - left >= 250 * ui
  const w = roomy ? Math.min(right - left - 12 * ui, 340 * ui) : Math.min(width - 32 * ui, 340 * ui)
  const x = roomy ? (left + right - w) / 2 : (width - w) / 2
  const y = (roomy ? 12 * ui : 98 * ui) + Math.sin(clock * 2) * 2 * ui
  card(x, y, w, 46 * ui, 16 * ui, scene === 'ruins' ? '#d8c8ff' : C.mint, 2.5)
  text(title, x + 16 * ui, y + 23 * ui, fitSize(title, w - 150 * ui, 15 * ui, 900), C.text, 'left', 900, null)
  button('🏠 ' + t.goHome, x + w - 124 * ui, y + 6 * ui, 116 * ui, 34 * ui, C.coral, !travel, () => travelTo('home'))
}

// Panels of the islands.

/** Lines of a text that fit in `maxW` pixels. */
function wrap(value: string, maxW: number, size: number, weight = 700) {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`
  const lines: string[] = []
  let line = ''
  for (const word of value.split(' ')) {
    const next = line ? line + ' ' + word : word
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function drawTravelPanel(kind: 'dock' | 'pad') {
  const transport: TransportId = kind === 'dock' ? 'ferry' : 'balloon'
  const box = panelFrame(scene === 'home' ? t.transports[transport] : t.travel, 560, 400, kind === 'pad' ? C.plum : C.sky)
  const x = box.x + 18 * ui
  const w = box.w - 36 * ui
  if (scene !== 'home') {
    const cx = box.x + box.w / 2
    if (kind === 'pad') drawBalloon(ctx, cx, box.y + box.h * 0.6, 120 * ui, clock)
    else drawFerry(ctx, cx, box.y + box.h * 0.45, 150 * ui, clock)
    button('🏠 ' + t.goBackHome, cx - 120 * ui, box.y + box.h - 64 * ui, 240 * ui, 48 * ui, C.teal, !travel, () => travelTo('home'))
    text(t.freeTrip, cx, box.y + box.h - 10 * ui, 11 * ui, C.muted, 'center', 800, null)
    buttons.push(box.close)
    return
  }
  if (!home.s.transport[transport]) {
    const info = TRANSPORT[transport]
    const cx = box.x + box.w / 2
    if (kind === 'pad') drawBalloon(ctx, cx, box.y + box.h * 0.55, 120 * ui, clock)
    else drawFerry(ctx, cx, box.y + box.h * 0.4, 160 * ui, clock)
    text(t.transportHelp[transport], cx, box.y + box.h * 0.68, fitSize(t.transportHelp[transport], w, 14 * ui, 800), C.muted, 'center', 800, null)
    if (home.level < info.level) text('🔒 ' + t.levelNeeded + ' ' + info.level, cx, box.y + box.h - 40 * ui, 18 * ui, C.muted, 'center', 900, null)
    else coinButton(info.price, cx - 100 * ui, box.y + box.h - 64 * ui, 200 * ui, 48 * ui, C.teal, home.s.coins >= info.price, () => bought(home.buyTransport(transport)))
    buttons.push(box.close)
    return
  }
  const dests = ISLAND_IDS.filter((id) => ISLANDS[id].transport === transport)
  const why = cannotLeave()
  const rowH = Math.min(96 * ui, (box.h - 30 * ui) / Math.max(2, dests.length))
  dests.forEach((id, i) => {
    const y = box.y + 12 * ui + i * rowH
    slot(x, y, w, rowH - 10 * ui)
    const mid = y + (rowH - 10 * ui) / 2
    // A little view of the island.
    ctx.save()
    roundRect(ctx, x + 10 * ui, y + 8 * ui, rowH - 26 * ui, rowH - 26 * ui, 12 * ui)
    ctx.clip()
    ctx.fillStyle = id === 'ruins' ? '#3a2c6b' : '#a8d672'
    ctx.fillRect(x, y, rowH, rowH)
    const s = rowH - 26 * ui
    if (id === 'orchard') drawFruitTree(ctx, 'mango', x + 10 * ui + s / 2, y + 8 * ui + s * 0.95, s * 0.75, 1, true, clock)
    else if (id === 'market') drawStall(ctx, x + 10 * ui + s * 0.1, y + 8 * ui + s * 0.1, s * 0.8, s * 0.8, clock, null)
    else drawKeeper(ctx, x + 10 * ui + s / 2, y + 8 * ui + s * 0.98, s * 0.8, clock)
    ctx.restore()
    const tx = x + rowH
    text(t.islands[id], tx, mid - 12 * ui, fitSize(t.islands[id], w - rowH - 160 * ui, 16 * ui, 900), C.text, 'left', 900, null)
    text(t.islandHelp[id], tx, mid + 10 * ui, fitSize(t.islandHelp[id], w - rowH - 160 * ui, 11 * ui, 700), C.muted, 'left', 700, null)
    const fare = ISLANDS[id].fare
    text(`${t.fare} : ${fare}`, x + w - 75 * ui, mid - 22 * ui, 11 * ui, C.muted, 'center', 900, null)
    button(kind === 'pad' ? t.takeOff : t.go, x + w - 140 * ui, mid - 14 * ui, 130 * ui, 40 * ui, kind === 'pad' ? C.plum : C.teal, !why && home.s.coins >= fare && !travel, () => travelTo(id), coinIcon)
  })
  if (why) text(why, box.x + box.w / 2, box.y + box.h - 12 * ui, 12 * ui, C.coral, 'center', 800, null)
  buttons.push(box.close)
}

function drawTreePanel(spot: number) {
  const tree = home.tree(spot)
  const box = panelFrame(tree ? t.items[tree.fruit] : t.plantTree, 560, 420, C.leafDark)
  const x = box.x + 18 * ui
  const w = box.w - 36 * ui
  if (tree) {
    const cx = box.x + box.w * 0.3
    const growth = home.treeGrowth(spot)
    const ready = growth >= 1 && home.treeReady(spot)
    drawFruitTree(ctx, tree.fruit, cx, box.y + box.h * 0.82, 200 * ui, growth, ready, clock)
    const info = FRUITS[tree.fruit]
    const tx = box.x + box.w * 0.58
    const left = Math.max(0, Math.ceil((growth < 1 ? tree.grownAt : tree.readyAt) - home.clock))
    const status = ready ? t.ready : growth < 1 ? `${t.growing} · ${Math.ceil(left / 60)} min` : `${t.fruitsIn} ${left} s`
    text(status, tx, box.y + box.h * 0.25, 16 * ui, C.text, 'left', 900, null)
    text(`${info.yield} × ${t.items[tree.fruit]} / ${Math.round(info.every / 60)} min`, tx, box.y + box.h * 0.36, 12 * ui, C.muted, 'left', 800, null)
    if (ready) button(t.collect, tx, box.y + box.h * 0.5, 180 * ui, 44 * ui, C.teal, true, () => {
      panel = null
      interact({ kind: 'tree', spot })
    })
    sellButton('tree:' + spot, `${t.pullUp} · ${Math.floor(info.price * RESALE)}`, tx, box.y + box.h * 0.72, 180 * ui, 40 * ui, true, () => {
      const coins = home.pullTree(spot)
      if (coins) panel = null
      return coins || false
    })
    buttons.push(box.close)
    return
  }
  text(t.treeHelp, box.x + box.w / 2, box.y + 14 * ui, fitSize(t.treeHelp, w, 12 * ui, 800), C.muted, 'center', 800, null)
  const fruits = Object.keys(FRUITS) as FruitId[]
  const rowH = Math.min(80 * ui, (box.h - 40 * ui) / fruits.length)
  fruits.forEach((fruit, i) => {
    const info = FRUITS[fruit]
    const y = box.y + 32 * ui + i * rowH
    shopRow(x, y, w, rowH, () => drawFruit(ctx, fruit, x + rowH * 0.48, y + rowH * 0.42, rowH * 0.6), t.items[fruit], `${Math.round(info.grow / 60)} min · ${info.yield} / ${Math.round(info.every / 60)} min · ${ITEMS[fruit].price}`, info.level, info.price, () => {
      const result = home.plantTree(spot, fruit)
      if (result === 'ok') {
        panel = null
        const p = ORCHARD.spots[spot]
        burst(p.x * TILE, p.y * TILE - 20, 20, ['#7bc950', '#ffe08a', '#fff'], 0.8)
        rings.push({ x: p.x * TILE, y: p.y * TILE, life: 1, color: 'rgba(255, 245, 220, 0.9)' })
      }
      bought(result === 'busy' ? 'max' : result)
    })
  })
  buttons.push(box.close)
}

let merchantTab = 0
let merchantPage = 0

function drawMerchantPanel() {
  const box = panelFrame(t.merchant, 640, 490, C.sky)
  const day = today()
  // Tabs: sell your goods, buy goods, today's special and the decorations.
  const tw = (box.w - 24 * ui) / t.merchantTabs.length
  t.merchantTabs.forEach((label, i) => {
    const x = box.x + 12 * ui + i * tw
    const on = i === merchantTab
    roundRect(ctx, x + 3 * ui, box.y + 8 * ui - (on ? 3 * ui : 0), tw - 6 * ui, 34 * ui, 17 * ui)
    paint(ctx, on ? C.sky : C.paper2, 2)
    text(label, x + tw / 2, box.y + 25 * ui - (on ? 3 * ui : 0), fitSize(label, tw - 14 * ui, 13 * ui, 900), on ? '#fff' : C.text, 'center', 900, on ? 'rgba(61,42,69,0.5)' : null)
    buttons.push({ x, y: box.y + 8 * ui, w: tw, h: 34 * ui, enabled: true, action: () => ((merchantTab = i), (merchantPage = 0)) })
  })
  const x = box.x + 16 * ui
  const w = box.w - 32 * ui
  const top = box.y + 52 * ui
  const bottom = box.y + box.h - 44 * ui
  const pager = <T,>(list: T[], perPage: number): T[] => {
    const pages = Math.max(1, Math.ceil(list.length / perPage))
    merchantPage = Math.min(merchantPage, pages - 1)
    if (pages > 1) {
      const bw = 44 * ui
      button('◀', x + w / 2 - bw - 50 * ui, bottom + 6 * ui, bw, 32 * ui, C.sky, merchantPage > 0, () => merchantPage--)
      text(`${merchantPage + 1} / ${pages}`, x + w / 2, bottom + 20 * ui, 14 * ui, C.text, 'center', 900, null)
      button('▶', x + w / 2 + 50 * ui, bottom + 6 * ui, bw, 32 * ui, C.sky, merchantPage < pages - 1, () => merchantPage++)
    }
    return list.slice(merchantPage * perPage, merchantPage * perPage + perPage)
  }
  const cell = 104 * ui
  const cols = Math.max(1, Math.floor(w / cell))
  if (merchantTab === 0) {
    // Sell: everything in the barn, at its price (twice for today's special).
    const wanted = home.merchantWants(day)
    const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => home.count(id) > 0)
    const value = home.barnValue()
    if (!items.length) text(t.emptyBarn, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, C.muted, 'center', 800, null)
    else sellButton('market-all', `${t.sellAll} · ${value}`, x + w - 200 * ui, top, 200 * ui, 36 * ui, value > 0, () => home.sellAll())
    const rows = Math.max(1, Math.floor((bottom - top - 44 * ui) / (cell * 1.02)))
    const x0 = x + (w - cols * cell) / 2
    pager(items, cols * rows).forEach((id, i) => {
      const cx = x0 + (i % cols) * cell
      const cy = top + 44 * ui + Math.floor(i / cols) * cell * 1.02
      slot(cx + 4, cy, cell - 8, cell)
      drawItem(ctx, id, cx + cell / 2, cy + cell * 0.3, cell * 0.34)
      text(`x${home.count(id)}`, cx + cell - 14 * ui, cy + 13 * ui, 13 * ui, C.text, 'right', 900, null)
      const special = id === wanted && home.merchantLeft(day) > 0
      if (special) text('×2', cx + 18 * ui, cy + 13 * ui, 12 * ui, C.coral, 'center', 900, null)
      button(`${t.sell} ${ITEMS[id].price * (special ? 2 : 1)}`, cx + 11 * ui, cy + cell * 0.62, cell - 22 * ui, cell * 0.3, special ? C.coral : C.gold, true, () => {
        const coins = special ? home.sellToMerchant(day, 1) : home.sell(id, 1)
        if (coins) {
          flyCoins(cx + cell / 2, cy + cell * 0.6, coins)
          sound.coin()
          changed()
        }
      })
    })
  } else if (merchantTab === 1) {
    // Buy: goods you can make (or have made), at twice their price.
    const goods = (Object.keys(ITEMS) as ItemId[]).filter((id) => ITEMS[id].level <= home.level || home.producible().includes(id))
    const rows = Math.max(1, Math.floor((bottom - top) / (cell * 1.02)))
    const x0 = x + (w - cols * cell) / 2
    pager(goods, cols * rows).forEach((id, i) => {
      const cx = x0 + (i % cols) * cell
      const cy = top + Math.floor(i / cols) * cell * 1.02
      slot(cx + 4, cy, cell - 8, cell)
      drawItem(ctx, id, cx + cell / 2, cy + cell * 0.3, cell * 0.34)
      if (home.count(id)) text(`x${home.count(id)}`, cx + cell - 14 * ui, cy + 13 * ui, 12 * ui, C.muted, 'right', 900, null)
      const price = home.buyPrice(id)
      coinButton(price, cx + 11 * ui, cy + cell * 0.62, cell - 22 * ui, cell * 0.3, C.teal, home.s.coins >= price, () => {
        const result = home.buyGoods(id, 1)
        if (result === 'ok') {
          flyToBarn(id, farmer.x, farmer.y - 40, 1)
          sound.buy()
          changed()
        } else if (result === 'full') barnFull(farmer.x, farmer.y - 60)
        else sound.denied()
      })
    })
  } else {
    // Today's special, and the decorations only sold here.
    const wanted = home.merchantWants(day)
    const left = home.merchantLeft(day)
    drawMerchant(ctx, x + 46 * ui, top + 130 * ui, 100 * ui, clock)
    const tx = x + 104 * ui
    text(t.merchantHello, tx, top + 10 * ui, fitSize(t.merchantHello, w - 110 * ui, 13 * ui, 800), C.text, 'left', 800, null)
    slot(tx, top + 24 * ui, w - 104 * ui, 88 * ui)
    drawItem(ctx, wanted, tx + 40 * ui, top + 64 * ui, 46 * ui)
    const label = `${t.items[wanted]} · ${ITEMS[wanted].price * 2} (×2)`
    text(label, tx + 80 * ui, top + 48 * ui, fitSize(label, w - 210 * ui, 15 * ui, 900), C.text, 'left', 900, null)
    text(left > 0 ? `x${home.count(wanted)} · ${left} / ${MERCHANT_MAX}` : t.merchantDone, tx + 80 * ui, top + 70 * ui, 12 * ui, C.muted, 'left', 800, null)
    const have = Math.min(home.count(wanted), left)
    button(t.sellAll, tx + 80 * ui, top + 80 * ui, 130 * ui, 28 * ui, C.coral, have >= 1, () => {
      const coins = home.sellToMerchant(day, have)
      if (coins) {
        flyCoins(tx + 140 * ui, top + 90 * ui, coins)
        sound.buy()
        changed()
      }
    })
    text(t.exclusives, x, top + 134 * ui, fitSize(t.exclusives, w, 13 * ui, 800), C.text, 'left', 800, null)
    const kinds = (Object.keys(DECORS) as DecorKind[]).filter((k) => DECORS[k].where === 'market')
    const cw = w / kinds.length
    const cy = top + 148 * ui
    const ch = Math.min(150 * ui, box.y + box.h - cy - 10 * ui)
    kinds.forEach((kind, i) => {
      const cx = x + i * cw
      slot(cx + 5 * ui, cy, cw - 10 * ui, ch)
      ctx.save()
      ctx.translate(cx + cw / 2, cy + ch * 0.5)
      ctx.scale(ui * 0.9, ui * 0.9)
      drawDecor(ctx, kind, 0, 0, clock)
      ctx.restore()
      text(t.decors[kind] + (home.stockOf(kind) ? ` · x${home.stockOf(kind)}` : ''), cx + cw / 2, cy + ch * 0.6, fitSize(t.decors[kind], cw - 20 * ui, 12 * ui, 900), C.text, 'center', 900, null)
      const info = DECORS[kind]
      if (home.level < info.level) text('🔒 ' + t.levelNeeded + ' ' + info.level, cx + cw / 2, cy + ch * 0.8, 12 * ui, C.muted, 'center', 800, null)
      else coinButton(info.price, cx + cw * 0.17, cy + ch * 0.7, cw * 0.66, 32 * ui, C.gold, home.s.coins >= info.price, () => bought(home.buyStock(kind)))
    })
  }
  buttons.push(box.close)
}

let stallDraft: { item: ItemId | null; count: number; price: number } = { item: null, count: 1, price: 0 }

function drawStallPanel() {
  const box = panelFrame(t.myStall, 620, 480, C.gold)
  const x = box.x + 18 * ui
  const w = box.w - 36 * ui
  text(t.stallHelp, box.x + box.w / 2, box.y + 12 * ui, fitSize(t.stallHelp, w, 12 * ui, 800), C.muted, 'center', 800, null)
  // Current offers.
  const rowH = 46 * ui
  for (let i = 0; i < STALL_OFFERS; i++) {
    const y = box.y + 28 * ui + i * rowH
    slot(x, y, w, rowH - 6 * ui, home.s.stall[i] ? C.paper2 : '#f3ede4')
    const o = home.s.stall[i]
    const mid = y + (rowH - 6 * ui) / 2
    if (!o) {
      text('—', x + 24 * ui, mid, 14 * ui, C.muted, 'center', 900, null)
      continue
    }
    drawItem(ctx, o.item, x + 24 * ui, mid, 26 * ui)
    text(`${o.count} × ${t.items[o.item]} · ${o.price}`, x + 46 * ui, mid, fitSize(`${o.count} × ${t.items[o.item]} · ${o.price}`, w - 180 * ui, 14 * ui, 900), C.text, 'left', 900, null)
    drawCoin(ctx, x + w - 150 * ui, mid, 7 * ui)
    button(t.removeOffer, x + w - 120 * ui, mid - 15 * ui, 110 * ui, 30 * ui, '#a99bb0', true, () => {
      home.removeOffer(i)
      sound.plant()
      changed()
    })
  }
  // A new offer: pick goods, how many, the price.
  const y0 = box.y + 28 * ui + STALL_OFFERS * rowH + 8 * ui
  const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => home.count(id) > 0)
  if (stallDraft.item && home.count(stallDraft.item) <= 0) stallDraft = { item: null, count: 1, price: 0 }
  const cell = 46 * ui
  const cols = Math.max(1, Math.floor(w / cell))
  items.slice(0, cols * 2).forEach((id, i) => {
    const cx = x + (i % cols) * cell
    const cy = y0 + Math.floor(i / cols) * cell
    const on = stallDraft.item === id
    roundRect(ctx, cx + 2, cy + 2, cell - 4, cell - 4, 10 * ui)
    paint(ctx, on ? '#ffe7a0' : C.paper2, 1.5)
    drawItem(ctx, id, cx + cell / 2, cy + cell / 2, cell * 0.55)
    buttons.push({ x: cx, y: cy, w: cell, h: cell, enabled: true, action: () => (stallDraft = { item: id, count: 1, price: ITEMS[id].price }) })
  })
  if (!items.length) text(t.emptyBarn, box.x + box.w / 2, y0 + 30 * ui, 13 * ui, C.muted, 'center', 800, null)
  const yb = y0 + cell * 2 + 10 * ui
  const d = stallDraft
  if (d.item) {
    const maxCount = Math.min(STALL_MAX, home.count(d.item))
    const step = (label: string, value: number, bx: number, change: (v: number) => void, min: number, max: number) => {
      text(label, bx + 70 * ui, yb, 11 * ui, C.muted, 'center', 800, null)
      button('−', bx, yb + 10 * ui, 36 * ui, 32 * ui, C.sky, value > min, () => change(Math.max(min, value - (label === t.unitPrice && value > 20 ? 5 : 1))))
      text(String(value), bx + 70 * ui, yb + 26 * ui, 16 * ui, C.text, 'center', 900, null)
      button('+', bx + 104 * ui, yb + 10 * ui, 36 * ui, 32 * ui, C.sky, value < max, () => change(Math.min(max, value + (label === t.unitPrice && value >= 20 ? 5 : 1))))
    }
    step('×', d.count, x, (v) => (stallDraft = { ...d, count: v }), 1, maxCount)
    step(t.unitPrice, d.price, x + 160 * ui, (v) => (stallDraft = { ...d, price: v }), 1, 9999)
    const full = home.s.stall.length >= STALL_OFFERS && !home.s.stall.some((o) => o.item === d.item && o.price === d.price)
    button(full ? t.stallFull : t.addOffer, x + w - 180 * ui, yb + 6 * ui, 180 * ui, 40 * ui, C.teal, !full, () => {
      if (d.item && home.addOffer(d.item, d.count, d.price) === 'ok') {
        sound.buy()
        stallDraft = { item: null, count: 1, price: 0 }
        persist()
      } else sound.denied()
    })
  }
  if (!marketRoom) text(play.canJoinRooms ? t.marketEmpty : t.onlineUnavailable, box.x + box.w / 2, box.y + box.h - 12 * ui, 11 * ui, C.muted, 'center', 800, null)
  buttons.push(box.close)
}

/** Another player at the market: their stall. */
function drawSellerPanel(id: string) {
  const s = shoppers.get(id)
  if (!s) {
    panel = null
    return
  }
  const box = panelFrame(`${t.stallOf} ${clip(s.name, 16)}`, 560, 380, C.gold)
  const x = box.x + 18 * ui
  const w = box.w - 36 * ui
  drawFarmer(ctx, s.look, x + 50 * ui, box.y + box.h * 0.7, 120 * ui, clock, 1, false)
  const tx = x + 110 * ui
  const tw = w - 110 * ui
  if (!s.offers.length) text(t.noOffers, tx + tw / 2, box.y + box.h / 2, 14 * ui, C.muted, 'center', 800, null)
  const rowH = Math.min(80 * ui, (box.h - 70 * ui) / 3)
  s.offers.forEach((o, i) => {
    const y = box.y + 12 * ui + i * rowH
    slot(tx, y, tw, rowH - 8 * ui)
    const mid = y + (rowH - 8 * ui) / 2
    drawItem(ctx, o.i, tx + 30 * ui, mid, 34 * ui)
    text(`${o.c} × ${t.items[o.i]}`, tx + 58 * ui, mid - 9 * ui, fitSize(`${o.c} × ${t.items[o.i]}`, tw - 230 * ui, 14 * ui, 900), C.text, 'left', 900, null)
    text(`${o.p} / 1`, tx + 58 * ui, mid + 11 * ui, 12 * ui, C.goldDark, 'left', 900, null)
    const busy = pendingBuys.size > 0
    coinButton(o.p, tx + tw - 200 * ui, mid - 16 * ui, 90 * ui, 32 * ui, C.teal, !busy && home.s.coins >= o.p, () => buyFrom(id, o, 1))
    button(`× ${o.c}`, tx + tw - 102 * ui, mid - 16 * ui, 92 * ui, 32 * ui, C.coral, !busy && o.c > 1 && home.s.coins >= o.p * o.c, () => buyFrom(id, o, o.c))
  })
  const room = marketRoom
  button('👋 ' + t.wave, x, box.y + box.h - 50 * ui, 100 * ui, 38 * ui, C.sky, !!room, () => {
    if (room) safely(() => room.send({ type: 'wave' }, id))
    myEmote = { text: '👋 ' + t.hello, life: 2.5 }
  })
  buttons.push(box.close)
}

function drawKeeperPanel() {
  const box = panelFrame(t.keeper, 600, 460, C.plum)
  const x = box.x + 18 * ui
  const w = box.w - 36 * ui
  drawKeeper(ctx, x + 60 * ui, box.y + box.h * 0.62, 150 * ui, clock)
  const tx = x + 130 * ui
  const tw = w - 130 * ui
  const r = home.ruins
  const day = today()
  if (r.quest >= RUIN_QUESTS.length) {
    text(t.starKeeper, tx, box.y + 26 * ui, 16 * ui, C.plumDark, 'left', 900, null)
    wrap(t.questsDone, tw, 13 * ui).forEach((line, i) => text(line, tx, box.y + 56 * ui + i * 18 * ui, 13 * ui, C.text, 'left', 700, null))
    slot(tx, box.y + 120 * ui, tw, 96 * ui)
    drawCrystal(ctx, 'crystalPink', tx + 40 * ui, box.y + 168 * ui, 50 * ui, clock)
    text(t.dailyOffering, tx + 80 * ui, box.y + 150 * ui, fitSize(t.dailyOffering, tw - 90 * ui, 13 * ui, 900), C.text, 'left', 900, null)
    text(r.offeringDay === day ? t.offeringDone : `x${home.count('crystalPink')} · +300`, tx + 80 * ui, box.y + 172 * ui, 12 * ui, C.muted, 'left', 800, null)
    button(t.handIn, tx + 80 * ui, box.y + 184 * ui, 130 * ui, 28 * ui, C.plum, home.canOffer(day), () => {
      const coins = home.offer(day)
      if (coins) {
        flyCoins(width / 2, height / 2, coins)
        sound.order()
        persist()
      }
    })
    if (home.stockOf('starshard')) text(t.shardReady, tx, box.y + box.h - 16 * ui, fitSize(t.shardReady, tw, 11 * ui, 800), C.muted, 'left', 800, null)
    buttons.push(box.close)
    return
  }
  const quest = RUIN_QUESTS[r.quest]
  text(`${r.quest + 1}/${RUIN_QUESTS.length} · ${t.questNames[quest.id]}`, tx, box.y + 24 * ui, fitSize(t.questNames[quest.id], tw, 16 * ui, 900), C.plumDark, 'left', 900, null)
  wrap(t.questText[quest.id], tw, 13 * ui).forEach((line, i) => text(line, tx, box.y + 54 * ui + i * 19 * ui, 13 * ui, C.text, 'left', 700, null))
  const p = home.questProgress()
  const by = box.y + box.h - 120 * ui
  roundRect(ctx, tx, by, tw, 14 * ui, 7 * ui)
  paint(ctx, '#e8e0f5', 1.5)
  roundRect(ctx, tx, by, tw * Math.min(1, p.have / p.need), 14 * ui, 7 * ui)
  paint(ctx, C.plum)
  text(`${p.have} / ${p.need}`, tx + tw / 2, by + 26 * ui, 12 * ui, C.text, 'center', 900, null)
  if (r.quest === 4 && light.night < 0.5) text(t.stardustNight, tx + tw / 2, by - 12 * ui, 11 * ui, C.coral, 'center', 800, null)
  text(`${t.reward} : ${quest.coins}`, tx, box.y + box.h - 56 * ui + 14 * ui, 13 * ui, C.goldDark, 'left', 900, null)
  button(r.quest === 4 ? '★ ' + t.handIn : t.handIn, tx + tw - 160 * ui, box.y + box.h - 62 * ui, 160 * ui, 44 * ui, C.plum, home.canHandIn() && r.quest !== 4, () => handInQuest({ x: RUINS.keeper.x * TILE, y: RUINS.keeper.y * TILE }))
  buttons.push(box.close)
}

// --- interface -------------------------------------------------------------------------------

let shownCoins = -1
const coinChip = { x: 0, y: 0 }
const barnButton = { x: 0, y: 0 }

function drawHud() {
  // Profile: the player's picture from the website (or their farmer), name, level and XP.
  const r = 25 * ui
  const cx = 16 * ui + r
  const cy = 14 * ui + r
  const name = clip(myName(), 15)
  card(cx, cy - 19 * ui, 156 * ui, 38 * ui, 19 * ui, C.paper, 2)
  text(name, cx + r + 8 * ui, cy - 6 * ui, fitSize(name, 110 * ui, 13 * ui, 900), C.text, 'left', 900, null)
  roundRect(ctx, cx + r + 8 * ui, cy + 4 * ui, 104 * ui, 9 * ui, 4.5 * ui)
  paint(ctx, '#eadfce', 1.5)
  const xp = Math.max(0.06, home.levelProgress())
  roundRect(ctx, cx + r + 8 * ui, cy + 4 * ui, 104 * ui * xp, 9 * ui, 4.5 * ui)
  paint(ctx, '#7fcf5a')
  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  const shine = ((clock * 0.4) % 1.4) - 0.2
  if (shine > 0 && shine < xp) ctx.fillRect(cx + r + 8 * ui + 104 * ui * shine, cy + 5 * ui, 6 * ui, 7 * ui)
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#cfe9ff'
  ctx.fill()
  ctx.clip()
  if (playerImageReady) ctx.drawImage(playerImage, cx - r, cy - r, r * 2, r * 2)
  else drawFarmerFace(ctx, look(), cx, cy + r * 0.12, r * 1.7, clock)
  ctx.restore()
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  // Level, on a gold badge (it pops when the level goes up).
  const pop = levelBanner ? 1 + Math.max(0, Math.sin((3.5 - levelBanner.life) * 8)) * 0.25 * clamp01(levelBanner.life - 2.5) : 1
  const br = 11 * ui * pop
  ellipse(ctx, cx - r * 0.78, cy + r * 0.7, br, br, C.gold, 0, 2)
  text(String(home.level), cx - r * 0.78, cy + r * 0.72, fitSize(String(home.level), br * 1.6, 12 * ui * pop, 900), '#fff', 'center', 900)
  buttons.push({ x: cx - r, y: cy - r, w: r * 2 + 156 * ui, h: r * 2, enabled: !visit, action: () => (panel = 'avatar') })
  // Settings: a gear under the profile.
  const gx = cx
  const gy = cy + r + 22 * ui
  const gr = 17 * ui
  const gh = inside({ x: gx - gr, y: gy - gr, w: gr * 2, h: gr * 2 }, mouse)
  ellipse(ctx, gx + 1, gy + 3, gr, gr, 'rgba(61,42,69,0.2)')
  ellipse(ctx, gx, gy, gr, gr, gh ? '#ffffff' : C.paper, 0, 2)
  ctx.save()
  ctx.translate(gx, gy)
  ctx.rotate(gh ? clock * 2 : 0)
  ctx.beginPath()
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    const rr = i % 2 ? gr * 0.62 : gr * 0.48
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  paint(ctx, C.muted, 1.5)
  ellipse(ctx, 0, 0, gr * 0.2, gr * 0.2, C.paper)
  ctx.restore()
  buttons.push({ x: gx - gr, y: gy - gr, w: gr * 2, h: gr * 2, enabled: true, action: () => (panel = 'settings') })
  // Energy.
  const ex = gx + gr + 8 * ui
  const ew = 112 * ui
  const eh = 22 * ui
  const e = home.energy / ENERGY.max
  const low = e < 0.2
  card(ex, gy - eh / 2, ew, eh, eh / 2, C.paper, 2)
  ctx.beginPath()
  const bx = ex + 13 * ui
  const by = gy
  ctx.moveTo(bx + 2 * ui, by - 7 * ui)
  ctx.lineTo(bx - 4 * ui, by + 1 * ui)
  ctx.lineTo(bx, by + 1 * ui)
  ctx.lineTo(bx - 2 * ui, by + 7 * ui)
  ctx.lineTo(bx + 4 * ui, by - 1 * ui)
  ctx.lineTo(bx, by - 1 * ui)
  ctx.closePath()
  paint(ctx, low ? C.coral : C.gold, 1.2)
  const barX = ex + 24 * ui
  const barW = ew - 58 * ui
  roundRect(ctx, barX, gy - 4 * ui, barW, 8 * ui, 4 * ui)
  paint(ctx, '#eadfce', 1.2)
  const pulse = low ? 0.6 + 0.4 * Math.sin(clock * 6) : 1
  ctx.globalAlpha = pulse
  roundRect(ctx, barX, gy - 4 * ui, barW * Math.max(0.04, e), 8 * ui, 4 * ui)
  paint(ctx, e > 0.5 ? '#7fcf5a' : e > 0.2 ? C.gold : C.coral)
  ctx.globalAlpha = 1
  text(String(Math.floor(home.energy)), ex + ew - 10 * ui, gy, 11 * ui, C.text, 'right', 900, null)
  buttons.push({ x: ex, y: gy - eh / 2, w: ew, h: eh, enabled: true, action: () => (toast = { title: `⚡ ${Math.floor(home.energy)} / ${ENERGY.max}`, text: t.energyHelp, life: 3.5 }) })
  // Coins, counting up and down.
  if (shownCoins < 0) shownCoins = home.s.coins
  shownCoins += (home.s.coins - shownCoins) * Math.min(1, 0.15 + Math.abs(home.s.coins - shownCoins) * 0.0005)
  if (Math.abs(home.s.coins - shownCoins) < 0.5) shownCoins = home.s.coins
  const ly = 14 * ui
  const s = 1 + coinBump * 0.22
  card(width - 146 * ui, ly + 6 * ui, 130 * ui, 30 * ui, 15 * ui, C.paper, 2)
  coinChip.x = width - 132 * ui
  coinChip.y = ly + 21 * ui
  drawCoin(ctx, coinChip.x, coinChip.y, 15 * ui * s, coinBump * 6)
  text(String(Math.round(shownCoins)), width - 26 * ui, ly + 21 * ui, 17 * ui * s, C.text, 'right', 900, null)
  // Online: players connected, or "offline".
  if (play.canJoinRooms) {
    const oy = ly + 44 * ui
    const on = !!lobby
    const count = online.size + 1
    card(width - 146 * ui, oy, 130 * ui, 26 * ui, 13 * ui, on && online.size ? C.mint : C.paper, 2)
    const pulse = on ? 1 + Math.sin(clock * 4) * 0.25 : 1
    ellipse(ctx, width - 130 * ui, oy + 13 * ui, 5 * ui * pulse, 5 * ui * pulse, on ? '#3ccf6e' : '#bfb4c4', 0, 1.5)
    text(on ? `${count} ${t.online}` : t.offline, width - 26 * ui, oy + 13 * ui, 13 * ui, C.text, 'right', 900, null)
    buttons.push({ x: width - 146 * ui, y: oy, w: 130 * ui, h: 26 * ui, enabled: true, action: () => (panel = on ? 'online' : 'settings') })
  }
  drawClock(width - 146 * ui, ly + (play.canJoinRooms ? 76 : 44) * ui)
}

/** The time of day: the sun or the moon, and the hour (tap: settings). */
function drawClock(x: number, y: number) {
  const w = 130 * ui
  const h = 26 * ui
  const night = light.night > 0.5
  card(x, y, w, h, h / 2, night ? '#3b3a72' : C.paper, 2)
  const cx = x + 16 * ui
  const cy = y + h / 2
  if (night) {
    ellipse(ctx, cx, cy, 7 * ui, 7 * ui, '#fff6dc')
    ellipse(ctx, cx + 3.5 * ui, cy - 2 * ui, 6 * ui, 6 * ui, '#3b3a72')
  } else {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(clock * 0.5)
    ctx.fillStyle = C.gold
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-1 * ui, 6 * ui, 2 * ui, 3 * ui)
    }
    ctx.restore()
    ellipse(ctx, cx, cy, 5.5 * ui, 5.5 * ui, C.gold, 0, 1.5)
  }
  const fast = clockMode() === 'fast'
  text(formatHour(light.hour), x + w - 12 * ui, cy, 14 * ui, night ? '#fff6dc' : C.text, 'right', 900, null)
  if (fast) text('×60', x + 34 * ui, cy, 10 * ui, night ? '#c9c2ff' : C.muted, 'left', 900, null)
  buttons.push({ x, y, w, h, enabled: true, action: () => (panel = 'settings') })
}

function drawSeedBar() {
  const crops = farm.crops()
  const size = 56 * ui
  const total = crops.length * size + 14 * ui
  const x0 = 12 * ui
  seedBarRight = x0 + total
  const y0 = height - size - 18 * ui
  card(x0, y0 - 7 * ui, total, size + 14 * ui, 20 * ui, C.paper, 2.5)
  crops.forEach((crop, i) => {
    const x = x0 + 7 * ui + i * size
    const on = crop.id === selected && tool === 'seed'
    const lift = on ? 4 * ui + Math.abs(Math.sin(clock * 5)) * 2 * ui : 0
    if (on) {
      roundRect(ctx, x + 3, y0 - lift, size - 6, size, 14 * ui)
      paint(ctx, '#ffe7a0', 2)
    }
    const affordable = farm.s.coins >= crop.cost
    ctx.globalAlpha = affordable ? 1 : 0.4
    drawItem(ctx, crop.id, x + size / 2, y0 + size * 0.38 - lift, size * (on ? 0.56 : 0.5))
    drawCoin(ctx, x + size * 0.36, y0 + size * 0.84 - lift, 6 * ui)
    text(String(crop.cost), x + size * 0.48, y0 + size * 0.84 - lift, 12 * ui, C.text, 'left', 900, null)
    if (keyboard) text(String(i + 1), x + 10 * ui, y0 + 9 * ui - lift, 10 * ui, C.muted, 'center', 900, null)
    ctx.globalAlpha = 1
    buttons.push({
      x,
      y: y0,
      w: size,
      h: size,
      enabled: true,
      action: () => {
        selected = crop.id
        tool = 'seed'
        sound.plant()
      },
    })
  })
  if (farm.s.machines.tractor && farm === home) {
    // The tractor tool: tap a field to send the tractor.
    const x = x0 + total + 8 * ui
    card(x, y0 - 7 * ui, size + 4 * ui, size + 14 * ui, 20 * ui, tool === 'tractor' ? '#ffe7a0' : C.paper, 2.5)
    drawTractor(ctx, x + size / 2 + 2 * ui, y0 + size * 0.74, size * 0.62, 1, clock, !!tractor.job)
    seedBarRight = x + size + 4 * ui
    buttons.push({ x, y: y0 - 7 * ui, w: size + 4 * ui, h: size + 14 * ui, enabled: true, action: () => (tool = tool === 'tractor' ? 'seed' : 'tractor') })
  }
}

function drawMenuButtons() {
  const size = 60 * ui
  const narrow = seedBarRight + 8 * ui > width - size * 3 - 40 * ui
  const y = height - size - 18 * ui - (narrow ? size + 26 * ui : 0)
  menuY = y + size / 2
  if (visit) {
    // On a friend's farm: only the way home.
    const bw = 150 * ui
    button('🏠 ' + t.goHome, width - bw - 14 * ui, y + size * 0.15, bw, size * 0.8, C.coral, !travel, () => goHome(null))
    return
  }
  const entries: [string, number, () => void, number, string][] = [
    [t.shop, width - size * 3 - 40 * ui, () => (panel = 'shop'), 0, C.gold],
    [t.orders, width - size * 2 - 27 * ui, () => (panel = 'orders'), farm.s.orders.filter((_, i) => farm.canDeliver(i)).length, C.coral],
    [t.barn, width - size - 14 * ui, () => (panel = 'barn'), 0, C.teal],
  ]
  entries.forEach(([label, x, action, badge, color], i) => {
    const bump = i === 2 ? 1 + barnBump * 0.18 : 1
    const hovered = inside({ x, y, w: size, h: size }, mouse)
    const pressed = !!press && clock - press.at < 0.16 && inside({ x, y, w: size, h: size }, press)
    ctx.save()
    ctx.translate(x + size / 2, y + size / 2 + (pressed ? 3 : hovered ? -2 : 0))
    ctx.scale(bump, bump)
    card(-size / 2, -size / 2, size, size, 18 * ui, C.paper, 2.5)
    if (i === 2) drawBarn(ctx, -size * 0.3, -size * 0.36, size * 0.6, size * 0.5, clock)
    else if (i === 1) drawBoard(ctx, -size * 0.32, -size * 0.42, size * 0.64, size * 0.56, 3, clock)
    else {
      drawCoin(ctx, -size * 0.13, -size * 0.06, size * 0.16)
      drawCoin(ctx, size * 0.13, -size * 0.12, size * 0.15)
      drawCoin(ctx, 0, -size * 0.22, size * 0.13, clock * 2)
    }
    roundRect(ctx, -size * 0.46, size * 0.22, size * 0.92, size * 0.26, size * 0.13)
    paint(ctx, color, 2)
    text(label, 0, size * 0.35, fitSize(label, size * 0.84, 11 * ui, 900), '#fff', 'center', 900, 'rgba(61,42,69,0.5)')
    ctx.restore()
    if (badge) {
      const p = 1 + Math.sin(clock * 6) * 0.1
      ellipse(ctx, x + size - 4, y + 4, 11 * ui * p, 11 * ui * p, C.coral, 0, 2)
      text(String(badge), x + size - 4, y + 5, 12 * ui, '#fff', 'center', 900, null)
    }
    if (i === 2) {
      barnButton.x = x + size / 2
      barnButton.y = y + size / 2
    }
    buttons.push({ x, y, w: size, h: size, enabled: true, action })
  })
}

let panelKey = ''
let panelAt = 0
let framed = false

function panelFrame(title: string, wMax: number, hMax: number, color: string = C.teal) {
  const k = clamp01((clock - panelAt) / 0.3)
  ctx.fillStyle = `rgba(40, 25, 55, ${0.45 * easeOut(k * 1.4)})`
  ctx.fillRect(0, 0, width, height)
  buttons.push({ x: 0, y: 0, w: width, h: height, enabled: true, action: () => {} }) // blocks the farm
  const w = Math.min(width - 24, wMax * ui)
  const h = Math.min(height - 40 * ui, hMax * ui)
  const x = (width - w) / 2
  const y = (height - h) / 2 + 12 * ui
  const s = 0.82 + 0.18 * easeBack(k)
  framed = true
  ctx.save()
  ctx.translate(width / 2, y + h / 2)
  ctx.scale(s, s)
  ctx.translate(-width / 2, -(y + h / 2))
  card(x, y, w, h, 24 * ui, C.paper, 3)
  // The title on a ribbon.
  const size = fitSize(title, w * 0.62, 20 * ui, 900)
  ctx.font = `900 ${Math.round(size)}px ${FONT}`
  const rw = Math.min(w * 0.8, ctx.measureText(title).width + 64 * ui)
  const rh = 40 * ui
  const rx = (width - rw) / 2
  const ry = y - rh * 0.5
  for (const side of [-1, 1]) {
    const ex = side < 0 ? rx - 14 * ui : rx + rw + 14 * ui
    ctx.beginPath()
    ctx.moveTo(side < 0 ? rx + 10 * ui : rx + rw - 10 * ui, ry + 10 * ui)
    ctx.lineTo(ex, ry + 10 * ui)
    ctx.lineTo(ex + side * -8 * ui, ry + rh * 0.62)
    ctx.lineTo(ex, ry + rh + 6 * ui)
    ctx.lineTo(side < 0 ? rx + 10 * ui : rx + rw - 10 * ui, ry + rh + 6 * ui)
    ctx.closePath()
    paint(ctx, shade(color, -0.28), 2.5)
  }
  roundRect(ctx, rx, ry, rw, rh, 12 * ui)
  paint(ctx, color, 2.5)
  text(title, width / 2, ry + rh / 2 + 1, size, '#fff', 'center', 900, 'rgba(61,42,69,0.55)')
  // Close button (registered last so it wins over the blocker).
  const cs = 34 * ui
  const close = { x: x + w - cs * 0.75, y: y - cs * 0.25, w: cs, h: cs, enabled: true, action: () => (panel = null) }
  const hovered = inside(close, mouse)
  ellipse(ctx, close.x + cs / 2 + 1, close.y + cs / 2 + 3, cs / 2, cs / 2, 'rgba(61,42,69,0.25)')
  ellipse(ctx, close.x + cs / 2, close.y + cs / 2, cs / 2, cs / 2, hovered ? shade(C.coral, 0.15) : C.coral, 0, 2.5)
  text('✕', close.x + cs / 2, close.y + cs / 2 + 1, 16 * ui, '#fff', 'center', 900, null)
  return { x, y: y + rh * 0.6, w, h: h - rh * 0.6, close }
}

function slot(x: number, y: number, w: number, h: number, color: string = C.paper2) {
  roundRect(ctx, x, y, w, h, 14 * ui)
  paint(ctx, color, 1.5)
}

let barnTab = 0
let barnPage = 0
/** A sale waiting for a second tap ("Sure?"), for a few seconds. */
let confirmSale: { key: string; until: number } | null = null

/** A button that asks once before selling: the first tap arms it, the second one sells. */
function sellButton(key: string, label: string, x: number, y: number, w: number, h: number, enabled: boolean, sell: () => number | false) {
  const armed = !!confirmSale && confirmSale.key === key && clock < confirmSale.until
  button(armed ? t.sure : label, x, y, w, h, armed ? C.coral : C.gold, enabled, () => {
    if (!armed) {
      confirmSale = { key, until: clock + 3 }
      sound.plant()
      return
    }
    confirmSale = null
    const coins = sell()
    if (coins === false || (coins === 0 && key !== 'worker:' + key.split(':')[1])) {
      sound.denied()
      return
    }
    if (coins > 0) flyCoins(x + w / 2, y, coins)
    burst(x + w / 2, y, 16, ['#ffd54a', '#ffe08a', '#fff'], 0.8, true, true)
    sound.buy()
    persist()
  })
}

/** Pages of rows: ◀ 1/3 ▶ under a list. Returns the rows of the current page. */
function paged<T>(list: T[], perPage: number, x: number, y: number, w: number): T[] {
  const pages = Math.max(1, Math.ceil(list.length / perPage))
  barnPage = Math.min(barnPage, pages - 1)
  if (pages > 1) {
    const bw = 44 * ui
    button('◀', x + w / 2 - bw - 50 * ui, y, bw, 32 * ui, C.sky, barnPage > 0, () => barnPage--)
    text(`${barnPage + 1} / ${pages}`, x + w / 2, y + 14 * ui, 14 * ui, C.text, 'center', 900, null)
    button('▶', x + w / 2 + 50 * ui, y, bw, 32 * ui, C.sky, barnPage < pages - 1, () => barnPage++)
  }
  return list.slice(barnPage * perPage, barnPage * perPage + perPage)
}

/** A row of the barn's "own" tabs: icon, name, help, buttons. */
function ownRow(x: number, y: number, w: number, h: number, icon: () => void, name: string, help: string) {
  slot(x, y, w, h - 6 * ui)
  icon()
  const mid = y + (h - 6 * ui) / 2
  const textW = w - h * 1.05 - 230 * ui
  text(name, x + h * 1.05, mid - 9 * ui, fitSize(name, textW, 14 * ui, 900), C.text, 'left', 900, null)
  text(help, x + h * 1.05, mid + 10 * ui, fitSize(help, textW, 11 * ui, 700), C.muted, 'left', 700, null)
  return mid
}

function drawBarnPanel() {
  const box = panelFrame(`${t.barn} · ${farm.used()}/${farm.capacity()}`, 640, 470, C.teal)
  // Tabs.
  const tw = (box.w - 24 * ui) / t.barnTabs.length
  t.barnTabs.forEach((label, i) => {
    const x = box.x + 12 * ui + i * tw
    const on = i === barnTab
    roundRect(ctx, x + 3 * ui, box.y + 8 * ui - (on ? 3 * ui : 0), tw - 6 * ui, 34 * ui, 17 * ui)
    paint(ctx, on ? C.teal : C.paper2, 2)
    text(label, x + tw / 2, box.y + 25 * ui - (on ? 3 * ui : 0), fitSize(label, tw - 14 * ui, 13 * ui, 900), on ? '#fff' : C.text, 'center', 900, on ? 'rgba(61,42,69,0.5)' : null)
    buttons.push({ x, y: box.y + 8 * ui, w: tw, h: 34 * ui, enabled: true, action: () => ((barnTab = i), (barnPage = 0)) })
  })
  const x = box.x + 16 * ui
  const w = box.w - 32 * ui
  const top = box.y + 52 * ui
  const bottom = box.y + box.h - 44 * ui
  const rowH = Math.min(70 * ui, (bottom - top) / 4)
  const perPage = Math.max(1, Math.floor((bottom - top) / rowH))
  const pagerY = bottom + 6 * ui
  if (barnTab === 0) {
    // Goods: sell one at a time, or everything.
    const items = (Object.keys(ITEMS) as ItemId[]).filter((id) => farm.count(id) > 0)
    const value = farm.barnValue()
    if (!items.length) text(t.emptyBarn, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, C.muted, 'center', 800, null)
    // Goods are sold at the market island.
    text(`${t.sellAtMarket} · ${value}`, x, top + 18 * ui, fitSize(`${t.sellAtMarket} · ${value}`, w - 230 * ui, 13 * ui, 800), C.muted, 'left', 800, null)
    button('🛒 ' + t.goToMarket, x + w - 210 * ui, top, 210 * ui, 36 * ui, C.teal, scene !== 'market', () => (scene === 'home' ? (panel = { travel: 'dock' }) : travelTo('market')))
    const cell = 92 * ui
    const cols = Math.max(1, Math.floor(w / cell))
    const rows = Math.max(1, Math.floor((bottom - top - 44 * ui) / (cell * 1.04)))
    const x0 = x + (w - cols * cell) / 2
    paged(items, cols * rows, x, pagerY, w).forEach((id, i) => {
      const cx = x0 + (i % cols) * cell
      const cy = top + 44 * ui + Math.floor(i / cols) * cell * 1.04
      slot(cx + 4, cy, cell - 8, cell)
      drawItem(ctx, id, cx + cell / 2, cy + cell * 0.3 + Math.sin(clock * 2 + i) * 1.5, cell * 0.36)
      text(`x${farm.count(id)}`, cx + cell - 14 * ui, cy + 13 * ui, 13 * ui, C.text, 'right', 900, null)
      drawCoin(ctx, cx + cell * 0.36, cy + cell * 0.76, 7 * ui)
      text(String(ITEMS[id].price), cx + cell * 0.46, cy + cell * 0.76, 12 * ui, C.goldDark, 'left', 900, null)
    })
  } else if (barnTab === 1) {
    // Animals: one more, one less.
    const pens = PLACES.filter((p) => p.kind === 'pen' && farm.usable(p))
    if (!pens.length) text(t.noAnimals, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, C.muted, 'center', 800, null)
    paged(pens, perPage, x, pagerY, w).forEach((place, i) => {
      const y = top + i * rowH
      const n = farm.penAnimals(place)
      const max = farm.penAnimalsMax(place)
      const price = ANIMAL_PRICES[place.animal!]
      const mid = ownRow(x, y, w, rowH, () => drawAnimal(ctx, place.animal!, x + rowH * 0.5, y + rowH * 0.5, rowH * 0.62, clock + i, 1, false), `${placeName(place)} · ${n}/${max}`, `${t.items[PENS[place.animal!].product.item]} : ${farm.penProduct(place).count} · ${t.resale} ${Math.floor(price * RESALE)}`)
      const bw = 104 * ui
      const bh = 34 * ui
      sellButton(`animal:${place.id}`, `− ${Math.floor(price * RESALE)}`, x + w - bw * 2 - 18 * ui, mid - bh / 2, bw, bh, n > 1, () => farm.sellAnimal(place))
      coinButton(price, x + w - bw - 10 * ui, mid - bh / 2, bw, bh, C.teal, n < max && farm.s.coins >= price, () => {
        const result = farm.buyAnimal(place)
        bought(result)
      })
    })
  } else if (barnTab === 2) {
    // Buildings, land, machines and decorations.
    type Own = { key: string; icon: () => void; name: string; coins: number; can: boolean; sell: () => number }
    const own: Own[] = []
    for (const place of PLACES) {
      if (!farm.canSellPlace(place)) continue
      own.push({
        key: 'place:' + place.id,
        icon: () => {},
        name: placeName(place),
        coins: farm.placeResale(place),
        can: true,
        sell: () => {
          delete walkers[place.id]
          return farm.sellPlace(place)
        },
      })
    }
    for (const zone of ZONES) if (farm.owns(zone.id)) own.push({ key: 'zone:' + zone.id, icon: () => {}, name: t.zones[zone.id], coins: Math.floor(zone.price * RESALE), can: farm.canSellZone(zone), sell: () => farm.sellZone(zone) })
    for (const id of ['tractor', 'truck'] as MachineId[]) if (farm.s.machines[id]) own.push({ key: 'machine:' + id, icon: () => {}, name: t.machines[id], coins: Math.floor(MACHINES[id].price * RESALE), can: farm.canSellMachine(id), sell: () => farm.sellMachine(id) })
    farm.s.decor.forEach((d, index) => own.push({ key: `decor:${index}:${d.kind}`, icon: () => {}, name: t.decors[d.kind], coins: Math.floor(DECORS[d.kind].price * RESALE), can: true, sell: () => farm.sellDecor(index) }))
    if (!own.length) text(t.nothingToSell, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, C.muted, 'center', 800, null)
    paged(own, perPage, x, pagerY, w).forEach((o, i) => {
      const y = top + i * rowH
      const [kind, id] = o.key.split(':')
      const s = rowH * 0.62
      const icon = () => {
        const cx = x + rowH * 0.5
        const cy = y + rowH * 0.5
        if (kind === 'place') {
          const place = PLACES.find((p) => p.id === id)!
          if (place.kind === 'pen') drawAnimal(ctx, place.animal!, cx, cy, s, clock, 1, false)
          else if (place.kind === 'workshop') drawWorkshop(ctx, place.workshop!, cx - s * 0.5, cy - s * 0.55, s, s, clock, false)
          else drawPlot(ctx, cx, cy, s * 0.8, 0, false)
        } else if (kind === 'zone') {
          ctx.save()
          roundRect(ctx, cx - s / 2, cy - s / 2, s, s, 8 * ui)
          ctx.clip()
          drawForest(ctx, cx - s / 2, cy - s / 2, s, s, clock)
          ctx.restore()
        } else if (kind === 'machine') {
          if (id === 'tractor') drawTractor(ctx, cx, cy + s * 0.35, s * 0.9, 1, clock, false)
          else drawTruck(ctx, cx, cy + s * 0.35, s * 0.9, 1, clock, false, false)
        } else {
          ctx.save()
          ctx.translate(cx, cy + s * 0.3)
          ctx.scale(s / 70, s / 70)
          drawDecor(ctx, o.key.split(':')[2], 0, 0, clock)
          ctx.restore()
        }
      }
      const mid = ownRow(x, y, w, rowH, icon, o.name, o.can ? `${t.resale} ${o.coins}` : t.sellFieldsFirst)
      sellButton(o.key, `${t.sell} · ${o.coins}`, x + w - 150 * ui, mid - 17 * ui, 140 * ui, 34 * ui, o.can, o.sell)
    })
  } else {
    // Workers.
    const hired = WORKER_IDS.filter((id) => farm.workerActive(id))
    if (!hired.length) text(t.noWorkers, box.x + box.w / 2, box.y + box.h / 2, 15 * ui, C.muted, 'center', 800, null)
    paged(hired, perPage, x, pagerY, w).forEach((id, i) => {
      const y = top + i * rowH
      const left = farm.workerLeft(id)
      const coins = farm.workerResale(id)
      const mid = ownRow(x, y, w, rowH, () => drawFarmer(ctx, WORKER_LOOK[id], x + rowH * 0.5, y + rowH * 0.86, rowH * 0.66, clock + i, 1, false), t.workers[id], Number.isFinite(left) ? `${Math.ceil(left / 60)} min · ${t.resale} ${coins}` : `${t.hiredForever} · ${t.resale} ${coins}`)
      sellButton('worker:' + id, `${t.fire} · ${coins}`, x + w - 160 * ui, mid - 17 * ui, 150 * ui, 34 * ui, true, () => (farm.workerActive(id) ? farm.fireWorker(id) : false))
    })
  }
  buttons.push(box.close)
}

function drawOrdersPanel() {
  const box = panelFrame(t.orders, 640, 390, C.coral)
  const gapX = 10 * ui
  const cw = (box.w - gapX * (ORDER_SLOTS + 1)) / ORDER_SLOTS
  const ch = box.h - 20 * ui
  farm.s.orders.forEach((order, i) => {
    const x = box.x + gapX + i * (cw + gapX)
    const y = box.y + 10 * ui
    slot(x, y, cw, ch)
    if (order.nextAt > 0) {
      text(t.nextOrder, x + cw / 2, y + ch * 0.42, 13 * ui, C.muted, 'center', 800, null)
      text(`${Math.ceil(order.nextAt - farm.clock)} s`, x + cw / 2, y + ch * 0.55, 18 * ui, C.muted, 'center', 900, null)
      return
    }
    const villager = VILLAGERS[order.villager % VILLAGERS.length]
    const can = farm.canDeliver(i)
    drawVillager(ctx, villager.id, x + cw / 2, y + ch * 0.17 - (can ? Math.abs(Math.sin(clock * 4)) * 4 * ui : 0), Math.min(cw * 0.42, ch * 0.24), can ? 'happy' : 'neutral', clock)
    order.items.forEach((it, k) => {
      const iy = y + ch * (0.38 + k * 0.13)
      drawItem(ctx, it.item, x + cw * 0.3, iy, Math.min(26 * ui, ch * 0.11))
      const have = farm.count(it.item)
      text(`${Math.min(have, it.count)}/${it.count}`, x + cw * 0.62, iy, 14 * ui, have >= it.count ? '#2e9d5a' : '#d0453a', 'center', 900, null)
    })
    const ry = y + ch * 0.78
    drawCoin(ctx, x + cw * 0.22, ry, 8 * ui)
    text(String(order.coins), x + cw * 0.3, ry, 13 * ui, C.goldDark, 'left', 900, null)
    text(`+${order.xp} XP`, x + cw * 0.92, ry, 12 * ui, '#4f9e3a', 'right', 900, null)
    const bh = Math.min(34 * ui, ch * 0.14)
    button(t.deliver, x + cw * 0.06, y + ch - bh - 8 * ui, cw * 0.6, bh, C.teal, can, () => {
      const reward = farm.deliver(i)
      if (reward) {
        sound.order()
        burst(x + cw / 2, y + ch / 2, 30, ['#ffd54a', '#7fd6c8', '#ff9db0', '#fff'], 1.2, true, true)
        flyCoins(x + cw / 2, y + ch * 0.6, reward.coins)
        changed()
      }
    })
    button('↻', x + cw * 0.7, y + ch - bh - 8 * ui, cw * 0.24, bh, '#a99bb0', true, () => {
      farm.skip(i)
      changed()
    })
  })
  buttons.push(box.close)
}

function drawBuyPanel(place: Place) {
  const box = panelFrame(placeName(place), 380, 280, C.gold)
  const cx = box.x + box.w / 2
  const levelOk = farm.level >= place.level
  if (place.kind === 'pen') {
    drawAnimal(ctx, place.animal!, cx, box.y + box.h * 0.3, 64 * ui, clock, 1, Math.sin(clock * 2) > 0.5)
    const pen = PENS[place.animal!]
    text(`${t.items[pen.feed.item]} → ${t.items[pen.product.item]}`, cx, box.y + box.h * 0.54, 14 * ui, C.muted, 'center', 800, null)
  } else if (place.kind === 'workshop') {
    const type = WORKSHOPS[place.workshop!]
    drawItem(ctx, type.output, cx, box.y + box.h * 0.28 + Math.sin(clock * 3) * 3, 48 * ui)
    text(`${type.inputs.map((i) => `${i.count} ${t.items[i.item].toLowerCase()}`).join(' + ')} → ${t.items[type.output]}`, cx, box.y + box.h * 0.54, 14 * ui, C.muted, 'center', 800, null)
  } else {
    drawPlot(ctx, cx - 22 * ui, box.y + box.h * 0.28, 40 * ui, 0, false)
    drawPlot(ctx, cx + 22 * ui, box.y + box.h * 0.28, 40 * ui, 0, false)
    text(`+${place.w * place.h}`, cx, box.y + box.h * 0.54, 15 * ui, C.muted, 'center', 900, null)
  }
  const bw = box.w * 0.6
  const bh = 48 * ui
  if (levelOk) {
    button(`${t.buy} · ${place.price}`, cx - bw / 2, box.y + box.h - bh - 18 * ui, bw, bh, C.teal, farm.s.coins >= place.price, () => {
      if (farm.unlock(place) === 'ok') {
        sound.buy()
        panel = null
        const x = (place.x + place.w / 2) * TILE
        const y = (place.y + place.h / 2) * TILE
        burst(x, y, 40, ['#ffd54a', '#7fd6c8', '#ff9db0', '#fff'], 1.4, true)
        bumpPlace(place)
        persist()
      }
    })
  } else text(`🔒 ${t.levelNeeded} ${place.level}`, cx, box.y + box.h - 40 * ui, 18 * ui, C.muted, 'center', 900, null)
  buttons.push(box.close)
}

/** A row of the shop: icon, name, help, and a price button / owned / level. */
function shopRow(x: number, y: number, w: number, h: number, icon: () => void, name: string, help: string, level: number, price: number | null, buy: () => void, doneLabel = t.owned + ' ✓') {
  slot(x, y, w, h - 8 * ui)
  icon()
  const mid = y + (h - 8 * ui) / 2
  const textW = w - h * 1.05 - 124 * ui
  text(name, x + h * 1.05, mid - 10 * ui, fitSize(name, textW, 15 * ui, 900), C.text, 'left', 900, null)
  text(help, x + h * 1.05, mid + 11 * ui, fitSize(help, textW, 12 * ui, 700), C.muted, 'left', 700, null)
  const bw = 108 * ui
  const bh = 40 * ui
  const bx = x + w - bw - 10 * ui
  if (price === null) text(doneLabel, bx + bw / 2, mid, 15 * ui, '#4f9e3a', 'center', 900, null)
  else if (farm.level < level) text('🔒 ' + t.levelNeeded + ' ' + level, bx + bw / 2, mid, 13 * ui, C.muted, 'center', 800, null)
  else coinButton(price, bx, mid - bh / 2, bw, bh, C.gold, farm.s.coins >= price, buy)
}

function bought(result: string, wx?: number, wy?: number) {
  if (result !== 'ok') {
    sound.denied()
    return
  }
  sound.buy()
  burst(width / 2, height / 2, 40, ['#ffd54a', '#7fd6c8', '#ff9db0', '#8fc7ff', '#fff'], 1.6, true, true)
  if (wx !== undefined && wy !== undefined) {
    cam.x = wx
    cam.y = wy
    clampCamera()
    panel = null
  }
  persist()
}

/** A row of the workers' tab: hire for 10 minutes, or for good. */
function workerRow(id: WorkerId, x: number, y: number, w: number, h: number) {
  const info = WORKERS[id]
  slot(x, y, w, h - 8 * ui)
  drawFarmer(ctx, WORKER_LOOK[id], x + h * 0.45, y + h * 0.8, h * 0.62, clock + WORKER_IDS.indexOf(id), 1, farm.workerActive(id))
  const mid = y + (h - 8 * ui) / 2
  const left = farm.workerLeft(id)
  const name = Number.isFinite(left) && left > 0 ? `${t.workers[id]} · ${Math.ceil(left / 60)} min` : t.workers[id]
  const textW = w - h * 1.05 - 210 * ui
  text(name, x + h * 1.05, mid - 10 * ui, fitSize(name, textW, 15 * ui, 900), C.text, 'left', 900, null)
  text(t.workerHelp[id], x + h * 1.05, mid + 11 * ui, fitSize(t.workerHelp[id], textW, 12 * ui, 700), C.muted, 'left', 700, null)
  const bw = 96 * ui
  const bh = 34 * ui
  const bx2 = x + w - bw - 10 * ui
  const bx1 = bx2 - bw - 8 * ui
  if (farm.s.workers[id].forever) text(t.hiredForever + ' ✓', x + w - 14 * ui, mid, 13 * ui, '#4f9e3a', 'right', 900, null)
  else if (farm.level < info.level) text('🔒 ' + t.levelNeeded + ' ' + info.level, bx2 + bw / 2, mid, 13 * ui, C.muted, 'center', 800, null)
  else {
    const atMax = left + WORKER.duration > WORKER.maxAhead
    text(t.forHire, bx1 + bw / 2, mid - 24 * ui, 11 * ui, C.muted, 'center', 900, null)
    text(t.forever, bx2 + bw / 2, mid - 24 * ui, 11 * ui, C.muted, 'center', 900, null)
    if (atMax) text(t.max, bx1 + bw / 2, mid + 4 * ui, 14 * ui, '#4f9e3a', 'center', 900, null)
    else
      coinButton(info.price, bx1, mid - bh / 2 + 5 * ui, bw, bh, C.gold, farm.s.coins >= info.price, () => {
        const result = farm.hireWorker(id)
        bought(result)
        if (result === 'ok' && !workers[id].task) Object.assign(workers[id], WORKER_HOME[id])
      })
    coinButton(info.forever, bx2, mid - bh / 2 + 5 * ui, bw, bh, C.plum, farm.s.coins >= info.forever, () => bought(farm.hireWorkerForever(id)))
  }
}

function upgradeIcon(id: UpgradeId, x: number, y: number, s: number) {
  if (id === 'fields') {
    drawPlot(ctx, x, y + s * 0.1, s * 0.8, 0, false)
    drawPlant(ctx, 'carrot', x, y + s * 0.1, s * 0.8, 1, true, false, false, clock)
  } else if (id === 'pens') drawAnimal(ctx, 'chicken', x, y + s * 0.35, s * 0.7, clock, 1, false)
  else drawWorkshop(ctx, 'mill', x - s * 0.4, y - s * 0.45, s * 0.8, s * 0.8, clock, true)
}

function drawCoinsTab(x: number, y: number, w: number, h: number) {
  if (!play.canPurchase) {
    drawCoin(ctx, x + w / 2, y + h * 0.3, 26 * ui, clock * 2)
    text(t.coinsUnavailable, x + w / 2, y + h * 0.55, 15 * ui, C.muted, 'center', 800, null)
    return
  }
  if (!products) {
    text(t.loading, x + w / 2, y + h * 0.45, 15 * ui, C.muted, 'center', 800, null)
    return
  }
  const list = products.slice(0, 6)
  const cols = Math.min(3, Math.max(1, list.length))
  const cw = w / cols
  const ch = Math.min(156 * ui, (h - 34 * ui) / Math.ceil(list.length / cols))
  list.forEach((product, i) => {
    const cx = x + (i % cols) * cw
    const cy = y + Math.floor(i / cols) * ch
    slot(cx + 5 * ui, cy, cw - 10 * ui, ch - 10 * ui)
    // A pile of coins, bigger for bigger packs.
    const pile = Math.min(5, 1 + i)
    for (let k = 0; k < pile; k++) drawCoin(ctx, cx + cw / 2 + (k - (pile - 1) / 2) * 10 * ui, cy + ch * 0.24 - (k % 2) * 6 * ui, 12 * ui, k === pile - 1 ? clock * 2 : 0)
    const coins = productCoins(product)
    text(coins ? `+${coins}` : product.title, cx + cw / 2, cy + ch * 0.46, 20 * ui, C.goldDark, 'center', 900, null)
    if (coins && product.title) text(clip(product.title, 18), cx + cw / 2, cy + ch * 0.59, 12 * ui, C.muted, 'center', 800, null)
    const bw = cw * 0.72
    const bh = 36 * ui
    button(paying ? t.paying : String(product.price || t.buy), cx + (cw - bw) / 2, cy + ch * 0.66, bw, bh, C.teal, !paying, () => buyProduct(product))
  })
  text(t.coinsHelp, x + w / 2, y + h - 14 * ui, 12 * ui, C.muted, 'center', 800, null)
}

function drawShopPanel() {
  const box = panelFrame(t.shop, 680, 490, C.gold)
  // Tabs; the chosen one is raised.
  const tw = (box.w - 24 * ui) / t.tabs.length
  t.tabs.forEach((label, i) => {
    const x = box.x + 12 * ui + i * tw
    const on = i === shopTab
    roundRect(ctx, x + 3 * ui, box.y + 8 * ui - (on ? 3 * ui : 0), tw - 6 * ui, 34 * ui, 17 * ui)
    paint(ctx, on ? C.gold : C.paper2, 2)
    text(label, x + tw / 2, box.y + 25 * ui - (on ? 3 * ui : 0), fitSize(label, tw - 14 * ui, 13 * ui, 900), on ? '#fff' : C.text, 'center', 900, on ? 'rgba(61,42,69,0.5)' : null)
    buttons.push({ x, y: box.y + 8 * ui, w: tw, h: 34 * ui, enabled: true, action: () => (shopTab = i) })
  })
  const x = box.x + 16 * ui
  const w = box.w - 32 * ui
  let y = box.y + 54 * ui
  const rowH = Math.min(80 * ui, (box.h - 64 * ui) / (shopTab === 3 ? 5 : 4))
  if (shopTab === 0) {
    for (const zone of ZONES) {
      const zy = y
      shopRow(x, y, w, rowH, () => {
        ctx.save()
        roundRect(ctx, x + 8 * ui, zy + 6 * ui, rowH - 20 * ui, rowH - 20 * ui, 10 * ui)
        ctx.clip()
        ctx.translate(x + 8 * ui, zy + 6 * ui)
        ctx.scale((rowH - 20 * ui) / 160, (rowH - 20 * ui) / 160)
        drawForest(ctx, 0, 0, 160, 160, clock)
        ctx.restore()
      }, t.zones[zone.id], t.zoneHelp, zone.level, farm.owns(zone.id) ? null : zone.price, () => bought(farm.buyZone(zone), (zone.x + zone.w / 2) * TILE, (zone.y + zone.h / 2) * TILE))
      y += rowH
    }
  } else if (shopTab === 1) {
    for (const id of WORKER_IDS) {
      workerRow(id, x, y, w, rowH)
      y += rowH
    }
  } else if (shopTab === 2) {
    const machines: MachineId[] = ['truck', 'tractor']
    for (const id of machines) {
      const iy = y
      shopRow(x, y, w, rowH, () => {
        if (id === 'tractor') drawTractor(ctx, x + rowH * 0.45, iy + rowH * 0.68, rowH * 0.6, 1, clock, false)
        else drawTruck(ctx, x + rowH * 0.45, iy + rowH * 0.64, rowH * 0.62, 1, clock, false, true)
      }, t.machines[id], t.machineHelp[id], MACHINES[id].level, farm.s.machines[id] ? null : MACHINES[id].price, () => bought(farm.buyMachine(id)))
      y += rowH
    }
    for (const id of ['ferry', 'balloon'] as TransportId[]) {
      const iy = y
      shopRow(x, y, w, rowH, () => {
        if (id === 'ferry') drawFerry(ctx, x + rowH * 0.45, iy + rowH * 0.5, rowH * 0.7, clock)
        else drawBalloon(ctx, x + rowH * 0.45, iy + rowH * 0.85, rowH * 0.55, clock)
      }, t.transports[id], t.transportHelp[id], TRANSPORT[id].level, farm.s.transport[id] ? null : TRANSPORT[id].price, () => bought(farm.buyTransport(id)))
      y += rowH
    }
  } else if (shopTab === 3) {
    for (const id of UPGRADE_IDS) {
      const uy = y
      const level = farm.upgradeLevel(id)
      const next = farm.nextUpgrade(id)
      shopRow(x, y, w, rowH, () => {
        upgradeIcon(id, x + rowH * 0.45, uy + rowH * 0.4, rowH * 0.7)
        upgradeStars(Math.min(level, MAX_UPGRADE), x + rowH * 0.2, uy + rowH * 0.12)
      }, `${t.upgrades[id]} ${level}/${MAX_UPGRADE}`, t.upgradeHelp[id], next ? next.level : 0, next ? next.price : null, () => bought(farm.buyUpgrade(id)), t.max + ' ✓')
      y += rowH
    }
    const sy = y
    shopRow(x, y, w, rowH, () => drawSprinkler(ctx, x + rowH * 0.45, sy + rowH * 0.6, clock), `${t.machines.sprinkler} ${farm.s.sprinkler}/${SPRINKLER_PRICES.length}`, t.machineHelp.sprinkler, SPRINKLER_LEVEL, farm.s.sprinkler >= SPRINKLER_PRICES.length ? null : SPRINKLER_PRICES[farm.s.sprinkler], () => bought(farm.buySprinkler(SPRINKLER_LEVEL)))
    y += rowH
    const iy = y
    shopRow(x, y, w, rowH, () => drawSilo(ctx, x + rowH * 0.3, iy + rowH * 0.1, rowH * 0.32, rowH * 0.6, 0), `${t.machines.silo} ${farm.s.silo}/${SILO_PRICES.length}`, t.machineHelp.silo, SILO_LEVEL, farm.s.silo >= SILO_PRICES.length ? null : SILO_PRICES[farm.s.silo], () => bought(farm.buySilo(SILO_LEVEL)))
  } else if (shopTab === 5) {
    drawCoinsTab(x, y, w, box.h - 64 * ui)
  } else {
    // Decorations of the shop, then those of your stock (merchant, rewards) to place for free.
    const kinds = (Object.keys(DECORS) as DecorKind[]).filter((k) => !DECORS[k].where || farm.stockOf(k) > 0)
    const cols = 3
    const cw = w / cols
    const ch = Math.min(134 * ui, (box.h - 70 * ui) / Math.ceil(kinds.length / cols))
    kinds.forEach((kind, i) => {
      const cx = x + (i % cols) * cw
      const cy = y + Math.floor(i / cols) * ch
      slot(cx + 5 * ui, cy, cw - 10 * ui, ch - 10 * ui)
      ctx.save()
      ctx.translate(cx + cw / 2, cy + ch * 0.42)
      ctx.scale(ui * 0.85, ui * 0.85)
      drawDecor(ctx, kind, 0, 0, clock)
      ctx.restore()
      text(t.decors[kind], cx + cw / 2, cy + ch * 0.56, fitSize(t.decors[kind], cw - 20 * ui, 12 * ui, 900), C.text, 'center', 900, null)
      const info = DECORS[kind]
      const bw = cw * 0.66
      const bh = 32 * ui
      const start = (stock: boolean) => {
        if (scene !== 'home' || visit) {
          toast = { title: t.notHere, text: '', life: 2 }
          sound.denied()
          return
        }
        placing = kind
        placingStock = stock
        panel = null
        hover = toWorld(width / 2, height / 2)
      }
      if (info.where) button(`${t.place} · x${farm.stockOf(kind)}`, cx + (cw - bw) / 2, cy + ch * 0.64, bw, bh, C.teal, true, () => start(true))
      else if (farm.level < info.level) text('🔒 ' + t.levelNeeded + ' ' + info.level, cx + cw / 2, cy + ch * 0.76, 12 * ui, C.muted, 'center', 800, null)
      else coinButton(info.price, cx + (cw - bw) / 2, cy + ch * 0.64, bw, bh, C.gold, farm.s.coins >= info.price, () => start(false))
    })
  }
  buttons.push(box.close)
}

function swatch(color: string, x: number, y: number, r: number) {
  ellipse(ctx, x, y, r, r, color, 0, 2)
}

function drawAvatarPanel() {
  const box = panelFrame(t.avatarTitle, 560, 450, C.plum)
  const left = box.x + box.w * 0.25
  ellipse(ctx, left, box.y + box.h * 0.66, 60 * ui, 16 * ui, 'rgba(61,42,69,0.08)')
  drawFarmer(ctx, look(), left, box.y + box.h * 0.66, Math.min(box.h * 0.5, 160 * ui), clock, Math.sin(clock * 0.8) > 0 ? 1 : -1, false)
  text(clip(myName(), 18), left, box.y + box.h * 0.76, 15 * ui, C.text, 'center', 900, null)
  if (player && player.name) text(t.connected, left, box.y + box.h * 0.83, 11 * ui, C.muted, 'center', 800, null)
  const x = box.x + box.w * 0.48
  const w = box.w * 0.48
  const rows: [string, number, (i: number) => void, (i: number, cx: number, cy: number, r: number) => void, number][] = [
    [t.looks[0], SKINS.length, (i) => (home.s.avatar.skin = i), (i, cx, cy, r) => swatch(SKINS[i], cx, cy, r), home.s.avatar.skin],
    [t.looks[1], HATS.length, (i) => (home.s.avatar.hat = i), (i, cx, cy, r) => drawFarmerFace(ctx, { ...look(), hat: HATS[i] }, cx, cy + r * 0.2, r * 1.6, clock), home.s.avatar.hat],
    [t.looks[2], SHIRTS.length, (i) => (home.s.avatar.shirt = i), (i, cx, cy, r) => swatch(SHIRTS[i], cx, cy, r), home.s.avatar.shirt],
    [t.looks[3], PANTS.length, (i) => (home.s.avatar.pants = i), (i, cx, cy, r) => swatch(PANTS[i], cx, cy, r), home.s.avatar.pants],
  ]
  const rowH = (box.h - 20 * ui) / rows.length
  rows.forEach(([label, count, set, drawOption, current], k) => {
    const y = box.y + 10 * ui + k * rowH
    text(label, x, y + 12 * ui, 13 * ui, C.text, 'left', 900, null)
    const r = Math.min(15 * ui, w / count / 2 - 3 * ui)
    for (let i = 0; i < count; i++) {
      const cx = x + r + 2 * ui + i * (r * 2 + 6 * ui)
      const cy = y + rowH * 0.6
      if (i === current) {
        ctx.strokeStyle = C.gold
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.arc(cx, cy, r + 4 + Math.sin(clock * 5) * 1, 0, Math.PI * 2)
        ctx.stroke()
      }
      drawOption(i, cx, cy, r)
      buttons.push({
        x: cx - r - 3,
        y: cy - r - 3,
        w: r * 2 + 6,
        h: r * 2 + 6,
        enabled: true,
        action: () => {
          set(i)
          sound.plant()
          changed()
        },
      })
    }
  })
  buttons.push(box.close)
}

// --- online: settings, players, invitations ----------------------------------------------------

/** The nickname field (a real input, so phones show their keyboard), over the settings panel. */
const nameInput = document.createElement('input')
nameInput.type = 'text'
nameInput.maxLength = NAME_MAX
nameInput.autocomplete = 'off'
nameInput.spellcheck = false
nameInput.setAttribute('aria-label', 'Nickname')
Object.assign(nameInput.style, {
  position: 'fixed',
  display: 'none',
  boxSizing: 'border-box',
  border: '2px solid #3d2a45',
  borderRadius: '12px',
  background: '#ffffff',
  color: '#3d2a45',
  fontFamily: FONT,
  fontWeight: '800',
  padding: '0 12px',
  outline: 'none',
  zIndex: '2',
})
document.body.appendChild(nameInput)
let nameShown = false

function cleanName(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
}

function commitName() {
  const name = cleanName(nameInput.value)
  nameInput.value = name || home.s.name
  if (!name || name === home.s.name) return
  home.s.name = name
  persist()
  renameInRooms()
  sound.coin()
}

function showNameInput(x: number, y: number, w: number, h: number) {
  if (!nameShown) {
    nameShown = true
    nameInput.value = home.s.name || myName()
    nameInput.style.display = 'block'
  }
  Object.assign(nameInput.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', fontSize: Math.round(15 * ui) + 'px' })
}

function hideNameInput() {
  if (!nameShown) return
  nameShown = false
  commitName()
  nameInput.style.display = 'none'
  nameInput.blur()
}

nameInput.addEventListener('keydown', (event) => {
  event.stopPropagation()
  if (event.key === 'Enter' || event.key === 'Escape') {
    commitName()
    nameInput.blur()
    canvas.focus()
  }
})
nameInput.addEventListener('blur', commitName)

function soundOn() {
  try {
    return localStorage.getItem('cloud-acres:sound') !== 'off'
  } catch {
    return true
  }
}

function setSound(on: boolean) {
  try {
    localStorage.setItem('cloud-acres:sound', on ? 'on' : 'off')
  } catch {
    // Private browsing: kept for this session only.
  }
  sound.setEnabled(on && play.isAudioEnabled)
  if (on) sound.coin()
}

function drawSettingsPanel() {
  const box = panelFrame(t.settings, 520, 500, C.sky)
  const x = box.x + 22 * ui
  const w = box.w - 44 * ui
  const rowH = Math.min(84 * ui, (box.h - 20 * ui) / 5)
  let y = box.y + 12 * ui
  // Nickname.
  slot(x, y, w, rowH - 10 * ui)
  text(t.nickname, x + 16 * ui, y + 18 * ui, 15 * ui, C.text, 'left', 900, null)
  const fromSite = !!(player && player.name)
  text(fromSite ? t.nicknameFromSite : t.nicknameHelp, x + 16 * ui, y + 38 * ui, 11 * ui, C.muted, 'left', 700, null)
  const fw = Math.min(220 * ui, w * 0.5)
  const fx = x + w - fw - 14 * ui
  const fh = 38 * ui
  const fy = y + (rowH - 10 * ui - fh) / 2
  if (fromSite) {
    roundRect(ctx, fx, fy, fw, fh, 12 * ui)
    paint(ctx, '#efe7da', 2)
    text(clip(player!.name, 18), fx + 12 * ui, fy + fh / 2, 15 * ui, C.text, 'left', 900, null)
  } else {
    // The input sits there (drawn by the browser); the card shows through while it opens.
    const k = easeOut((clock - panelAt) / 0.3)
    if (k >= 1) showNameInput(fx, fy, fw, fh)
    else {
      roundRect(ctx, fx, fy, fw, fh, 12 * ui)
      paint(ctx, '#fff', 2)
    }
  }
  y += rowH
  // Online.
  slot(x, y, w, rowH - 10 * ui)
  text(t.showOnline, x + 16 * ui, y + 18 * ui, 15 * ui, C.text, 'left', 900, null)
  text(play.canJoinRooms ? t.showOnlineHelp : t.onlineUnavailable, x + 16 * ui, y + 38 * ui, 11 * ui, C.muted, 'left', 700, null)
  toggle(home.s.online && play.canJoinRooms, x + w - 70 * ui, y + (rowH - 10 * ui) / 2 - 15 * ui, 56 * ui, 30 * ui, play.canJoinRooms, () => {
    setOnline(!home.s.online)
    sound.plant()
  })
  y += rowH
  // Sound.
  slot(x, y, w, rowH - 10 * ui)
  text(t.sound, x + 16 * ui, y + 18 * ui, 15 * ui, C.text, 'left', 900, null)
  text(t.soundHelp, x + 16 * ui, y + 38 * ui, 11 * ui, C.muted, 'left', 700, null)
  const on = soundOn()
  toggle(on, x + w - 70 * ui, y + (rowH - 10 * ui) / 2 - 15 * ui, 56 * ui, 30 * ui, true, () => setSound(!on))
  y += rowH
  // The clock.
  slot(x, y, w, rowH - 10 * ui)
  const real = clockMode() === 'real'
  text(t.realTime, x + 16 * ui, y + 18 * ui, 15 * ui, C.text, 'left', 900, null)
  text(real ? t.realTimeHelp : t.fastDays, x + 16 * ui, y + 38 * ui, fitSize(real ? t.realTimeHelp : t.fastDays, w - 110 * ui, 11 * ui, 700), C.muted, 'left', 700, null)
  toggle(real, x + w - 70 * ui, y + (rowH - 10 * ui) / 2 - 15 * ui, 56 * ui, 30 * ui, true, () => {
    setClockMode(real ? 'fast' : 'real')
    sound.plant()
  })
  y += rowH
  // My farmer.
  button('👤 ' + t.myFarmer, x + w * 0.2, y + 4 * ui, w * 0.6, 46 * ui, C.plum, !visit, () => (panel = 'avatar'))
  buttons.push(box.close)
}

function statusOf(o: Lobbyist) {
  if (!o.at) return t.atHome
  if (o.at === myFarmId) return `${t.visitingAt} ${t.you.toLowerCase()}`
  const host = [...online.values()].find((p) => p.farmId === o.at)
  return `${t.visitingAt} ${host ? host.name : '…'}`
}

function drawOnlinePanel() {
  const box = panelFrame(t.onlineTitle, 560, 450, C.teal)
  const list = [...online.values()].slice(0, 7)
  const x = box.x + 14 * ui
  const w = box.w - 28 * ui
  if (!list.length) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h * 0.4
    drawCloud(ctx, cx, cy + Math.sin(clock * 1.5) * 4, 50 * ui, '#e9f4ff')
    text('z', cx + 40 * ui, cy - 30 * ui - ((clock * 10) % 20), 14 * ui, C.muted, 'center', 900, null)
    text(t.nobodyOnline, cx, box.y + box.h * 0.66, 15 * ui, C.muted, 'center', 800, null)
    text(t.showOnlineHelp, cx, box.y + box.h * 0.74, 12 * ui, C.muted, 'center', 700, null)
  }
  const rowH = Math.min(60 * ui, (box.h - 16 * ui) / 7)
  list.forEach((o, i) => {
    const y = box.y + 8 * ui + i * rowH
    slot(x, y, w, rowH - 6 * ui)
    const mid = y + (rowH - 6 * ui) / 2
    face(o, x + 26 * ui, mid, 18 * ui)
    const bw = 92 * ui
    const bh = 34 * ui
    const nameW = w - 60 * ui - bw * 2 - 30 * ui
    text(clip(o.name, 20), x + 52 * ui, mid - 8 * ui, fitSize(clip(o.name, 20), nameW, 14 * ui, 900), C.text, 'left', 900, null)
    text(`${t.level} ${o.level} · ${statusOf(o)}`, x + 52 * ui, mid + 10 * ui, fitSize(`${t.level} ${o.level} · ${statusOf(o)}`, nameW, 11 * ui, 700), C.muted, 'left', 700, null)
    const already = invitedAlready(o.id)
    const canInvite = !visit && !already && o.at !== myFarmId
    button(already ? t.invited : t.invite, x + w - bw * 2 - 16 * ui, mid - bh / 2, bw, bh, C.teal, canInvite, () => invite(o))
    button('🎁 👋', x + w - bw - 8 * ui, mid - bh / 2, bw, bh, C.rose, true, () => (panel = { person: o.id }))
  })
  const tip = visit ? t.inviteFromHome : list.length ? t.inviteTip : ''
  if (tip) text(tip, box.x + box.w / 2, box.y + box.h - 16 * ui, fitSize(tip, box.w - 40 * ui, 12 * ui, 800), C.muted, 'center', 800, null)
  buttons.push(box.close)
}

/** A player online (lobby): wave, invite, give something from your barn. */
function drawPersonPanel(id: string) {
  const o = online.get(id)
  if (!o) {
    panel = null
    return
  }
  const box = panelFrame(clip(o.name, 22), 580, 420, C.rose)
  const left = box.x + box.w * 0.2
  drawFarmer(ctx, o.look, left, box.y + box.h * 0.56, Math.min(box.h * 0.42, 130 * ui), clock, 1, false)
  text(`${t.level} ${o.level}`, left, box.y + box.h * 0.64, 14 * ui, C.text, 'center', 900, null)
  text(statusOf(o), left, box.y + box.h * 0.71, 11 * ui, C.muted, 'center', 700, null)
  const bw = Math.min(150 * ui, box.w * 0.32)
  const already = invitedAlready(o.id)
  button(already ? t.invited : '🏡 ' + t.invite, left - bw / 2, box.y + box.h - 100 * ui, bw, 40 * ui, C.teal, !visit && !already && o.at !== myFarmId, () => invite(o))
  button('👋 ' + t.wave, left - bw / 2, box.y + box.h - 52 * ui, bw, 40 * ui, C.sky, true, () => wavePerson(id))
  const x = box.x + box.w * 0.4
  const w = box.w * 0.57
  text(t.give, x + w / 2, box.y + 16 * ui, 15 * ui, C.text, 'center', 900, null)
  const items = (Object.keys(ITEMS) as ItemId[]).filter((item) => home.count(item) > 0).slice(0, 8)
  if (!items.length) text(t.nothingToGive, x + w / 2, box.y + box.h / 2, 13 * ui, C.muted, 'center', 800, null)
  const cols = 4
  const cell = w / cols
  items.forEach((item, i) => {
    const cx = x + (i % cols) * cell
    const cy = box.y + 34 * ui + Math.floor(i / cols) * cell * 1.15
    slot(cx + 4 * ui, cy, cell - 8 * ui, cell * 1.05)
    drawItem(ctx, item, cx + cell / 2, cy + cell * 0.32, cell * 0.38)
    text(`x${home.count(item)}`, cx + cell - 12 * ui, cy + 11 * ui, 11 * ui, C.text, 'right', 900, null)
    button(t.give, cx + 9 * ui, cy + cell * 0.64, cell - 18 * ui, cell * 0.32, C.rose, true, () => giveTo(id, item))
  })
  buttons.push(box.close)
}

/** Someone on the farm on screen: wave; the owner can send a guest home. */
function drawVisitorPanel(id: string) {
  const v = visitors.get(id)
  if (!v) {
    panel = null
    return
  }
  const box = panelFrame(clip(v.name, 22), 420, 340, v.host ? C.teal : C.rose)
  const cx = box.x + box.w / 2
  drawFarmer(ctx, v.look, cx, box.y + box.h * 0.5, Math.min(box.h * 0.4, 120 * ui), clock, 1, false)
  text(v.host ? `🏠 ${t.visitingTitle} ${v.name}` : `${t.level} ${v.level}`, cx, box.y + box.h * 0.6, 14 * ui, C.text, 'center', 900, null)
  const bw = Math.min(170 * ui, box.w * 0.42)
  const room = farmRoom
  const wave = () => {
    if (room) safely(() => room.send({ type: 'wave' }, id))
    myEmote = { text: '👋 ' + t.hello, life: 2.5 }
    sound.coin()
  }
  if (guests.has(id)) {
    button('👋 ' + t.wave, cx - bw - 6 * ui, box.y + box.h - 60 * ui, bw, 44 * ui, C.sky, true, wave)
    button(t.sendHome, cx + 6 * ui, box.y + box.h - 60 * ui, bw, 44 * ui, C.coral, true, () => sendHome(id))
  } else button('👋 ' + t.wave, cx - bw / 2, box.y + box.h - 60 * ui, bw, 44 * ui, C.sky, true, wave)
  buttons.push(box.close)
}

function drawZonePanel(zone: Zone) {
  const box = panelFrame(t.zones[zone.id], 400, 280, C.leafDark)
  const cx = box.x + box.w / 2
  ctx.save()
  roundRect(ctx, cx - 64 * ui, box.y + 12 * ui, 128 * ui, 84 * ui, 14 * ui)
  ctx.clip()
  drawForest(ctx, cx - 64 * ui, box.y + 12 * ui, 128 * ui, 84 * ui, clock)
  ctx.restore()
  roundRect(ctx, cx - 64 * ui, box.y + 12 * ui, 128 * ui, 84 * ui, 14 * ui)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 2
  ctx.stroke()
  text(t.zoneHelp, cx, box.y + 118 * ui, 14 * ui, C.muted, 'center', 800, null)
  const bw = box.w * 0.6
  const bh = 48 * ui
  if (farm.level >= zone.level) {
    button(t.buy + ' · ' + zone.price, cx - bw / 2, box.y + box.h - bh - 16 * ui, bw, bh, C.teal, farm.s.coins >= zone.price, () => bought(farm.buyZone(zone), (zone.x + zone.w / 2) * TILE, (zone.y + zone.h / 2) * TILE))
  } else text('🔒 ' + t.levelNeeded + ' ' + zone.level, cx, box.y + box.h - 40 * ui, 18 * ui, C.muted, 'center', 900, null)
  buttons.push(box.close)
}

function drawPlacingBanner() {
  const w = Math.min(width - 40, 460 * ui)
  const x = (width - w) / 2
  const y = 74 * ui
  card(x, y, w, 52 * ui, 26 * ui, C.paper, 2.5)
  text(t.placeHere, x + 22 * ui, y + 26 * ui, fitSize(t.placeHere, w - 140 * ui, 14 * ui, 800), C.text, 'left', 800, null)
  button(t.cancel, x + w - 108 * ui, y + 8 * ui, 96 * ui, 38 * ui, C.coral, true, () => (placing = null))
}

/** On a friend's farm: whose farm it is, and what your help does. */
function drawVisitBanner() {
  if (!visit || !visit.host) return
  const title = `🏠 ${t.visitingTitle} ${clip(visit.name, 18)}`
  // Between the profile and the coins when there is room, else under them.
  const left = 205 * ui
  const right = width - 154 * ui
  const roomy = right - left >= 250 * ui
  const w = roomy ? Math.min(right - left - 12 * ui, 380 * ui) : Math.min(width - 32 * ui, 380 * ui)
  const x = roomy ? (left + right - w) / 2 : (width - w) / 2
  const y = (roomy ? 12 * ui : 98 * ui) + Math.sin(clock * 2) * 2 * ui
  const cx = x + w / 2
  card(x, y, w, 50 * ui, 16 * ui, C.mint, 2.5)
  text(title, cx, y + 17 * ui, fitSize(title, w - 24 * ui, 15 * ui, 900), C.text, 'center', 900, null)
  text(t.visitingHelp, cx, y + 36 * ui, fitSize(t.visitingHelp, w - 24 * ui, 11 * ui, 700), C.text, 'center', 700, null)
}

/** An invitation received: it slides in, with a countdown. */
function drawInvitation() {
  const inv = invitation
  if (!inv) return
  const w = Math.min(width - 24, 330 * ui)
  const h = 150 * ui
  const k = easeBack((inv.max - inv.life) * 3)
  const x = width - (w + 14 * ui) * k
  const y = Math.min(108 * ui, height - h - 100 * ui)
  ctx.save()
  ctx.translate(x + w / 2, y + h / 2)
  ctx.rotate(Math.sin(clock * 3) * 0.01)
  ctx.translate(-(x + w / 2), -(y + h / 2))
  card(x, y, w, h, 20 * ui, C.paper, 3)
  roundRect(ctx, x, y, w, 8 * ui, 4 * ui)
  ctx.save()
  roundRect(ctx, x + 10 * ui, y + h - 12 * ui, w - 20 * ui, 6 * ui, 3 * ui)
  paint(ctx, '#eadfce')
  roundRect(ctx, x + 10 * ui, y + h - 12 * ui, (w - 20 * ui) * (inv.life / inv.max), 6 * ui, 3 * ui)
  paint(ctx, inv.life < 8 ? C.coral : C.teal)
  ctx.restore()
  const bounce = Math.abs(Math.sin(clock * 4)) * 4 * ui
  face(inv.from, x + 40 * ui, y + 44 * ui - bounce, 24 * ui)
  text('🏡', x + 58 * ui, y + 62 * ui, 16 * ui, '#fff', 'center', 900, null)
  const name = clip(inv.from.name, 18)
  text(name, x + 76 * ui, y + 30 * ui, fitSize(name, w - 90 * ui, 16 * ui, 900), C.text, 'left', 900, null)
  text(t.invitesYou, x + 76 * ui, y + 50 * ui, fitSize(t.invitesYou, w - 90 * ui, 12 * ui, 800), C.text, 'left', 800, null)
  text(t.inviteHelp, x + 76 * ui, y + 67 * ui, fitSize(t.inviteHelp, w - 90 * ui, 10 * ui, 700), C.muted, 'left', 700, null)
  const bw = (w - 36 * ui) / 2
  button(t.decline, x + 12 * ui, y + h - 60 * ui, bw, 42 * ui, '#a99bb0', true, declineInvitation)
  button(t.accept, x + 24 * ui + bw, y + h - 60 * ui, bw, 42 * ui, C.teal, !travel, acceptInvitation)
  ctx.restore()
}

/** The farmer sleeps: the screen goes dark, z's float, the energy bar fills. */
function drawSleep() {
  if (!sleeping) return
  buttons.push({ x: 0, y: 0, w: width, h: height, enabled: true, action: () => {} })
  const k = sleeping.t / SLEEP_TIME
  const a = Math.min(1, k * 4, (1 - k) * 4)
  ctx.fillStyle = `rgba(20, 16, 48, ${0.82 * a})`
  ctx.fillRect(0, 0, width, height)
  ctx.globalAlpha = a
  for (let i = 0; i < 3; i++) {
    const z = (sleeping.t * 0.5 + i / 3) % 1
    text('Z', width / 2 + 30 * ui + z * 50 * ui, height * 0.42 - z * 70 * ui, (20 + z * 26) * ui, '#e8e0ff', 'center', 900)
  }
  text(sleeping.night ? t.sleepingNight : t.napping, width / 2, height * 0.55, 20 * ui, '#fff', 'center', 900)
  const w = Math.min(width - 60, 260 * ui)
  const fill = Math.min(1, (home.energy + (sleeping.night ? ENERGY.max : ENERGY.nap) * Math.min(1, k * 1.3)) / ENERGY.max)
  roundRect(ctx, (width - w) / 2, height * 0.62, w, 14 * ui, 7 * ui)
  paint(ctx, 'rgba(255,255,255,0.2)', 2)
  roundRect(ctx, (width - w) / 2, height * 0.62, w * fill, 14 * ui, 7 * ui)
  paint(ctx, '#7fcf5a')
  ctx.globalAlpha = 1
}

/** Between two farms: a curtain of clouds sweeps across the screen. */
function drawTravel() {
  if (!travel) return
  const k = travel.dir === 1 ? easeOut(travel.k) : 1 - easeOut(1 - travel.k)
  const cover = travel.dir === 1 ? k : travel.k
  buttons.push({ x: 0, y: 0, w: width, h: height, enabled: true, action: () => {} })
  ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, cover * 1.4 - 0.4)})`
  ctx.fillRect(0, 0, width, height)
  const s = Math.max(width, height) / 5
  for (let row = 0; row < 6; row++) {
    for (let i = 0; i < 6; i++) {
      const from = row % 2 ? 1 : -1
      const x0 = (i / 5) * width
      const x = x0 + from * (1 - cover) * (width + s * 2)
      const y = (row / 5) * height + Math.sin(clock * 2 + i + row) * 6
      drawCloud(ctx, x, y + s * 0.2, s, 'rgba(200, 190, 235, 0.5)')
      drawCloud(ctx, x, y, s, '#ffffff')
    }
  }
  if (cover > 0.9) {
    ctx.globalAlpha = (cover - 0.9) * 10
    const label = visit && !visit.host ? t.travelling : ''
    if (label) text(label, width / 2, height / 2, 26 * ui, C.text, 'center', 900, null)
    ctx.globalAlpha = 1
  }
}

/** Messages (welcome back, purchases, gifts): over everything, panels included. */
function drawToast() {
  if (!toast) return
  const age = (toast.max ?? toast.life) - toast.life
  const k = Math.min(easeBack(age * 3.5), clamp01(toast.life * 2.5))
  const w = Math.min(width - 40, 430 * ui)
  const h = toast.text ? 64 * ui : 46 * ui
  const x = (width - w) / 2
  const y = -h + (h + 66 * ui) * k
  card(x, y, w, h, 20 * ui, C.paper, 2.5)
  roundRect(ctx, x + 14 * ui, y + h / 2 - 3 * ui, 6 * ui, 6 * ui, 3 * ui)
  paint(ctx, C.gold)
  roundRect(ctx, x + w - 20 * ui, y + h / 2 - 3 * ui, 6 * ui, 6 * ui, 3 * ui)
  paint(ctx, C.gold)
  text(toast.title, width / 2, y + (toast.text ? 22 * ui : h / 2), fitSize(toast.title, w - 50 * ui, 18 * ui, 900), C.text, 'center', 900, null)
  if (toast.text) text(toast.text, width / 2, y + 45 * ui, fitSize(toast.text, w - 50 * ui, 13 * ui, 800), C.muted, 'center', 800, null)
}

function drawOverlays() {
  if (levelBanner) {
    const age = 3.5 - levelBanner.life
    const k = Math.min(easeBack(age * 2.5), clamp01(levelBanner.life * 2))
    const cy = height * 0.32
    ctx.save()
    ctx.translate(width / 2, cy)
    ctx.scale(k, k)
    ctx.rotate(Math.sin(clock * 2) * 0.02)
    const label = `${t.levelUp} ${levelBanner.level} !`
    const size = 40 * ui
    ctx.font = `900 ${size}px ${FONT}`
    const w = ctx.measureText(label).width + 90 * ui
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo((side * w) / 2 - side * 20 * ui, -26 * ui)
      ctx.lineTo((side * w) / 2 + side * 34 * ui, -26 * ui)
      ctx.lineTo((side * w) / 2 + side * 22 * ui, 0)
      ctx.lineTo((side * w) / 2 + side * 34 * ui, 30 * ui)
      ctx.lineTo((side * w) / 2 - side * 20 * ui, 30 * ui)
      ctx.closePath()
      paint(ctx, C.coralDark, 3)
    }
    roundRect(ctx, -w / 2, -34 * ui, w, 64 * ui, 16 * ui)
    paint(ctx, C.coral, 3)
    text(label, 0, -2 * ui, size, C.gold, 'center', 900, 'rgba(61,42,69,0.9)')
    ctx.restore()
    if (levelBanner.news.length) {
      ctx.globalAlpha = clamp01(levelBanner.life * 2)
      text(`${t.unlocked} : ${levelBanner.news.join(', ')}`, width / 2, cy + 54 * ui, fitSize(`${t.unlocked} : ${levelBanner.news.join(', ')}`, width - 40, 17 * ui, 900), '#fff', 'center', 900)
      ctx.globalAlpha = 1
    }
  }
  for (const f of flyers) {
    if (f.t < 0) continue
    const k = Math.max(0, f.t / f.duration)
    const e = k * k * (3 - 2 * k)
    const mx = (f.x0 + f.x1) / 2
    const my = Math.min(f.y0, f.y1) - 90
    const x = (1 - e) * (1 - e) * f.x0 + 2 * (1 - e) * e * mx + e * e * f.x1
    const y = (1 - e) * (1 - e) * f.y0 + 2 * (1 - e) * e * my + e * e * f.y1
    // A little trail of sparkles.
    ctx.fillStyle = `rgba(255, 245, 200, ${0.6 * (1 - k)})`
    star4(ctx, x - (f.x1 - f.x0) * 0.03, y + 6, 2.5)
    if (f.item === 'coin') drawCoin(ctx, x, y, 9 * ui, f.t * 12)
    else drawItem(ctx, f.item, x, y, 30 * ui * (1 - e * 0.4))
  }
  for (const p of particles) {
    if (!p.screen) continue
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5)
    ctx.fillStyle = p.color
    if (p.star) star4(ctx, p.x, p.y, p.size)
    else {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawTitle() {
  ctx.fillStyle = 'rgba(40, 30, 70, 0.22)'
  ctx.fillRect(0, 0, width, height)
  const s = Math.min(width, height * 1.4) / 520
  const cy = height * 0.3
  // A cloud plaque behind the name.
  drawCloud(ctx, width / 2 + 6 * s, cy + 50 * s, 150 * s, 'rgba(61,42,69,0.18)')
  drawCloud(ctx, width / 2, cy + 40 * s + Math.sin(clock * 1.2) * 4 * s, 150 * s, '#ffffff')
  const word = (value: string, y: number, color: string, size: number, offset: number) => {
    ctx.font = `900 ${size}px ${FONT}`
    const total = ctx.measureText(value).width
    let x = width / 2 - total / 2
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]
      const cw = ctx.measureText(ch).width
      const bounce = Math.sin(clock * 3 - (i + offset) * 0.5) * 5 * s
      text(ch, x + cw / 2, y + bounce, size, color, 'center', 900, C.ink)
      x += cw
    }
  }
  word('CLOUD', cy, C.sky, 66 * s, 0)
  word('ACRES', cy + 64 * s, C.gold, 66 * s, 5)
  text(t.tagline, width / 2, cy + 118 * s, 20 * s, '#fff', 'center', 900)
  const pulse = 1 + Math.sin(clock * 4) * 0.05
  const prompt = keyboard ? (document.hasFocus() ? t.pressToStart : t.clickToStart) : t.tapToStart
  const pw = Math.min(width - 40, 330 * s)
  ctx.save()
  ctx.translate(width / 2, height * 0.76)
  ctx.scale(pulse, pulse)
  card(-pw / 2, -26 * s, pw, 52 * s, 26 * s, C.teal, 3)
  text(prompt, 0, 0, fitSize(prompt, pw - 30 * s, 22 * s, 900), '#fff', 'center', 900, 'rgba(61,42,69,0.5)')
  ctx.restore()
  const help = keyboard ? t.howToKeys : t.howTo
  text(help, width / 2, height * 0.76 + 50 * s, fitSize(help, width - 30, 14 * s, 800), '#fff', 'center', 800)
}

function draw() {
  buttons = []
  framed = false
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawWorld(light)
  if (!started) {
    drawTitle()
    hideNameInput()
    return
  }
  const key = panel === null ? '' : typeof panel === 'string' ? panel : JSON.stringify(Object.keys(panel)) + JSON.stringify(Object.values(panel).map((v) => (typeof v === 'object' && v ? (v as { id?: string }).id : v)))
  if (key !== panelKey) {
    panelKey = key
    panelAt = clock
  }
  drawHud()
  if (scene === 'home') drawSeedBar()
  else seedBarRight = 0
  drawMenuButtons()
  drawVisitBanner()
  drawIslandBanner()
  drawOverlays()
  if (placing) drawPlacingBanner()
  if (panel === 'barn') drawBarnPanel()
  else if (panel === 'orders') drawOrdersPanel()
  else if (panel === 'shop') drawShopPanel()
  else if (panel === 'avatar') drawAvatarPanel()
  else if (panel === 'online') drawOnlinePanel()
  else if (panel === 'settings') drawSettingsPanel()
  else if (panel === 'merchant') drawMerchantPanel()
  else if (panel === 'stall') drawStallPanel()
  else if (panel === 'keeper') drawKeeperPanel()
  else if (panel && 'travel' in panel) drawTravelPanel(panel.travel)
  else if (panel && 'tree' in panel) drawTreePanel(panel.tree)
  else if (panel && 'seller' in panel) drawSellerPanel(panel.seller)
  else if (panel && 'visitor' in panel) drawVisitorPanel(panel.visitor)
  else if (panel && 'person' in panel) drawPersonPanel(panel.person)
  else if (panel && 'zone' in panel) drawZonePanel(panel.zone)
  else if (panel) drawBuyPanel(panel.buy)
  if (framed) ctx.restore()
  if (panel !== 'settings') hideNameInput()
  if (!panel) drawInvitation()
  drawToast()
  if (keyboard && !document.hasFocus() && !paused && !panel && !nameShown) {
    // Keys go to the page around the game until it is clicked.
    const w = Math.min(width - 40, 390 * ui)
    roundRect(ctx, (width - w) / 2, height - 136 * ui, w, 36 * ui, 18 * ui)
    paint(ctx, 'rgba(61, 42, 69, 0.85)', 2)
    text('⌨ ' + t.clickToFocus, width / 2, height - 118 * ui, fitSize('⌨ ' + t.clickToFocus, w - 20 * ui, 13 * ui, 800), '#fff', 'center', 800, null)
  }
  drawSleep()
  drawTravel()
  if (paused) {
    ctx.fillStyle = 'rgba(40, 25, 55, 0.5)'
    ctx.fillRect(0, 0, width, height)
    text(t.paused, width / 2, height / 2, 34 * ui, '#fff')
  }
}

// --- input -----------------------------------------------------------------------------------

type Gesture = { mode: 'pending' | 'pan' | 'farm'; startX: number; startY: number; lastX: number; lastY: number; place?: Place }
const pointers = new Map<number, { x: number; y: number }>()
let gesture: Gesture | null = null
let pinch: { distance: number; zoom: number } | null = null

function position(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function swipeFarm(x0: number, y0: number, x1: number, y1: number) {
  const a = toWorld(x0, y0)
  const b = toWorld(x1, y1)
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (TILE * 0.25)))
  for (let i = 1; i <= steps; i++) touchPlot(plotAt(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps))
}

function startGame() {
  started = true
  const ready = farm.readyThings()
  if (farm.away > 60) toast = { title: t.welcomeBack, text: `${t.whileAway}${ready ? ` · ${ready} ${t.ready.toLowerCase()}` : ''}`, life: 4 }
}

canvas.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  sound.unlock()
  canvas.focus()
  canvas.setPointerCapture(event.pointerId)
  const p = position(event)
  press = { x: p.x, y: p.y, at: clock }
  pointers.set(event.pointerId, p)
  if (pointers.size === 2) {
    // Pinch to zoom (cancels the current gesture).
    const [a, b] = [...pointers.values()]
    pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom }
    if (gesture && gesture.mode === 'farm') endSwipe(toWorld(p.x, p.y).x, toWorld(p.x, p.y).y)
    gesture = null
    return
  }
  if (!started) {
    startGame()
    return
  }
  if (paused) return
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i]
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      if (b.enabled) b.action()
      else sound.denied()
      return
    }
  }
  if (catchShootingStar(p.x, p.y)) return
  const w = toWorld(p.x, p.y)
  if (placing) {
    hover = w
    gesture = { mode: 'pending', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
    return
  }
  const hit = scene === 'home' ? plotAt(w.x, w.y) : null
  if (hit && tool === 'tractor' && !visit) {
    sendTractor(hit.place)
    gesture = null
  } else if (hit) {
    gesture = { mode: 'farm', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y }
    touchedPlots.clear()
    touchPlot(hit)
    goTo((hit.place.x + hit.place.w / 2) * TILE, (hit.place.y + hit.place.h) * TILE + 14)
  } else {
    gesture = { mode: 'pending', startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, place: scene === 'home' ? placeAt(w.x, w.y) : undefined }
  }
})

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse') {
    mouse = position(event)
    const hit = [...buttons].reverse().find((b) => inside(b, mouse) && !(b.w >= width && b.h >= height))
    canvas.style.cursor = hit && hit.enabled ? 'pointer' : ''
  }
  if (placing) {
    const q = position(event)
    hover = toWorld(q.x, q.y)
  }
  if (!pointers.has(event.pointerId)) return
  const p = position(event)
  pointers.set(event.pointerId, p)
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    cam.zoom = pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance)
    clampCamera()
    return
  }
  if (!gesture) return
  if (gesture.mode === 'pending' && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > 8 * ui) gesture.mode = 'pan'
  if (gesture.mode === 'pan') {
    followCamera = false
    cam.x -= (p.x - gesture.lastX) / cam.zoom
    cam.y -= (p.y - gesture.lastY) / cam.zoom
    clampCamera()
  } else if (gesture.mode === 'farm') {
    swipeFarm(gesture.lastX, gesture.lastY, p.x, p.y)
  }
  gesture.lastX = p.x
  gesture.lastY = p.y
})

function pointerEnd(event: PointerEvent) {
  pointers.delete(event.pointerId)
  if (pointers.size < 2) pinch = null
  if (!gesture) return
  const p = position(event)
  const w = toWorld(p.x, p.y)
  const visitor = gesture.mode === 'pending' && !placing && scene === 'home' ? visitorAt(w.x, w.y) : null
  const tapped = gesture.mode === 'pending' && !placing && !visitor ? interactiveAt(w.x, w.y) : null
  const shopper = gesture.mode === 'pending' && scene === 'market' ? [...shoppers.values()].find((s) => Math.abs(w.x - s.x) < 26 && w.y > s.y - 64 && w.y < s.y + 12) : null
  if (gesture.mode === 'farm') endSwipe(w.x, w.y)
  else if (shopper) panel = { seller: shopper.id }
  else if (tapped) interact(tapped)
  else if (visitor) panel = { visitor: visitor.id }
  else if (gesture.mode === 'pending' && placing) placeDecorAt(w.x, w.y)
  else if (gesture.mode === 'pending' && gesture.place) tapPlace(gesture.place)
  else if (gesture.mode === 'pending') {
    const zone = visit || scene !== 'home' ? null : zoneAt(w.x, w.y)
    if (zone) panel = { zone }
    else goTo(w.x, w.y)
  }
  gesture = null
}
canvas.addEventListener('pointerup', pointerEnd)
canvas.addEventListener('pointerleave', () => (mouse = null))
canvas.addEventListener('pointercancel', pointerEnd)
canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const p = { x: event.offsetX, y: event.offsetY }
    const before = toWorld(p.x, p.y)
    cam.zoom *= Math.exp(-event.deltaY * 0.0015)
    clampCamera()
    const after = toWorld(p.x, p.y)
    cam.x += before.x - after.x
    cam.y += before.y - after.y
    clampCamera()
  },
  { passive: false },
)
window.addEventListener('keydown', (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (KEYS[key] || key === ' ') event.preventDefault() // no page scrolling
  keyboard = true
  sound.unlock()
  if (!started) {
    if (key === ' ' || key === 'Enter') startGame()
    return
  }
  if (paused || travel || sleeping) return
  if (invitation && !panel) {
    if (key === 'Enter' || key === 'y') {
      acceptInvitation()
      return
    }
    if (key === 'Escape' || key === 'n') {
      declineInvitation()
      return
    }
  }
  if (KEYS[key]) held.add(key)
  const n = Number(key)
  const crops = farm.crops()
  if (n >= 1 && n <= crops.length) {
    selected = crops[n - 1].id
    tool = 'seed'
  }
  if (key === 'Escape') {
    panel = null
    placing = null
  }
  if (event.repeat) return
  if ((key === ' ' || key === 'Enter' || key === 'e') && !panel) {
    if (placing) placeDecorAt(farmer.x, farmer.y + 30)
    else useNearby()
  }
  if (key === 't' && farm.s.machines.tractor && !panel && !visit) {
    const hit = plotAt(farmer.x, farmer.y - 6)
    if (hit) sendTractor(hit.place)
  }
})
window.addEventListener('keyup', (event) => {
  held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key)
})
window.addEventListener('blur', () => held.clear())

// --- loop and noru play ----------------------------------------------------------------------

let last = performance.now()
let firstFrame = true
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20)
  last = now
  update(paused ? 0 : dt)
  draw()
  if (firstFrame) {
    firstFrame = false
    play.firstFrameReady()
  }
  requestAnimationFrame(frame)
}

play.onPause(() => {
  paused = true
  sound.suspend()
  if (dirty) persist()
})
play.onResume(() => {
  paused = false
  sound.resume()
})
play.onAudioChange((on) => sound.setEnabled(on && soundOn()))
sound.setEnabled(play.isAudioEnabled && soundOn())
window.addEventListener('pagehide', () => persist())

paintGround()
window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
play
  .load<Save>()
  .then((saved) => {
    home = farm = new Farm(saved)
  })
  .catch((error) => play.logWarning(error))
  .finally(() => {
    // The website's language and player are known now.
    t = texts(play.language)
    loadPlayer()
    home.onLevelUp = levelUp
    if (!farm.crops().some((c) => c.id === selected)) selected = 'wheat'
    play.gameReady()
    loadShop()
    joinLobby()
    joinFarmRoom()
    // ?scene=orchard (or market, ruins) starts on that island (to see it at once).
    const start = new URLSearchParams(location.search).get('scene')
    if (start === 'orchard' || start === 'market' || start === 'ruins') {
      scene = start
      const at = arrival(start)
      placeFarmer(at.x, at.y)
      fitCamera()
      if (start === 'market') joinMarket()
    }
    // ?panel=keeper (merchant, stall, travel-dock, travel-pad, tree-3...) opens a window (development).
    const open = new URLSearchParams(location.search).get('panel') || ''
    if (open === 'keeper' || open === 'merchant' || open === 'stall' || open === 'barn' || open === 'shop' || open === 'settings') panel = open
    else if (open.startsWith('travel-')) panel = { travel: open === 'travel-pad' ? 'pad' : 'dock' }
    else if (open.startsWith('tree-')) panel = { tree: Math.max(0, Math.min(11, Number(open.slice(5)) || 0)) }
  })
