// Cloud Acres: the rules of the farm, independent of the display. Every timer is a moment of the
// game clock (seconds), so the farm keeps working while the game is closed: on load, the clock
// moves forward by the time spent away.

import {
  WORKER,
  WORKERS,
  WORKER_IDS,
  UPGRADES,
  MAX_UPGRADE,
  type UpgradeId,
  type WorkerId,
  type SaveV2,
  BARN_BASE,
  DECORS,
  MACHINES,
  SILO_PRICES,
  SILO_SIZE,
  SPRINKLER_PRICES,
  TRUCK_TRIP,
  ZONES,
  CROPS,
  ITEMS,
  LEVELS,
  MAX_AWAY,
  NEW_SAVE,
  PENS,
  PLACES,
  WORKSHOPS,
  WORKSHOP_QUEUE,
  NAME_MAX,
  ANIMAL_PRICES,
  EXTRA_ANIMALS,
  RESALE,
  TRANSPORT,
  ISLANDS,
  FRUITS,
  ORCHARD_SPOTS,
  STAR_SEED,
  CRYSTAL_PLOTS,
  RUIN_QUESTS,
  STALL_OFFERS,
  STALL_MAX,
  MERCHANT_MAX,
  ENERGY,
  MARKET_MARKUP,
  NEW_RUINS,
  type TransportId,
  type SceneId,
  type FruitId,
  type CrystalId,
  cropById,
  type CropId,
  type DecorKind,
  type MachineId,
  type Zone,
  type ItemId,
  type OrderState,
  type Place,
  type PlotState,
  type Save,
} from './data'

export type Missing = { item: ItemId; count: number }[]

export const ORDER_SLOTS = 3

export type Buy = 'ok' | 'level' | 'coins' | 'max'
/** A job of a worker: harvest a plot, collect or feed a pen, collect or start a workshop. */
export type WorkerTask =
  | { kind: 'plot'; place: Place; index: number }
  | { kind: 'pen'; place: Place }
  | { kind: 'feed'; place: Place }
  | { kind: 'workshop'; place: Place }
  | { kind: 'start'; place: Place }
export type WorkerResult = { item: ItemId; count: number } | 'fed' | 'started' | 'full' | null
export type FarmEvent = { type: 'truck-out' } | { type: 'truck-back'; coins: number }

/** A save of any version, as the newest one. */
function upgradeSave(saved: Save | SaveV2): Save {
  const fresh = NEW_SAVE()
  const s = { ...fresh, ...saved, version: 3 } as Save & { helper?: { hiredUntil: number } }
  s.workers = { ...fresh.workers, ...(saved.version === 3 ? saved.workers : {}) }
  s.upgrades = { ...fresh.upgrades, ...(saved.version === 3 ? saved.upgrades : {}) }
  s.credited = saved.version === 3 && Array.isArray(saved.credited) ? saved.credited : []
  // Version 2 had one farmhand: they become the field hand.
  if (saved.version === 2 && saved.helper) s.workers.field = { until: saved.helper.hiredUntil, forever: false }
  delete s.helper
  s.name = typeof s.name === 'string' ? s.name.slice(0, NAME_MAX) : ''
  s.online = s.online !== false
  const fresh3 = saved.version === 3 ? saved : null
  s.transport = { ferry: !!fresh3?.transport?.ferry, balloon: !!fresh3?.transport?.balloon }
  s.orchard = fresh3 && fresh3.orchard && typeof fresh3.orchard === 'object' ? fresh3.orchard : {}
  s.ruins = { ...NEW_RUINS(), ...(fresh3 && fresh3.ruins && typeof fresh3.ruins === 'object' ? fresh3.ruins : {}) }
  s.stall = fresh3 && Array.isArray(fresh3.stall) ? fresh3.stall : []
  s.merchant = fresh3 && fresh3.merchant && typeof fresh3.merchant === 'object' ? fresh3.merchant : { day: '', sold: 0 }
  s.stock = fresh3 && fresh3.stock && typeof fresh3.stock === 'object' ? fresh3.stock : {}
  s.energy = fresh3 && typeof fresh3.energy === 'number' && Number.isFinite(fresh3.energy) ? Math.min(ENERGY.max, Math.max(0, fresh3.energy)) : ENERGY.max
  return s
}

/** What a visiting friend sees of a farm (and works on): no orders, no purchases, no name. */
export type FarmSnapshot = Pick<
  Save,
  'clock' | 'coins' | 'xp' | 'barn' | 'owned' | 'plots' | 'pens' | 'workshops' | 'avatar' | 'machines' | 'sprinkler' | 'silo' | 'decor' | 'truck' | 'workers' | 'upgrades'
>

const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const round = (value: number) => Math.round(value * 10) / 10
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)

