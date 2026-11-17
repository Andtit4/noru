// Cloud Acres: items, crops, animals, workshops, levels and the map of the farm.

export type ItemId =
  | 'wheat'
  | 'carrot'
  | 'corn'
  | 'tomato'
  | 'pumpkin'
  | 'egg'
  | 'milk'
  | 'truffle'
  | 'wool'
  | 'flour'
  | 'cheese'
  | 'sweater'
  | 'cake'

export interface Item {
  id: ItemId
  /** Coins when sold at the market. */
  price: number
  /** Level at which it can be asked in orders. */
  level: number
}

export const ITEMS: Record<ItemId, Item> = {
  wheat: { id: 'wheat', price: 3, level: 1 },
  carrot: { id: 'carrot', price: 4, level: 1 },
  corn: { id: 'corn', price: 7, level: 3 },
  tomato: { id: 'tomato', price: 9, level: 5 },
  pumpkin: { id: 'pumpkin', price: 16, level: 8 },
  egg: { id: 'egg', price: 8, level: 2 },
  milk: { id: 'milk', price: 15, level: 4 },
  truffle: { id: 'truffle', price: 38, level: 5 },
  wool: { id: 'wool', price: 18, level: 6 },
  flour: { id: 'flour', price: 16, level: 3 },
  cheese: { id: 'cheese', price: 42, level: 4 },
  sweater: { id: 'sweater', price: 55, level: 6 },
  cake: { id: 'cake', price: 50, level: 7 },
}

export type CropId = 'wheat' | 'carrot' | 'corn' | 'tomato' | 'pumpkin'

export interface Crop {
  id: CropId
  cost: number
  /** Seconds from seed to ripe. */
  grow: number
  level: number
  color: string
}

export const CROPS: Crop[] = [
  { id: 'wheat', cost: 1, grow: 12, level: 1, color: '#f2c14e' },
  { id: 'carrot', cost: 2, grow: 18, level: 1, color: '#ff8a2b' },
  { id: 'corn', cost: 3, grow: 30, level: 3, color: '#ffd93d' },
  { id: 'tomato', cost: 4, grow: 42, level: 5, color: '#ff4d4d' },
  { id: 'pumpkin', cost: 6, grow: 60, level: 8, color: '#ff9f1c' },
]

export const cropById = (id: CropId) => CROPS.find((c) => c.id === id) as Crop

export type AnimalKind = 'chicken' | 'cow' | 'pig' | 'sheep'

/** A pen: its animals eat `feed` and give `product`. */
export interface PenType {
  kind: AnimalKind
  animals: number
  feed: { item: ItemId; count: number }
  product: { item: ItemId; count: number }
  time: number
}

export const PENS: Record<AnimalKind, PenType> = {
  chicken: { kind: 'chicken', animals: 4, feed: { item: 'wheat', count: 2 }, product: { item: 'egg', count: 3 }, time: 30 },
  cow: { kind: 'cow', animals: 2, feed: { item: 'corn', count: 2 }, product: { item: 'milk', count: 2 }, time: 60 },
  pig: { kind: 'pig', animals: 2, feed: { item: 'tomato', count: 2 }, product: { item: 'truffle', count: 1 }, time: 75 },
  sheep: { kind: 'sheep', animals: 3, feed: { item: 'carrot', count: 3 }, product: { item: 'wool', count: 2 }, time: 70 },
}

export type WorkshopKind = 'mill' | 'dairy' | 'loom' | 'bakery'

export interface WorkshopType {
  kind: WorkshopKind
  inputs: { item: ItemId; count: number }[]
  output: ItemId
  time: number
}

