// Cloud Acres: the rules of the farm, independent of the display. Every timer is a moment of the
// game clock (seconds), so the farm keeps working while the game is closed: on load, the clock
// moves forward by the time spent away.

import {
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
export type FarmEvent = { type: 'truck-out' } | { type: 'truck-back'; coins: number }

export class Farm {
  s: Save
  /** Seconds the farm worked while the game was closed (shown once). */
  away = 0
  onLevelUp: (level: number) => void = () => {}
  /** Things that happened by themselves (the truck), for the display. */
  events: FarmEvent[] = []

  constructor(saved: Save | null) {
    this.s = saved && saved.version === 2 ? { ...NEW_SAVE(), ...saved } : NEW_SAVE()
    if (saved && saved.version === 2) {
      this.away = Math.min(Math.max((Date.now() - saved.savedAt) / 1000, 0), MAX_AWAY)
      this.s.clock += this.away
    }
    this.ensureOrders()
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
    this.add(crop, 1)
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
    const pen = PENS[place.animal!]
    if (this.space() < pen.product.count) return 'full' as const
    this.add(pen.product.item, pen.product.count)
    this.s.pens[place.id] = { readyAt: 0 }
    this.addXp(2 * pen.product.count)
    return pen.product
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
    const time = WORKSHOPS[place.workshop!].time
    return Math.min(1, 1 - (pending[0] - this.clock) / time)
  }

  startWorkshop(place: Place): 'ok' | 'full' | Missing {
    const type = WORKSHOPS[place.workshop!]
    const queue = this.queue(place)
    if (queue.length >= WORKSHOP_QUEUE) return 'full'
    const missing = this.missing(type.inputs)
    if (missing.length) return missing
    this.take(type.inputs)
    const start = Math.max(this.clock, queue.length ? queue[queue.length - 1] : 0)
    queue.push(start + type.time)
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