/** A snapshot received from another player, checked field by field (it is drawn as is). */
function cleanSnapshot(raw: unknown): FarmSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, any>
  const fresh = NEW_SAVE()
  const barn: Save['barn'] = {}
  if (s.barn && typeof s.barn === 'object') for (const id of Object.keys(ITEMS)) if (has(s.barn, id)) barn[id as ItemId] = Math.max(0, Math.floor(num(s.barn[id])))
  const placeIds = new Set([...PLACES.map((p) => p.id), ...ZONES.map((z) => z.id)])
  const owned = Array.isArray(s.owned) ? s.owned.filter((id: unknown) => typeof id === 'string' && placeIds.has(id)) : fresh.owned
  const plots: Save['plots'] = {}
  const pens: Save['pens'] = {}
  const workshops: Save['workshops'] = {}
  for (const place of PLACES) {
    if (place.kind === 'field' && s.plots && Array.isArray(s.plots[place.id])) {
      plots[place.id] = Array.from({ length: place.w * place.h }, (_, i) => {
        const plot = s.plots[place.id][i] || {}
        const crop = CROPS.some((c) => c.id === plot.crop) ? (plot.crop as CropId) : null
        return { crop, readyAt: num(plot.readyAt) }
      })
    }
    if (place.kind === 'pen' && s.pens && s.pens[place.id]) {
      const animals = Math.floor(num(s.pens[place.id].animals, PENS[place.animal!].animals))
      pens[place.id] = { readyAt: num(s.pens[place.id].readyAt), animals: Math.min(PENS[place.animal!].animals + EXTRA_ANIMALS, Math.max(1, animals)) }
    }
    if (place.kind === 'workshop' && s.workshops && s.workshops[place.id] && Array.isArray(s.workshops[place.id].queue)) {
      workshops[place.id] = { queue: s.workshops[place.id].queue.slice(0, 10).map((t: unknown) => num(t)) }
    }
  }
  const avatar = s.avatar && typeof s.avatar === 'object' ? s.avatar : fresh.avatar
  const upgrades = { ...fresh.upgrades }
  for (const id of Object.keys(upgrades) as UpgradeId[]) if (s.upgrades) upgrades[id] = Math.min(MAX_UPGRADE, Math.max(1, Math.floor(num(s.upgrades[id], 1))))
  const workers = { ...fresh.workers }
  for (const id of WORKER_IDS) if (s.workers && s.workers[id]) workers[id] = { until: num(s.workers[id].until), forever: !!s.workers[id].forever }
  return {
    clock: num(s.clock),
    coins: Math.max(0, Math.floor(num(s.coins))),
    xp: Math.max(0, Math.floor(num(s.xp))),
    barn,
    owned,
    plots,
    pens,
    workshops,
    avatar: { skin: num(avatar.skin), hat: num(avatar.hat), shirt: num(avatar.shirt), pants: num(avatar.pants) },
    machines: { tractor: !!(s.machines && s.machines.tractor), truck: !!(s.machines && s.machines.truck) },
    sprinkler: Math.min(SPRINKLER_PRICES.length, Math.max(0, Math.floor(num(s.sprinkler)))),
    silo: Math.min(SILO_PRICES.length, Math.max(0, Math.floor(num(s.silo)))),
    decor: Array.isArray(s.decor)
      ? s.decor.slice(0, 120).filter((d: any) => d && has(DECORS, d.kind)).map((d: any) => ({ kind: d.kind as DecorKind, x: num(d.x), y: num(d.y) }))
      : [],
    truck: { returnAt: num(s.truck && s.truck.returnAt), coins: 0, xp: 0 },
    workers,
    upgrades,
  }
}

export class Farm {
  s: Save
  /** Seconds the farm worked while the game was closed (shown once). */
  away = 0
  onLevelUp: (level: number) => void = () => {}
  /** Things that happened by themselves (the truck), for the display. */
  events: FarmEvent[] = []

  constructor(saved: Save | SaveV2 | null) {
    const known = !!saved && (saved.version === 2 || saved.version === 3)
    this.s = known ? upgradeSave(saved!) : NEW_SAVE()
    if (known) {
      this.away = Math.min(Math.max((Date.now() - saved!.savedAt) / 1000, 0), MAX_AWAY)
      this.rest(this.away / ENERGY.regenEvery)
      this.catchUp(this.s.clock + this.away)
    }
    this.ensureOrders()
  }

  /** A friend's farm, shown while visiting them: it follows the snapshots they send. */
  static view(snapshot: unknown): Farm | null {
    const farm = new Farm(null)
    return farm.applySnapshot(snapshot) ? farm : null
  }

  /** Replaces what a visitor sees by a newer snapshot. false if the snapshot is not valid. */
  applySnapshot(raw: unknown) {
    const snapshot = cleanSnapshot(raw)
    if (!snapshot) return false
    this.s = { ...this.s, ...snapshot, orders: [] }
    return true
  }

  /** What friends visiting this farm need to see it and work on it. */
  snapshot(): FarmSnapshot {
    const s = this.s
    const plots: Save['plots'] = {}
    for (const id of Object.keys(s.plots)) plots[id] = s.plots[id].map((p) => ({ crop: p.crop, readyAt: p.crop ? round(p.readyAt) : 0 }))
    const workshops: Save['workshops'] = {}
    for (const id of Object.keys(s.workshops)) workshops[id] = { queue: s.workshops[id].queue.map(round) }
    const pens: Save['pens'] = {}
    for (const id of Object.keys(s.pens)) pens[id] = { readyAt: round(s.pens[id].readyAt), animals: s.pens[id].animals }
    return {
      clock: round(s.clock),
      coins: s.coins,
      xp: s.xp,
      barn: s.barn,
      owned: s.owned,
      plots,
      pens,
      workshops,
      avatar: s.avatar,
      machines: s.machines,
      sprinkler: s.sprinkler,
      silo: s.silo,
      decor: s.decor,
      truck: { returnAt: round(s.truck.returnAt), coins: 0, xp: 0 },
      workers: s.workers,
      upgrades: s.upgrades,
    }
  }

  /** Lives `seconds` of game time at once (time spent visiting a friend), workers included. */
  fastForward(seconds: number) {
    if (seconds > 0) this.catchUp(this.s.clock + Math.min(seconds, MAX_AWAY))
  }

  /**
   * The time spent away: with workers, the farm lives it step by step (crops grow again after being
   * harvested, the truck delivers); without, the clock jumps.
   */
  private catchUp(end: number) {
    const working = WORKER_IDS.some((id) => this.s.workers[id].forever || this.s.workers[id].until > this.s.clock)
    if (!working) {
      this.s.clock = end
      return
    }
    while (this.s.clock < end) {
      this.s.clock = Math.min(end, this.s.clock + WORKER.actionTime)
      this.ensureOrders()
      this.tickTruck()
      for (const id of WORKER_IDS) {
        if (!this.workerActive(id)) continue
        const task = this.workerTasks(id).find((t) => t.kind !== 'plot' || this.space() > 0)
        if (task) this.workerDo(task)
      }
    }
    this.events = []
  }

  // --- workers ----------------------------------------------------------------------------------

  workerActive(id: WorkerId) {
    const w = this.s.workers[id]
    return w.forever || w.until > this.clock
  }