export const WORKSHOPS: Record<WorkshopKind, WorkshopType> = {
  mill: { kind: 'mill', inputs: [{ item: 'wheat', count: 3 }], output: 'flour', time: 25 },
  dairy: { kind: 'dairy', inputs: [{ item: 'milk', count: 2 }], output: 'cheese', time: 40 },
  loom: { kind: 'loom', inputs: [{ item: 'wool', count: 2 }], output: 'sweater', time: 50 },
  bakery: { kind: 'bakery', inputs: [{ item: 'flour', count: 1 }, { item: 'egg', count: 2 }], output: 'cake', time: 45 },
}

/** Up to this many productions waiting in a workshop. */
export const WORKSHOP_QUEUE = 3

/** Total XP needed for each level (index = level - 1). */
export const LEVELS = [0, 12, 35, 70, 120, 190, 280, 400, 560, 760, 1000, 1300, 1700, 2200, 2800]

export type PlaceKind = 'barn' | 'board' | 'field' | 'pen' | 'workshop'

/** Something on the map. Positions and sizes are in tiles. */
export interface Place {
  id: string
  kind: PlaceKind
  x: number
  y: number
  w: number
  h: number
  /** Level and coins to unlock it (0 / 0: there from the start). */
  level: number
  price: number
  animal?: AnimalKind
  workshop?: WorkshopKind
  /** Land plot to buy first. */
  zone?: string
}

/** Land plots east of the farm, covered with forest until bought. */
export interface Zone {
  id: string
  x: number
  y: number
  w: number
  h: number
  level: number
  price: number
}

export const ZONES: Zone[] = [
  { id: 'north', x: 24, y: 0, w: 8, h: 7, level: 5, price: 600 },
  { id: 'south', x: 24, y: 7, w: 8, h: 8, level: 8, price: 1200 },
]

export const TILE = 64
export const WORLD_W = 32
export const WORLD_H = 15

export const PLACES: Place[] = [
  { id: 'barn', kind: 'barn', x: 2, y: 1, w: 3, h: 3, level: 0, price: 0 },
  { id: 'board', kind: 'board', x: 6, y: 2, w: 2, h: 2, level: 0, price: 0 },
  { id: 'field1', kind: 'field', x: 2, y: 6, w: 3, h: 2, level: 0, price: 0 },
  { id: 'field2', kind: 'field', x: 6, y: 6, w: 3, h: 2, level: 2, price: 40 },
  { id: 'field3', kind: 'field', x: 2, y: 9, w: 3, h: 2, level: 3, price: 120 },
  { id: 'field4', kind: 'field', x: 6, y: 9, w: 3, h: 2, level: 5, price: 300 },
  { id: 'field5', kind: 'field', x: 2, y: 12, w: 3, h: 2, level: 7, price: 600 },
  { id: 'field6', kind: 'field', x: 6, y: 12, w: 3, h: 2, level: 9, price: 1000 },
  { id: 'chicken', kind: 'pen', x: 11, y: 1, w: 3, h: 3, level: 2, price: 50, animal: 'chicken' },
  { id: 'cow', kind: 'pen', x: 15, y: 1, w: 4, h: 3, level: 4, price: 220, animal: 'cow' },
  { id: 'pig', kind: 'pen', x: 11, y: 5, w: 3, h: 3, level: 5, price: 320, animal: 'pig' },
  { id: 'sheep', kind: 'pen', x: 15, y: 5, w: 4, h: 3, level: 6, price: 450, animal: 'sheep' },
  { id: 'mill', kind: 'workshop', x: 11, y: 10, w: 2, h: 2, level: 3, price: 100, workshop: 'mill' },
  { id: 'dairy', kind: 'workshop', x: 14, y: 10, w: 2, h: 2, level: 4, price: 260, workshop: 'dairy' },
  { id: 'loom', kind: 'workshop', x: 17, y: 10, w: 2, h: 2, level: 6, price: 480, workshop: 'loom' },
  { id: 'bakery', kind: 'workshop', x: 20, y: 10, w: 2, h: 2, level: 7, price: 650, workshop: 'bakery' },
  { id: 'field7', kind: 'field', x: 25, y: 2, w: 3, h: 2, level: 5, price: 350, zone: 'north' },
  { id: 'field8', kind: 'field', x: 28, y: 2, w: 3, h: 2, level: 6, price: 500, zone: 'north' },
  { id: 'field9', kind: 'field', x: 25, y: 10, w: 3, h: 2, level: 8, price: 700, zone: 'south' },
  { id: 'field10', kind: 'field', x: 28, y: 10, w: 3, h: 2, level: 9, price: 900, zone: 'south' },
]

