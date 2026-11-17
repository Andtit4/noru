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
    if (place.kind === 'pen' && s.pens && s.pens[place.id]) pens[place.id] = { readyAt: num(s.pens[place.id].readyAt) }
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
    for (const id of Object.keys(s.pens)) pens[id] = { readyAt: round(s.pens[id].readyAt) }
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
    const product = PENS[place.animal!].product
    return { item: product.item, count: product.count + this.s.upgrades.pens - 1 }
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
    this.s.pens[place.id] = { readyAt: this.clock + pen.time }
    return 'ok'
  }

  collectPen(place: Place) {
    if (this.penStatus(place) !== 'ready') return null
    const product = this.penProduct(place)
    if (this.space() < product.count) return 'full' as const
    this.add(product.item, product.count)
    this.s.pens[place.id] = { readyAt: 0 }
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