  /** Seconds of work left (Infinity when hired for good). */
  workerLeft(id: WorkerId) {
    const w = this.s.workers[id]
    return w.forever ? Infinity : Math.max(0, w.until - this.clock)
  }

  /** Hires a worker for WORKER.duration more seconds. */
  hireWorker(id: WorkerId): Buy {
    const w = this.s.workers[id]
    if (w.forever || this.workerLeft(id) + WORKER.duration > WORKER.maxAhead) return 'max'
    const result = this.pay(WORKERS[id].level, WORKERS[id].price)
    if (result === 'ok') this.s.workers[id] = { until: Math.max(this.clock, w.until) + WORKER.duration, forever: false }
    return result
  }

  hireWorkerForever(id: WorkerId): Buy {
    if (this.s.workers[id].forever) return 'max'
    const result = this.pay(WORKERS[id].level, WORKERS[id].forever)
    if (result === 'ok') this.s.workers[id] = { until: 0, forever: true }
    return result
  }

  /** What a worker can do now. */
  workerTasks(id: WorkerId): WorkerTask[] {
    const tasks: WorkerTask[] = []
    for (const place of PLACES) {
      if (!this.usable(place)) continue
      if (id === 'field' && place.kind === 'field') {
        this.plots(place).forEach((plot, index) => {
          if (plot.crop && plot.readyAt <= this.clock) tasks.push({ kind: 'plot', place, index })
        })
      } else if (id === 'animal' && place.kind === 'pen') {
        const status = this.penStatus(place)
        const feed = PENS[place.animal!].feed
        if (status === 'ready') tasks.push({ kind: 'pen', place })
        else if (status === 'hungry' && this.count(feed.item) >= feed.count) tasks.push({ kind: 'feed', place })
      } else if (id === 'craft' && place.kind === 'workshop') {
        if (this.readyCount(place) > 0) tasks.push({ kind: 'workshop', place })
        else if (this.queue(place).length === 0 && this.missing(WORKSHOPS[place.workshop!].inputs).length === 0) tasks.push({ kind: 'start', place })
      }
    }
    return tasks
  }

  /** Does a task (if it is still to do). */
  workerDo(task: WorkerTask): WorkerResult {
    if (task.kind === 'plot') {
      const crop = this.plots(task.place)[task.index].crop
      const result = this.harvest(task.place, task.index)
      if (result === 'full') return 'full'
      if (!result || !crop) return null
      this.plant(task.place, task.index, crop)
      return { item: crop, count: this.harvestYield() }
    }
    if (task.kind === 'pen') {
      const product = this.collectPen(task.place)
      return product === 'full' ? 'full' : product
    }
    if (task.kind === 'feed') return this.penStatus(task.place) === 'hungry' && this.feed(task.place) === 'ok' ? 'fed' : null
    if (task.kind === 'start') return this.startWorkshop(task.place) === 'ok' ? 'started' : null
    const count = this.collectWorkshop(task.place)
    if (count === 'full') return 'full'
    return count ? { item: WORKSHOPS[task.place.workshop!].output, count } : null
  }

  // --- upgrades ---------------------------------------------------------------------------------

  upgradeLevel(id: UpgradeId) {
    return this.s.upgrades[id]
  }

  /** Level and price of the next level of an upgrade, or null at the top. */
  nextUpgrade(id: UpgradeId) {
    const level = this.s.upgrades[id]
    if (level >= MAX_UPGRADE) return null
    return { level: UPGRADES[id].levels[level - 1], price: UPGRADES[id].prices[level - 1] }
  }

  buyUpgrade(id: UpgradeId): Buy {
    const next = this.nextUpgrade(id)
    if (!next) return 'max'
    const result = this.pay(next.level, next.price)
    if (result === 'ok') this.s.upgrades = { ...this.s.upgrades, [id]: this.s.upgrades[id] + 1 }
    return result
  }

  /** Crops given by one plot (fertile fields). */
  harvestYield() {
    return this.s.upgrades.fields
  }

  /** Products of a pen (comfortable pens). */
  penProduct(place: Place) {
    const pen = PENS[place.animal!]
    // More animals, more products (and fewer when some were sold).
    const base = pen.product.count + this.s.upgrades.pens - 1
    return { item: pen.product.item, count: Math.max(1, Math.round((base * this.penAnimals(place)) / pen.animals)) }
  }

  /** Animals in a pen. */
  penAnimals(place: Place) {
    const n = this.s.pens[place.id]?.animals
    return typeof n === 'number' && n >= 1 ? Math.floor(n) : PENS[place.animal!].animals
  }

  penAnimalsMax(place: Place) {
    return PENS[place.animal!].animals + EXTRA_ANIMALS
  }

  buyAnimal(place: Place): Buy {
    if (!this.usable(place) || place.kind !== 'pen') return 'level'
    if (this.penAnimals(place) >= this.penAnimalsMax(place)) return 'max'
    const result = this.pay(place.level, ANIMAL_PRICES[place.animal!])
    if (result === 'ok') this.s.pens[place.id] = { readyAt: this.s.pens[place.id]?.readyAt ?? 0, animals: this.penAnimals(place) + 1 }
    return result
  }

  /** Sells one animal (a pen keeps at least one: sell the pen to empty it). Coins, or 0. */
  sellAnimal(place: Place) {
    if (!this.usable(place) || place.kind !== 'pen' || this.penAnimals(place) <= 1) return 0
    const coins = Math.floor(ANIMAL_PRICES[place.animal!] * RESALE)
    this.s.pens[place.id] = { readyAt: this.s.pens[place.id]?.readyAt ?? 0, animals: this.penAnimals(place) - 1 }
    this.s.coins += coins
    return coins
  }

  // --- selling what you own ----------------------------------------------------------------------

  /** Coins for selling a place: half its price (the starting places cannot be sold). */
  placeResale(place: Place) {
    return place.price > 0 ? Math.floor(place.price * RESALE) : 0
  }

  canSellPlace(place: Place) {
    return this.owns(place.id) && place.price > 0
  }