export type MachineId = 'tractor' | 'truck'
export const MACHINES: Record<MachineId, { level: number; price: number }> = {
  truck: { level: 3, price: 300 },
  tractor: { level: 4, price: 450 },
}
/**
 * Workers to hire, each with a job: the field hand harvests ripe fields and replants them, the
 * stockman feeds the animals and collects their products, the craftsman collects the workshops'
 * goods and starts new productions. Hired for a while (each hire adds `WORKER.duration` seconds of
 * work, up to `WORKER.maxAhead`) or for good (`forever` coins).
 */
export type WorkerId = 'field' | 'animal' | 'craft'
export const WORKER_IDS: WorkerId[] = ['field', 'animal', 'craft']
export const WORKERS: Record<WorkerId, { level: number; price: number; forever: number }> = {
  field: { level: 3, price: 120, forever: 2500 },
  animal: { level: 4, price: 150, forever: 3200 },
  craft: { level: 5, price: 180, forever: 4000 },
}
export const WORKER = { duration: 600, maxAhead: 3600, actionTime: 2 }

/**
 * Upgrades of the farm, levels 1 to 3: fertile fields (each plot gives one more crop per level),
 * comfortable pens (one more product per level), modern workshops (25 % faster and one more place
 * in the queue per level). `levels` and `prices` are those of levels 2 and 3.
 */
export type UpgradeId = 'fields' | 'pens' | 'workshops'
export const UPGRADE_IDS: UpgradeId[] = ['fields', 'pens', 'workshops']
export const UPGRADES: Record<UpgradeId, { levels: number[]; prices: number[] }> = {
  fields: { levels: [4, 7], prices: [400, 1200] },
  pens: { levels: [4, 7], prices: [350, 1000] },
  workshops: { levels: [5, 8], prices: [450, 1300] },
}
export const MAX_UPGRADE = 3

/** Seconds of a delivery trip of the truck. */
export const TRUCK_TRIP = 14

/** Sprinklers: each level makes crops grow 30 % faster. */
export const SPRINKLER_PRICES = [180, 450]
export const SPRINKLER_LEVEL = 3
/** Silos: the barn holds BARN_BASE items, plus SILO_SIZE per silo level. */
export const SILO_PRICES = [120, 350, 800]
export const SILO_LEVEL = 2
export const BARN_BASE = 50
export const SILO_SIZE = 50

export type DecorKind = 'flowers' | 'haystack' | 'bench' | 'lamp' | 'scarecrow' | 'fountain'
export const DECORS: Record<DecorKind, { level: number; price: number }> = {
  flowers: { level: 1, price: 20 },
  haystack: { level: 1, price: 30 },
  bench: { level: 2, price: 45 },
  lamp: { level: 3, price: 60 },
  scarecrow: { level: 3, price: 80 },
  fountain: { level: 5, price: 250 },
}

/** The farmer's look. */
export interface Avatar {
  skin: number
  hat: number
  shirt: number
  pants: number
}
export const SKINS = ['#f6d5bd', '#e8b48e', '#c88a5f', '#9a6440', '#6b4129']
export const SHIRTS = ['#e8574a', '#4f8ff7', '#7bc950', '#ffb627', '#9b6bd1', '#f4f1ea']
export const PANTS = ['#3d6fb6', '#5c4a3d', '#2f3a4a', '#7b8f3a']
export const HATS = ['straw', 'cap', 'bandana', 'none'] as const