  /** Sells a field, pen or workshop: what was in it is lost. Coins, or 0. */
  sellPlace(place: Place) {
    if (!this.canSellPlace(place)) return 0
    const coins = this.placeResale(place)
    this.s.owned = this.s.owned.filter((id) => id !== place.id)
    delete this.s.plots[place.id]
    delete this.s.pens[place.id]
    delete this.s.workshops[place.id]
    this.s.coins += coins
    return coins
  }

  /** A land plot can be sold once its fields are sold. */
  canSellZone(zone: Zone) {
    return this.owns(zone.id) && !PLACES.some((p) => p.zone === zone.id && this.owns(p.id))
  }

  sellZone(zone: Zone) {
    if (!this.canSellZone(zone)) return 0
    const coins = Math.floor(zone.price * RESALE)
    this.s.owned = this.s.owned.filter((id) => id !== zone.id)
    this.s.coins += coins
    return coins
  }

  sellDecor(index: number) {
    const decor = this.s.decor[index]
    if (!decor) return 0
    const coins = Math.floor(DECORS[decor.kind].price * RESALE)
    this.s.decor = this.s.decor.filter((_, i) => i !== index)
    this.s.coins += coins
    return coins
  }

  /** The truck cannot be sold while it is on the road. */
  canSellMachine(id: MachineId) {
    return this.s.machines[id] && !(id === 'truck' && this.s.truck.returnAt > 0)
  }

  sellMachine(id: MachineId) {
    if (!this.canSellMachine(id)) return 0
    const coins = Math.floor(MACHINES[id].price * RESALE)
    this.s.machines = { ...this.s.machines, [id]: false }
    this.s.coins += coins
    return coins
  }

  /** What firing a worker gives back: half of the time not worked (or of the price, hired for good). */
  workerResale(id: WorkerId) {
    const w = this.s.workers[id]
    if (w.forever) return Math.floor(WORKERS[id].forever * RESALE)
    return Math.floor(((WORKERS[id].price * this.workerLeft(id)) / WORKER.duration) * RESALE)
  }

  fireWorker(id: WorkerId) {
    if (!this.workerActive(id)) return 0
    const coins = this.workerResale(id)
    this.s.workers[id] = { until: 0, forever: false }
    this.s.coins += coins
    return coins
  }

  /** Value of everything in the barn. */
  barnValue() {
    return (Object.keys(ITEMS) as ItemId[]).reduce((sum, id) => sum + this.count(id) * ITEMS[id].price, 0)
  }

  /** Sells everything in the barn. Coins. */
  sellAll() {
    let coins = 0
    for (const id of Object.keys(ITEMS) as ItemId[]) coins += this.sell(id, this.count(id))
    return coins
  }

  /** Seconds of one production of a workshop (modern workshops). */
  workshopTime(place: Place) {
    return WORKSHOPS[place.workshop!].time * (1 - 0.25 * (this.s.upgrades.workshops - 1))
  }

  /** Productions waiting in a workshop at most. */
  queueMax() {
    return WORKSHOP_QUEUE + this.s.upgrades.workshops - 1
  }

  // --- purchases and gifts ------------------------------------------------------------------------

  /** Coins bought on the website. false if this purchase was already given. */
  creditPurchase(purchaseId: string, coins: number) {
    if (this.s.credited.includes(purchaseId)) return false
    this.s.coins += Math.max(0, Math.floor(coins))
    this.s.credited = [...this.s.credited, purchaseId].slice(-50)
    return true
  }

  /** Gives items to another player (taken from the barn). */
  giveGift(item: ItemId, count: number) {
    if (this.count(item) < count) return false
    this.s.barn[item] = this.count(item) - count
    return true
  }

  /** Items given by another player (as many as the barn can hold). */
  receiveGift(item: ItemId, count: number) {
    const n = Math.min(count, this.space())
    if (n > 0) this.add(item, n)
    return n
  }

  get clock() {
    return this.s.clock
  }

  advance(dt: number) {
    this.s.clock += dt
    this.rest(dt / ENERGY.regenEvery)
    this.ensureOrders()
    this.tickTruck()
  }

  toSave(): Save {
    this.s.savedAt = Date.now()
    return this.s
  }

  // --- level and coins ------------------------------------------------------------------------

  get level() {
    let level = 1
    while (level < LEVELS.length && this.s.xp >= LEVELS[level]) level++
    return level
  }

  /** XP of the current level, and needed for the next one. */
  levelProgress() {
    const level = this.level
    const from = LEVELS[level - 1]
    const to = LEVELS[Math.min(level, LEVELS.length - 1)]
    return to > from ? (this.s.xp - from) / (to - from) : 1
  }

  addXp(amount: number) {
    const before = this.level
    this.s.xp += amount
    for (let level = before + 1; level <= this.level; level++) this.onLevelUp(level)
  }

  // --- barn -------------------------------------------------------------------------------------

  count(item: ItemId) {
    return this.s.barn[item] ?? 0
  }

  capacity() {
    return BARN_BASE + SILO_SIZE * this.s.silo
  }

  used() {
    return Object.values(this.s.barn).reduce((sum: number, n) => sum + (n ?? 0), 0)
  }

  space() {
    return Math.max(0, this.capacity() - this.used())
  }

  add(item: ItemId, count: number) {
    this.s.barn[item] = this.count(item) + count
  }

  missing(needs: { item: ItemId; count: number }[]): Missing {
    return needs.filter((n) => this.count(n.item) < n.count).map((n) => ({ item: n.item, count: n.count - this.count(n.item) }))
  }

  take(needs: { item: ItemId; count: number }[]) {
    for (const n of needs) this.s.barn[n.item] = this.count(n.item) - n.count
  }

  sell(item: ItemId, count: number) {
    const n = Math.min(count, this.count(item))
    if (n <= 0) return 0
    this.s.barn[item] = this.count(item) - n
    const coins = n * ITEMS[item].price
    this.s.coins += coins
    return coins
  }

  // --- places -----------------------------------------------------------------------------------

  owns(id: string) {
    return this.s.owned.includes(id)
  }