/** Trees and the pond (decoration). */
export const TREES: [number, number, number][] = [
  [0.7, 5.2, 0.9], [0.5, 9.6, 1.1], [0.8, 13.6, 1], [9.6, 0.7, 0.9], [9.8, 4.6, 1],
  [9.6, 8.6, 0.8], [9.7, 12.8, 1.1], [13.4, 13.6, 0.9], [19.8, 0.7, 1], [22.8, 2.2, 1.1], [23.1, 6.4, 0.9],
  [23.1, 13.5, 1], [19.6, 13.8, 0.85], [16.5, 13.7, 1], [10.4, 14.2, 0.8], [5.2, 14.3, 0.9], [23.2, 9.2, 1],
]
export const POND = { x: 20.2, y: 4.4, w: 2.6, h: 2.6 }

export interface PlotState {
  crop: CropId | null
  /** Game clock (seconds) when it is ripe. */
  readyAt: number
}

export interface PenState {
  /** 0: hungry; else game clock when the products are ready. */
  readyAt: number
}

export interface WorkshopState {
  /** Game clock at which each queued production is done (sorted). */
  queue: number[]
}

/** What is saved (noru play save). */
export interface Save {
  version: 3
  clock: number
  savedAt: number // Date.now() at save time: time away keeps the farm working
  coins: number
  xp: number
  barn: Partial<Record<ItemId, number>>
  owned: string[] // ids of unlocked places
  plots: Record<string, PlotState[]>
  pens: Record<string, PenState>
  workshops: Record<string, WorkshopState>
  orders: OrderState[]
  orderSeed: number
  avatar: Avatar
  machines: Record<MachineId, boolean>
  sprinkler: number
  silo: number
  decor: { kind: DecorKind; x: number; y: number }[]
  /** Delivery truck on the road (returnAt 0: at the farm). */
  truck: { returnAt: number; coins: number; xp: number }
  /** Workers: work until this game clock, or for good. */
  workers: Record<WorkerId, { until: number; forever: boolean }>
  /** Level (1-3) of each upgrade. */
  upgrades: Record<UpgradeId, number>
  /** Purchases (coins bought on the website) already given, so none is given twice. */
  credited: string[]
  /** Nickname shown to the other players ('' until chosen). */
  name: string
  /** Visible to the other players, who can invite you (and you them). */
  online: boolean
}

/** A random id, made of letters and digits (the room of a farm during a session). */
export function randomFarmId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

/** Longest nickname. */
export const NAME_MAX = 18

/** The save of version 2 (one farmhand), loaded and turned into a version 3. */
export interface SaveV2 extends Omit<Save, 'version' | 'workers' | 'upgrades' | 'credited' | 'name' | 'online'> {
  version: 2
  helper?: { hiredUntil: number }
}

export interface OrderState {
  villager: number
  items: { item: ItemId; count: number }[]
  coins: number
  xp: number
  /** Game clock at which a new order arrives in this slot (0: the order is there). */
  nextAt: number
}

export const NEW_SAVE = (): Save => ({
  version: 3,
  clock: 0,
  savedAt: Date.now(),
  coins: 20,
  xp: 0,
  barn: { wheat: 4 },
  owned: ['barn', 'board', 'field1'],
  plots: {},
  pens: {},
  workshops: {},
  orders: [],
  orderSeed: 1,
  avatar: { skin: 1, hat: 0, shirt: 0, pants: 0 },
  machines: { tractor: false, truck: false },
  sprinkler: 0,
  silo: 0,
  decor: [],
  truck: { returnAt: 0, coins: 0, xp: 0 },
  workers: { field: { until: 0, forever: false }, animal: { until: 0, forever: false }, craft: { until: 0, forever: false } },
  upgrades: { fields: 1, pens: 1, workshops: 1 },
  credited: [],
  name: '',
  online: true,
})

/** Time away that counts (the farm works up to 12 hours without the player). */
export const MAX_AWAY = 12 * 3600