  /** Bought, and its land plot too. */
  usable(place: Place) {
    return this.owns(place.id) && (!place.zone || this.owns(place.zone))
  }

  unlock(place: Place): 'ok' | 'level' | 'coins' {
    if (place.zone && !this.owns(place.zone)) return 'level'
    if (this.level < place.level) return 'level'
    if (this.s.coins < place.price) return 'coins'
    this.s.coins -= place.price
    this.s.owned.push(place.id)
    this.addXp(Math.round(place.price / 20) + 2)
    return 'ok'
  }

  /** The next place to buy, for the "new" hint. */
  buyable() {
    return PLACES.filter((p) => !this.owns(p.id) && this.level >= p.level)
  }

  private pay(level: number, price: number): Buy {
    if (this.level < level) return 'level'
    if (this.s.coins < price) return 'coins'
    this.s.coins -= price
    this.addXp(Math.round(price / 25) + 2)
    return 'ok'
  }

  buyZone(zone: Zone): Buy {
    if (this.owns(zone.id)) return 'max'
    const result = this.pay(zone.level, zone.price)
    if (result === 'ok') this.s.owned.push(zone.id)
    return result
  }

  buyMachine(id: MachineId): Buy {
    if (this.s.machines[id]) return 'max'
    const result = this.pay(MACHINES[id].level, MACHINES[id].price)
    if (result === 'ok') this.s.machines = { ...this.s.machines, [id]: true }
    return result
  }

  buySprinkler(level: number): Buy {
    if (this.s.sprinkler >= SPRINKLER_PRICES.length) return 'max'
    const result = this.pay(level, SPRINKLER_PRICES[this.s.sprinkler])
    if (result === 'ok') this.s.sprinkler += 1
    return result
  }

  buySilo(level: number): Buy {
    if (this.s.silo >= SILO_PRICES.length) return 'max'
    const result = this.pay(level, SILO_PRICES[this.s.silo])
    if (result === 'ok') this.s.silo += 1
    return result
  }

  placeDecor(kind: DecorKind, x: number, y: number): Buy {
    const result = this.pay(DECORS[kind].level, DECORS[kind].price)
    if (result === 'ok') this.s.decor = [...this.s.decor, { kind, x: Math.round(x), y: Math.round(y) }]
    return result
  }

  zones() {
    return ZONES
  }

  // --- fields -----------------------------------------------------------------------------------

  plots(place: Place): PlotState[] {
    let list = this.s.plots[place.id]
    if (!list) {
      list = Array.from({ length: place.w * place.h }, () => ({ crop: null, readyAt: 0 }))
      this.s.plots[place.id] = list
    }
    return list
  }

  crops() {
    return CROPS.filter((c) => c.level <= this.level)
  }

  plant(place: Place, index: number, crop: CropId): 'ok' | 'coins' | 'busy' {
    const plot = this.plots(place)[index]
    if (plot.crop) return 'busy'
    const info = cropById(crop)
    const free = info.cost === 1 && this.s.coins < 1 && this.count('wheat') === 0 // never stuck
    if (this.s.coins < info.cost && !free) return 'coins'
    if (!free) this.s.coins -= info.cost
    plot.crop = crop
    plot.readyAt = this.clock + this.growTime(info.id)
    return 'ok'
  }

  growTime(crop: CropId) {
    return cropById(crop).grow / (1 + 0.3 * this.s.sprinkler)
  }

  growth(plot: PlotState) {
    if (!plot.crop) return 0
    const grow = this.growTime(plot.crop)
    return Math.min(1, Math.max(0, 1 - (plot.readyAt - this.clock) / grow))
  }

  harvest(place: Place, index: number): CropId | 'full' | null {
    const plot = this.plots(place)[index]
    if (!plot.crop || plot.readyAt > this.clock) return null
    if (this.space() < 1) return 'full'
    const crop = plot.crop
    plot.crop = null
    this.add(crop, Math.min(this.harvestYield(), this.space()))
    this.addXp(1)
    return crop
  }

  // --- animals ----------------------------------------------------------------------------------

  penStatus(place: Place): 'hungry' | 'busy' | 'ready' {
    const state = this.s.pens[place.id]
    if (!state || state.readyAt === 0) return 'hungry'
    return state.readyAt <= this.clock ? 'ready' : 'busy'
  }

  penProgress(place: Place) {
    const state = this.s.pens[place.id]
    if (!state || !state.readyAt) return 0
    const time = PENS[place.animal!].time
    return Math.min(1, 1 - (state.readyAt - this.clock) / time)
  }

  feed(place: Place): 'ok' | Missing {
    const pen = PENS[place.animal!]
    const missing = this.missing([pen.feed])
    if (missing.length) return missing
    this.take([pen.feed])
    this.s.pens[place.id] = { ...this.s.pens[place.id], readyAt: this.clock + pen.time }
    return 'ok'
  }

  collectPen(place: Place) {
    if (this.penStatus(place) !== 'ready') return null
    const product = this.penProduct(place)
    if (this.space() < product.count) return 'full' as const
    this.add(product.item, product.count)
    this.s.pens[place.id] = { ...this.s.pens[place.id], readyAt: 0 }
    this.addXp(2 * product.count)
    return product
  }

  // --- workshops --------------------------------------------------------------------------------

  queue(place: Place) {
    let state = this.s.workshops[place.id]
    if (!state) {
      state = { queue: [] }
      this.s.workshops[place.id] = state
    }
    return state.queue
  }

  readyCount(place: Place) {
    return this.queue(place).filter((t) => t <= this.clock).length
  }

  /** Progress of the production being made (0..1), or -1 when idle. */
  workshopProgress(place: Place) {
    const pending = this.queue(place).filter((t) => t > this.clock)
    if (!pending.length) return -1
    const time = this.workshopTime(place)
    return Math.min(1, Math.max(0, 1 - (pending[0] - this.clock) / time))
  }

  startWorkshop(place: Place): 'ok' | 'full' | Missing {
    const type = WORKSHOPS[place.workshop!]
    const queue = this.queue(place)
    if (queue.length >= this.queueMax()) return 'full'
    const missing = this.missing(type.inputs)
    if (missing.length) return missing
    this.take(type.inputs)
    const start = Math.max(this.clock, queue.length ? queue[queue.length - 1] : 0)
    queue.push(start + this.workshopTime(place))
    return 'ok'
  }

  collectWorkshop(place: Place): number | 'full' {
    const ready = Math.min(this.readyCount(place), this.space())
    if (!this.readyCount(place)) return 0
    if (!ready) return 'full'
    const queue = this.queue(place)
    this.s.workshops[place.id] = { queue: queue.slice(ready) }
    const output = WORKSHOPS[place.workshop!].output
    this.add(output, ready)
    this.addXp(3 * ready)
    return ready
  }

  // --- energy of the farmer ----------------------------------------------------------------------

  get energy() {
    return this.s.energy
  }

  /** Spends energy for some work: false (nothing spent) when the farmer is too tired. */
  tire(cost: number) {
    if (this.s.energy < cost) return false
    this.s.energy = Math.max(0, this.s.energy - cost)
    return true
  }

  rest(amount: number) {
    this.s.energy = Math.min(ENERGY.max, this.s.energy + Math.max(0, amount))
  }

  /** A sleep in the house: a full night at night, a nap by day. */
  sleep(night: boolean) {
    this.rest(night ? ENERGY.max : ENERGY.nap)
  }

  // --- buying goods at the market ----------------------------------------------------------------

  /** Price of goods bought at the market (twice what they sell for). */
  buyPrice(item: ItemId) {
    return ITEMS[item].price * MARKET_MARKUP
  }

  buyGoods(item: ItemId, count: number): 'ok' | 'coins' | 'full' {
    const n = Math.max(1, Math.floor(count))
    if (this.space() < n) return 'full'
    const price = this.buyPrice(item) * n
    if (this.s.coins < price) return 'coins'
    this.s.coins -= price
    this.add(item, n)
    return 'ok'
  }

  // --- the other islands -------------------------------------------------------------------------

  buyTransport(id: TransportId): Buy {
    if (this.s.transport[id]) return 'max'
    const result = this.pay(TRANSPORT[id].level, TRANSPORT[id].price)
    if (result === 'ok') this.s.transport = { ...this.s.transport, [id]: true }
    return result
  }

  /** Pays the trip to an island (the way back is free). */
  payFare(island: Exclude<SceneId, 'home'>): 'ok' | 'coins' | 'transport' {
    const info = ISLANDS[island]
    if (!this.s.transport[info.transport]) return 'transport'
    if (this.s.coins < info.fare) return 'coins'
    this.s.coins -= info.fare
    return 'ok'
  }

  // The orchard.

  tree(spot: number) {
    return this.s.orchard[String(spot)] ?? null
  }

  plantTree(spot: number, fruit: FruitId): Buy | 'busy' {
    if (!(spot >= 0 && spot < ORCHARD_SPOTS) || this.tree(spot)) return 'busy'
    const info = FRUITS[fruit]
    const result = this.pay(info.level, info.price)
    if (result !== 'ok') return result
    const grownAt = this.clock + info.grow
    this.s.orchard = { ...this.s.orchard, [String(spot)]: { fruit, grownAt, readyAt: grownAt } }
    return 'ok'
  }

  /** 0 (just planted) to 1 (grown). */
  treeGrowth(spot: number) {
    const tree = this.tree(spot)
    if (!tree) return 0
    return Math.min(1, Math.max(0, 1 - (tree.grownAt - this.clock) / FRUITS[tree.fruit].grow))
  }

  treeReady(spot: number) {
    const tree = this.tree(spot)
    return !!tree && this.clock >= tree.readyAt
  }

  harvestTree(spot: number): { item: FruitId; count: number } | 'full' | null {
    const tree = this.tree(spot)
    if (!tree || this.clock < tree.readyAt) return null
    const info = FRUITS[tree.fruit]
    const count = Math.min(info.yield, this.space())
    if (count <= 0) return 'full'
    this.add(tree.fruit, count)
    this.s.orchard = { ...this.s.orchard, [String(spot)]: { ...tree, readyAt: this.clock + info.every } }
    this.addXp(2 * count)
    return { item: tree.fruit, count }
  }

  /** Pulls a tree up: half of its price back. */
  pullTree(spot: number) {
    const tree = this.tree(spot)
    if (!tree) return 0
    const coins = Math.floor(FRUITS[tree.fruit].price * RESALE)
    const orchard = { ...this.s.orchard }
    delete orchard[String(spot)]
    this.s.orchard = orchard
    this.s.coins += coins
    return coins
  }

  // The celestial ruins.

  get ruins() {
    return this.s.ruins
  }

  /** The crystal garden opens with the first quest done; the bridge with the runes. */
  gardenOpen() {
    return this.s.ruins.quest >= 1
  }

  bridgeOpen() {
    return this.s.ruins.quest >= 4
  }

  crystal(plot: number) {
    return this.s.ruins.plots[String(plot)] ?? null
  }

  plantStar(plot: number): 'ok' | 'coins' | 'busy' | 'locked' {
    if (!this.gardenOpen()) return 'locked'
    if (!(plot >= 0 && plot < CRYSTAL_PLOTS) || this.crystal(plot)) return 'busy'
    if (this.s.coins < STAR_SEED.price) return 'coins'
    this.s.coins -= STAR_SEED.price
    const roll = Math.random()
    const kind: CrystalId = roll < 0.1 ? 'crystalGold' : roll < 0.4 ? 'crystalPink' : 'crystalBlue'
    this.s.ruins.plots = { ...this.s.ruins.plots, [String(plot)]: { kind, readyAt: this.clock + STAR_SEED.grow } }
    return 'ok'
  }

  crystalGrowth(plot: number) {
    const c = this.crystal(plot)
    if (!c) return 0
    return Math.min(1, Math.max(0, 1 - (c.readyAt - this.clock) / STAR_SEED.grow))
  }

  harvestCrystal(plot: number): CrystalId | 'full' | null {
    const c = this.crystal(plot)
    if (!c || this.clock < c.readyAt) return null
    if (this.space() < 1) return 'full'
    this.add(c.kind, 1)
    const plots = { ...this.s.ruins.plots }
    delete plots[String(plot)]
    this.s.ruins.plots = plots
    if (this.s.ruins.quest === 1) this.s.ruins.harvested += 1
    this.addXp(4)
    return c.kind
  }

  /** Lights a lantern (first quest). true if it was dark. */
  lightLantern(i: number) {
    if (this.s.ruins.quest !== 0 || this.s.ruins.lanterns & (1 << i)) return false
    this.s.ruins.lanterns |= 1 << i
    return true
  }

  lanternLit(i: number) {
    return this.s.ruins.quest > 0 || (this.s.ruins.lanterns & (1 << i)) !== 0
  }

  /** Touches a rune (runes quest): 'ok', 'done' (the whole order), 'wrong' (back to the start). */
  touchRune(rune: number): 'ok' | 'done' | 'wrong' | null {
    const r = this.s.ruins
    if (r.quest !== 3 || r.runeStep >= 4) return null
    if (r.runeOrder[r.runeStep] !== rune) {
      r.runeStep = 0
      return 'wrong'
    }
    r.runeStep += 1
    return r.runeStep >= 4 ? 'done' : 'ok'
  }

  /** Star dust picked up at night (last quest). */
  collectStardust() {
    const r = this.s.ruins
    if (r.quest !== 4 || r.stardust >= (RUIN_QUESTS[4].count ?? 5)) return false
    r.stardust += 1
    return true
  }

  /** Progress of the current quest: what you have and what is needed. */
  questProgress(): { have: number; need: number } {
    const r = this.s.ruins
    switch (r.quest) {
      case 0:
        return { have: [0, 1, 2].filter((i) => r.lanterns & (1 << i)).length, need: 3 }
      case 1:
        return { have: Math.min(r.harvested, 5), need: 5 }
      case 2: {
        const needs = RUIN_QUESTS[2].needs
        return { have: needs.reduce((sum, n) => sum + Math.min(this.count(n.item), n.count), 0), need: needs.reduce((sum, n) => sum + n.count, 0) }
      }
      case 3:
        return { have: r.runeStep, need: 4 }
      case 4:
        return { have: r.stardust, need: 5 }
      default:
        return { have: 1, need: 1 }
    }
  }

  canHandIn() {
    if (this.s.ruins.quest >= RUIN_QUESTS.length) return false
    const p = this.questProgress()
    return p.have >= p.need
  }

  /** Gives the current quest to the keeper: coins of the reward, or 0. */
  handIn() {
    if (!this.canHandIn()) return 0
    const r = this.s.ruins
    const quest = RUIN_QUESTS[r.quest]
    if (r.quest === 2) this.take([...RUIN_QUESTS[2].needs])
    this.s.coins += quest.coins
    this.addXp(Math.round(quest.coins / 10))
    r.quest += 1
    if (r.quest === 1) r.harvested = 0
    if (r.quest === RUIN_QUESTS.length) this.s.stock = { ...this.s.stock, starshard: (this.s.stock.starshard ?? 0) + 1 }
    return quest.coins
  }

  /** After the quests: an offering of 3 pink crystals, once a day. */
  canOffer(day: string) {
    return this.s.ruins.quest >= RUIN_QUESTS.length && this.s.ruins.offeringDay !== day && this.count('crystalPink') >= 3
  }

  offer(day: string) {
    if (!this.canOffer(day)) return 0
    this.take([{ item: 'crystalPink', count: 3 }])
    this.s.ruins.offeringDay = day
    this.s.coins += 300
    this.addXp(20)
    return 300
  }

  /** Buys a decoration of the merchant: it goes to your stock, to place on your farm. */
  buyStock(kind: DecorKind): Buy {
    const info = DECORS[kind]
    if (info.where !== 'market') return 'level'
    const result = this.pay(info.level, info.price)
    if (result === 'ok') this.s.stock = { ...this.s.stock, [kind]: (this.s.stock[kind] ?? 0) + 1 }
    return result
  }

  stockOf(kind: DecorKind) {
    return this.s.stock[kind] ?? 0
  }

  /** Places a decoration of your stock, for free. */
  placeFromStock(kind: DecorKind, x: number, y: number) {
    if (this.stockOf(kind) <= 0) return false
    this.s.stock = { ...this.s.stock, [kind]: this.stockOf(kind) - 1 }
    this.s.decor = [...this.s.decor, { kind, x: Math.round(x), y: Math.round(y) }]
    return true
  }

  // The market island.

  /** Puts goods on your stall: they leave the barn while offered. */
  addOffer(item: ItemId, count: number, price: number): 'ok' | 'full' | 'count' {
    const n = Math.floor(count)
    const p = Math.max(1, Math.min(9999, Math.floor(price)))
    if (!(n >= 1 && n <= STALL_MAX) || this.count(item) < n) return 'count'
    const same = this.s.stall.find((o) => o.item === item && o.price === p)
    if (!same && this.s.stall.length >= STALL_OFFERS) return 'full'
    if (same && same.count + n > STALL_MAX) return 'count'
    this.take([{ item, count: n }])
    this.s.stall = same ? this.s.stall.map((o) => (o === same ? { ...o, count: o.count + n } : o)) : [...this.s.stall, { item, count: n, price: p }]
    return 'ok'
  }

  /** Takes an offer back to the barn. */
  removeOffer(index: number) {
    const offer = this.s.stall[index]
    if (!offer) return false
    this.add(offer.item, offer.count)
    this.s.stall = this.s.stall.filter((_, i) => i !== index)
    return true
  }

  /** A player buys from your stall: checked against your offer, then you are paid. */
  sellFromStall(item: ItemId, count: number, price: number) {
    const n = Math.floor(count)
    const offer = this.s.stall.find((o) => o.item === item && o.price === price)
    if (!offer || !(n >= 1) || offer.count < n) return false
    this.s.stall = this.s.stall.map((o) => (o === offer ? { ...o, count: o.count - n } : o)).filter((o) => o.count > 0)
    this.s.coins += n * price
    return true
  }

  /** What you bought from another player's stall arrives. */
  receiveBought(item: ItemId, count: number, price: number) {
    this.s.coins = Math.max(0, this.s.coins - count * price)
    this.add(item, Math.min(count, Math.max(0, this.space())))
  }

  /** The goods the wind merchant pays double for today (the same for everybody). */
  merchantWants(day: string): ItemId {
    const pool: ItemId[] = ['wheat', 'carrot', 'corn', 'tomato', 'pumpkin', 'egg', 'milk', 'wool', 'flour', 'cheese', 'orange', 'mango', 'cacao']
    let h = 0
    for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return pool[h % pool.length]
  }

  /** How many more the merchant buys today. */
  merchantLeft(day: string) {
    return this.s.merchant.day === day ? Math.max(0, MERCHANT_MAX - this.s.merchant.sold) : MERCHANT_MAX
  }

  /** Sells to the merchant at twice the price. Coins. */
  sellToMerchant(day: string, count: number) {
    const item = this.merchantWants(day)
    const n = Math.min(Math.floor(count), this.count(item), this.merchantLeft(day))
    if (n <= 0) return 0
    this.s.barn[item] = this.count(item) - n
    this.s.merchant = { day, sold: (this.s.merchant.day === day ? this.s.merchant.sold : 0) + n }
    const coins = n * ITEMS[item].price * 2
    this.s.coins += coins
    return coins
  }

  // --- orders -----------------------------------------------------------------------------------

  /** Items the player can make now (to build orders). */
  producible(): ItemId[] {
    const items = new Set<ItemId>(this.crops().map((c) => c.id))
    for (const place of PLACES) {
      if (!this.usable(place)) continue
      if (place.animal) items.add(PENS[place.animal].product.item)
      if (place.workshop) {
        const type = WORKSHOPS[place.workshop]
        if (type.inputs.every((input) => items.has(input.item))) items.add(type.output)
      }
    }
    // Fruits of the orchard's trees.
    for (const tree of Object.values(this.s.orchard)) items.add(tree.fruit)
    // Feed must be producible too.
    for (const place of PLACES) if (place.animal && !items.has(PENS[place.animal].feed.item)) items.delete(PENS[place.animal].product.item)
    return [...items]
  }

  private newOrder(): OrderState {
    const pool = this.producible()
    const kinds = Math.min(pool.length, 1 + Math.floor(Math.random() * (this.level >= 4 ? 3 : 2)))
    const chosen: ItemId[] = []
    while (chosen.length < kinds) {
      const item = pool[Math.floor(Math.random() * pool.length)]
      if (!chosen.includes(item)) chosen.push(item)
    }
    const items = chosen.map((item) => {
      const price = ITEMS[item].price
      const max = price < 10 ? 5 : price < 30 ? 3 : 2
      return { item, count: 1 + Math.floor(Math.random() * max) }
    })
    const value = items.reduce((sum, it) => sum + ITEMS[it.item].price * it.count, 0)
    return { villager: Math.floor(Math.random() * 5), items, coins: Math.round(value * 1.45 + 4), xp: Math.round(value / 4) + 2, nextAt: 0 }
  }

  ensureOrders() {
    while (this.s.orders.length < ORDER_SLOTS) this.s.orders.push({ ...this.newOrder(), nextAt: this.clock + this.s.orders.length * 4 })
    this.s.orders.forEach((order, i) => {
      if (order.nextAt > 0 && order.nextAt <= this.clock) this.s.orders[i] = this.newOrder()
    })
  }

  orderReady(index: number) {
    const order = this.s.orders[index]
    return !!order && order.nextAt === 0
  }

  canDeliver(index: number) {
    return this.orderReady(index) && this.missing(this.s.orders[index].items).length === 0
  }

  deliver(index: number) {
    if (!this.canDeliver(index)) return null
    const order = this.s.orders[index]
    this.take(order.items)
    this.s.coins += order.coins
    this.addXp(order.xp)
    this.s.orders[index] = { ...order, nextAt: this.clock + 6 }
    return { coins: order.coins, xp: order.xp }
  }

  /** The truck delivers ready orders by itself. */
  private tickTruck() {
    const truck = this.s.truck
    if (truck.returnAt > 0 && truck.returnAt <= this.clock) {
      this.s.coins += truck.coins
      this.addXp(truck.xp)
      this.events.push({ type: 'truck-back', coins: truck.coins })
      this.s.truck = { returnAt: 0, coins: 0, xp: 0 }
    }
    if (!this.s.machines.truck || this.s.truck.returnAt > 0) return
    const index = this.s.orders.findIndex((_, i) => this.canDeliver(i))
    if (index < 0) return
    const order = this.s.orders[index]
    this.take(order.items)
    this.s.truck = { returnAt: this.clock + TRUCK_TRIP, coins: order.coins, xp: order.xp }
    this.s.orders[index] = { ...order, nextAt: this.clock + TRUCK_TRIP + 4 }
    this.events.push({ type: 'truck-out' })
  }

  /** 0..1 of the current trip, or -1 when the truck is at the farm. */
  truckTrip() {
    if (!this.s.truck.returnAt) return -1
    return Math.min(1, Math.max(0, 1 - (this.s.truck.returnAt - this.clock) / TRUCK_TRIP))
  }

  skip(index: number) {
    if (!this.orderReady(index)) return
    this.s.orders[index] = { ...this.s.orders[index], nextAt: this.clock + 15 }
  }

  /** What is waiting to be collected (for the welcome-back message). */
  readyThings() {
    let ready = 0
    for (const place of PLACES) {
      if (!this.usable(place)) continue
      if (place.kind === 'field') ready += this.plots(place).filter((p) => p.crop && p.readyAt <= this.clock).length
      if (place.kind === 'pen' && this.penStatus(place) === 'ready') ready += 1
      if (place.kind === 'workshop') ready += this.readyCount(place)
    }
    return ready
  }
}
