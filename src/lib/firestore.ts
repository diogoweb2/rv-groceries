import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDocs,
  getDoc,
  collectionGroup,
  increment,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  Trip, Checklist, ChecklistItem, Amenity, Store, CatalogItem,
  GroceryList, GroceryItem, UserIdentity, OrderingPrefs, ChecklistPhase,
  PersistentItem, TripStatus, PinnedChecklist, Template,
  SupermarketList, SupermarketItem, SupermarketStore, SupermarketSortMemory,
  AppNotification
} from '@/types'

export const DEFAULT_PHASE_ORDER: ChecklistPhase[] = ['pre_early', 'pre_dayof', 'pack_down', 'grocery']

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDate(ts: unknown): string {
  if (ts instanceof Timestamp) return ts.toDate().toISOString()
  if (typeof ts === 'string') return ts
  return new Date().toISOString()
}

function docData<T>(snap: { id: string; data: () => Record<string, unknown> }): T {
  const d = snap.data()
  return { id: snap.id, ...d } as T
}

// Firestore rejects any field whose value is `undefined`. Strip them so callers
// can pass optional fields (e.g. storeId, catalogItemId) without crashing.
function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
}

// ── Ordering preferences ────────────────────────────────────────────────────────
// Global, remembered ordering of phase sections and of checklist names within a
// phase. New trips inherit this so the layout stays consistent trip to trip.

const ORDERING_DOC = doc(db, 'appSettings', 'ordering')

export function subscribeOrdering(cb: (o: OrderingPrefs) => void) {
  return onSnapshot(ORDERING_DOC, (snap) => {
    const d = snap.data()
    cb({
      phaseOrder: (d?.phaseOrder as ChecklistPhase[]) ?? DEFAULT_PHASE_ORDER,
      checklistOrder: (d?.checklistOrder as Record<string, string[]>) ?? {},
    })
  })
}

export async function savePhaseOrder(phaseOrder: ChecklistPhase[]) {
  await setDoc(ORDERING_DOC, { phaseOrder }, { merge: true })
}

// Remember the order of checklist names within a phase (merges, leaving other
// phases untouched).
export async function saveChecklistOrder(phase: ChecklistPhase, names: string[]) {
  await setDoc(ORDERING_DOC, { checklistOrder: { [phase]: names } }, { merge: true })
}

// ── Amenities ─────────────────────────────────────────────────────────────────

export function subscribeAmenities(cb: (items: Amenity[]) => void) {
  return onSnapshot(query(collection(db, 'amenities'), orderBy('name')), (snap) =>
    cb(snap.docs.map((d) => docData<Amenity>(d)))
  )
}

export async function addAmenity(data: Omit<Amenity, 'id'>) {
  return addDoc(collection(db, 'amenities'), data)
}

export async function updateAmenity(id: string, data: Partial<Amenity>) {
  return updateDoc(doc(db, 'amenities', id), data)
}

export async function deleteAmenity(id: string) {
  return deleteDoc(doc(db, 'amenities', id))
}

// ── Stores ────────────────────────────────────────────────────────────────────

export function subscribeStores(cb: (items: Store[]) => void) {
  return onSnapshot(query(collection(db, 'stores'), orderBy('name')), (snap) =>
    cb(snap.docs.map((d) => docData<Store>(d)))
  )
}

export async function addStore(data: Omit<Store, 'id'>) {
  return addDoc(collection(db, 'stores'), data)
}

export async function updateStore(id: string, data: Partial<Store>) {
  return updateDoc(doc(db, 'stores', id), data)
}

export async function deleteStore(id: string) {
  return deleteDoc(doc(db, 'stores', id))
}

// ── Item Catalog ──────────────────────────────────────────────────────────────

export function subscribeCatalog(cb: (items: CatalogItem[]) => void) {
  return onSnapshot(query(collection(db, 'itemCatalog'), orderBy('name')), (snap) =>
    cb(snap.docs.map((d) => docData<CatalogItem>(d)))
  )
}

export async function addCatalogItem(data: Omit<CatalogItem, 'id'>) {
  return addDoc(collection(db, 'itemCatalog'), data)
}

export async function updateCatalogItem(id: string, data: Partial<CatalogItem>) {
  return updateDoc(doc(db, 'itemCatalog', id), data)
}

export async function deleteCatalogItem(id: string) {
  return deleteDoc(doc(db, 'itemCatalog', id))
}

// Make sure a typed item name exists in the global catalog so it becomes an
// autocomplete suggestion everywhere. No-op if a matching name already exists.
// `catalog` is the already-loaded list, so this avoids an extra read.
export async function ensureCatalogItem(
  catalog: CatalogItem[],
  name: string,
  category: CatalogItem['category'],
  defaultStoreId?: string,
) {
  const trimmed = name.trim()
  if (!trimmed) return
  if (catalog.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return
  await addDoc(collection(db, 'itemCatalog'), clean({
    name: trimmed,
    category,
    defaultStoreId,
    stats: { totalUsed: 0, totalGrocery: 0, byAmenity: {}, lastGrocerySortIndex: {} },
  }))
}

// Merge duplicate-name catalog entries, keeping the most-used one and deleting
// the rest. Returns how many duplicates were removed.
export async function dedupeCatalog(): Promise<number> {
  const snap = await getDocs(collection(db, 'itemCatalog'))
  const groups = new Map<string, (typeof snap.docs)[number][]>()
  snap.docs.forEach((d) => {
    const key = ((d.data().name as string) ?? '').trim().toLowerCase()
    if (!key) return
    const arr = groups.get(key) ?? []
    arr.push(d)
    groups.set(key, arr)
  })

  const batch = writeBatch(db)
  let removed = 0
  groups.forEach((docs) => {
    if (docs.length < 2) return
    docs.sort(
      (a, b) =>
        ((b.data().stats?.totalUsed as number) ?? 0) -
        ((a.data().stats?.totalUsed as number) ?? 0)
    )
    docs.slice(1).forEach((d) => { batch.delete(d.ref); removed++ })
  })

  if (removed > 0) await batch.commit()
  return removed
}

// One-time seed: register every item name already used across all trip
// checklists and grocery lists into the global catalog, so older items also
// become autocomplete suggestions. Idempotent — only adds missing names.
export async function backfillCatalogFromItems(): Promise<number> {
  const [catalogSnap, itemsSnap] = await Promise.all([
    getDocs(collection(db, 'itemCatalog')),
    getDocs(collectionGroup(db, 'items')),
  ])

  const known = new Set(
    catalogSnap.docs.map((d) => ((d.data().name as string) ?? '').trim().toLowerCase())
  )
  const toAdd = new Map<string, { name: string; category: CatalogItem['category'] }>()

  itemsSnap.forEach((d) => {
    const name = ((d.data().name as string) ?? '').trim()
    if (!name) return
    const key = name.toLowerCase()
    if (known.has(key) || toAdd.has(key)) return
    const isGrocery = d.ref.path.startsWith('groceryLists/')
    toAdd.set(key, { name, category: isGrocery ? 'grocery' : 'camping' })
  })

  if (toAdd.size === 0) return 0
  const batch = writeBatch(db)
  toAdd.forEach((v) => {
    batch.set(doc(collection(db, 'itemCatalog')), {
      name: v.name,
      category: v.category,
      stats: { totalUsed: 0, totalGrocery: 0, byAmenity: {}, lastGrocerySortIndex: {} },
    })
  })
  await batch.commit()
  return toAdd.size
}

// ── Pinned Checklists ─────────────────────────────────────────────────────────
// A globally-stored snapshot of each pinned checklist, seeded into new trips.
// Keyed deterministically by phase + name.

function pinnedChecklistKey(name: string, phase: ChecklistPhase): string {
  return `${phase}__${name.trim().toLowerCase()}`.replace(/[/.#$[\]]/g, '_')
}

export function subscribePinnedChecklists(cb: (items: PinnedChecklist[]) => void) {
  return onSnapshot(collection(db, 'pinnedChecklists'), (snap) =>
    cb(snap.docs.map((d) => docData<PinnedChecklist>(d)))
  )
}

export async function savePinnedChecklist(
  name: string,
  phase: ChecklistPhase,
  items: ChecklistItem[],
  identity: UserIdentity,
) {
  const key = pinnedChecklistKey(name, phase)
  await setDoc(doc(db, 'pinnedChecklists', key), {
    name: name.trim(),
    phase,
    items: items.map(i => clean({ name: i.name, catalogItemId: i.catalogItemId || undefined, qty: i.qty || undefined })),
    updatedAt: new Date().toISOString(),
    updatedBy: identity,
  })
}

export async function removePinnedChecklist(phase: ChecklistPhase, name: string) {
  await deleteDoc(doc(db, 'pinnedChecklists', pinnedChecklistKey(name, phase)))
}

// ── Trips ─────────────────────────────────────────────────────────────────────

export function subscribeTrips(cb: (trips: Trip[]) => void) {
  return onSnapshot(
    query(collection(db, 'trips'), orderBy('startDate', 'asc')),
    (snap) => cb(snap.docs.map((d) => docData<Trip>(d)))
  )
}

export async function addTrip(data: Omit<Trip, 'id'>) {
  return addDoc(collection(db, 'trips'), { ...data, createdAt: serverTimestamp() })
}

export async function updateTrip(id: string, data: Partial<Trip>) {
  return updateDoc(doc(db, 'trips', id), data)
}

export async function deleteTrip(id: string) {
  // Remove nested checklists and their items, then the trip itself.
  const batch = writeBatch(db)
  const checklistsSnap = await getDocs(collection(db, 'trips', id, 'checklists'))
  for (const cl of checklistsSnap.docs) {
    const itemsSnap = await getDocs(collection(db, 'trips', id, 'checklists', cl.id, 'items'))
    itemsSnap.forEach((item) => batch.delete(item.ref))
    batch.delete(cl.ref)
  }
  batch.delete(doc(db, 'trips', id))
  await batch.commit()
}

// ── Trip status automation ─────────────────────────────────────────────────────
// Trips advance through statuses automatically by date: a trip becomes `active`
// the day before its start date and `completed` the day after its end date (a
// one-day buffer on each side). `cancelled` is sticky and never auto-changed.
// All date math is done in UTC to match the `YYYY-MM-DD` comparisons used elsewhere.

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The status a trip should have for a given day, based purely on its dates.
export function deriveTripStatus(
  trip: Trip,
  today = new Date().toISOString().slice(0, 10),
): TripStatus {
  if (trip.status === 'cancelled') return 'cancelled'
  if (today >= addDays(trip.endDate, 1)) return 'completed'
  if (today >= addDays(trip.startDate, -1)) return 'active'
  return 'planned'
}

// Forward-only progression rank; auto-sync never moves a trip backward.
const STATUS_RANK: Record<TripStatus, number> = { planned: 0, active: 1, completed: 2, cancelled: 0 }

// Mark a trip completed, recording its usage stats exactly once (the
// `statsRecorded` guard makes repeated/auto completion safe — see §7).
export async function completeTrip(trip: Trip, identity: UserIdentity) {
  if (!trip.statsRecorded) {
    await recordTripStats(trip.id, trip.amenities, identity)
    await updateTrip(trip.id, { status: 'completed', statsRecorded: true })
  } else {
    await updateTrip(trip.id, { status: 'completed' })
  }
}

// Advance any trips whose date-derived status is further along than their stored
// one (planned → active → completed). Never moves backward and never touches
// `cancelled`. Idempotent — safe to call on every load. Returns nothing.
export async function syncTripStatuses(trips: Trip[], identity: UserIdentity) {
  const today = new Date().toISOString().slice(0, 10)
  for (const trip of trips) {
    if (trip.status === 'cancelled') continue
    const next = deriveTripStatus(trip, today)
    if (next === trip.status || STATUS_RANK[next] <= STATUS_RANK[trip.status]) continue
    if (next === 'completed') await completeTrip(trip, identity)
    else await updateTrip(trip.id, { status: next })
  }
}

// ── Checklists ────────────────────────────────────────────────────────────────

export function subscribeChecklists(tripId: string, cb: (lists: Checklist[]) => void) {
  return onSnapshot(
    query(collection(db, 'trips', tripId, 'checklists'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => docData<Checklist>(d)))
  )
}

export async function addChecklist(tripId: string, data: Omit<Checklist, 'id' | 'tripId'>) {
  return addDoc(collection(db, 'trips', tripId, 'checklists'), { ...data, tripId })
}

// Persist the within-phase position of each checklist after a drag reorder.
export async function saveChecklistPositions(tripId: string, ordered: { id: string }[]) {
  const batch = writeBatch(db)
  ordered.forEach((c, idx) =>
    batch.update(doc(db, 'trips', tripId, 'checklists', c.id), { order: idx })
  )
  await batch.commit()
}

// Copy an item into another checklist of the same trip, unless an item with the
// same name is already there. Used to send bought groceries to the "bring to RV"
// list automatically.
export async function copyItemToChecklist(
  tripId: string,
  targetChecklistId: string,
  item: { name: string; catalogItemId?: string; qty?: string },
  identity: UserIdentity,
) {
  const col = collection(db, 'trips', tripId, 'checklists', targetChecklistId, 'items')
  const snap = await getDocs(col)
  const exists = snap.docs.some(
    (d) => ((d.data().name as string) ?? '').toLowerCase() === item.name.toLowerCase()
  )
  if (exists) return
  await addDoc(col, clean({
    tripId,
    checklistId: targetChecklistId,
    catalogItemId: item.catalogItemId || undefined,
    name: item.name,
    qty: item.qty ?? '',
    checked: false,
    order: snap.size,
    rev: 1,
    baseRev: 0,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
  }))
}

export async function updateChecklist(tripId: string, checklistId: string, data: Partial<Checklist>) {
  return updateDoc(doc(db, 'trips', tripId, 'checklists', checklistId), clean(data))
}

export async function deleteChecklist(tripId: string, checklistId: string) {
  // Clear the items subcollection before removing the checklist document.
  const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', checklistId, 'items'))
  const batch = writeBatch(db)
  itemsSnap.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(db, 'trips', tripId, 'checklists', checklistId))
  await batch.commit()
}

// ── Checklist Items ────────────────────────────────────────────────────────────

export function subscribeItems(tripId: string, checklistId: string, cb: (items: ChecklistItem[]) => void) {
  return onSnapshot(
    query(
      collection(db, 'trips', tripId, 'checklists', checklistId, 'items'),
      orderBy('order')
    ),
    (snap) => cb(snap.docs.map((d) => docData<ChecklistItem>(d)))
  )
}

export async function addItem(
  tripId: string,
  checklistId: string,
  data: Omit<ChecklistItem, 'id' | 'tripId' | 'checklistId'>,
  identity: UserIdentity
) {
  return addDoc(collection(db, 'trips', tripId, 'checklists', checklistId, 'items'), clean({
    ...data,
    tripId,
    checklistId,
    rev: 1,
    baseRev: 0,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
  }))
}

export async function toggleItem(
  tripId: string,
  checklistId: string,
  itemId: string,
  checked: boolean,
  identity: UserIdentity,
  currentRev: number
) {
  return updateDoc(doc(db, 'trips', tripId, 'checklists', checklistId, 'items', itemId), {
    checked,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: currentRev,
    rev: currentRev + 1,
  })
}

export async function updateItem(
  tripId: string,
  checklistId: string,
  itemId: string,
  data: Partial<ChecklistItem>,
  identity: UserIdentity,
  currentRev: number
) {
  return updateDoc(doc(db, 'trips', tripId, 'checklists', checklistId, 'items', itemId), clean({
    ...data,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: currentRev,
    rev: currentRev + 1,
  }))
}

export async function deleteItem(tripId: string, checklistId: string, itemId: string) {
  return deleteDoc(doc(db, 'trips', tripId, 'checklists', checklistId, 'items', itemId))
}

// ── Persistent (recurring) items ──────────────────────────────────────────────
// A global set of items that should re-appear in future trips until checked.
// Keyed deterministically by phase + checklist name + item name so the same
// logical item is never duplicated across trips.

function persistKey(phase: ChecklistPhase, checklistName: string, name: string): string {
  return `${phase}__${checklistName.trim().toLowerCase()}__${name.trim().toLowerCase()}`
    .replace(/[/.#$[\]]/g, '_')
}

// Mark an item as recurring (idempotent upsert). No-op-safe to call repeatedly.
export async function addPersistentItem(
  rec: Omit<PersistentItem, 'id'>,
  identity: UserIdentity,
) {
  const key = persistKey(rec.phase, rec.checklistName, rec.name)
  await setDoc(doc(db, 'persistentItems', key), clean({
    name: rec.name.trim(),
    phase: rec.phase,
    checklistName: rec.checklistName.trim(),
    catalogItemId: rec.catalogItemId || undefined,
    qty: rec.qty || undefined,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
  }))
}

// Stop an item from recurring (idempotent delete).
export async function removePersistentItem(
  phase: ChecklistPhase,
  checklistName: string,
  name: string,
) {
  await deleteDoc(doc(db, 'persistentItems', persistKey(phase, checklistName, name)))
}

// Toggle an item's persist flag and keep the global recurring set in sync.
// An item only recurs while it is both persistent and unchecked.
export async function setItemPersist(
  tripId: string,
  checklist: Checklist,
  item: ChecklistItem,
  persist: boolean,
  identity: UserIdentity,
) {
  await updateItem(tripId, checklist.id, item.id, { persist }, identity, item.rev)
  if (persist && !item.checked) {
    await addPersistentItem(
      { name: item.name, phase: checklist.phase, checklistName: checklist.name, catalogItemId: item.catalogItemId, qty: item.qty },
      identity,
    )
  } else if (!persist) {
    await removePersistentItem(checklist.phase, checklist.name, item.name)
  }
}

// ── Create trip from pinned checklists ─────────────────────────────────────────

export async function createTripWithChecklists(
  tripData: Omit<Trip, 'id'>,
  pinnedChecklists: PinnedChecklist[],
  identity: UserIdentity,
  ordering?: OrderingPrefs
): Promise<string> {
  const tripRef = await addDoc(collection(db, 'trips'), {
    ...tripData,
    createdAt: serverTimestamp(),
  })
  const tripId = tripRef.id

  const phaseOrder = ordering?.phaseOrder ?? DEFAULT_PHASE_ORDER
  const checklistOrder = ordering?.checklistOrder ?? {}

  // Sort pinned checklists by the remembered phase + name order.
  const planned: { pinned: PinnedChecklist; order: number }[] = []
  for (const phase of phaseOrder) {
    const nameOrder = checklistOrder[phase] ?? []
    const rank = (name: string) => {
      const i = nameOrder.indexOf(name)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    pinnedChecklists
      .filter(p => p.phase === phase)
      .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
      .forEach((pinned, idx) => planned.push({ pinned, order: idx }))
  }

  const created: { id: string; name: string; phase: ChecklistPhase; itemCount: number }[] = []

  for (const { pinned, order } of planned) {
    const clRef = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
      tripId,
      name: pinned.name,
      phase: pinned.phase,
      order,
      pinned: true,
    })
    const clId = clRef.id

    const batch = writeBatch(db)
    pinned.items.forEach((item, idx) => {
      const itemRef = doc(collection(db, 'trips', tripId, 'checklists', clId, 'items'))
      batch.set(itemRef, clean({
        tripId,
        checklistId: clId,
        catalogItemId: item.catalogItemId || undefined,
        name: item.name,
        qty: item.qty ?? '',
        checked: false,
        order: idx,
        rev: 1,
        baseRev: 0,
        updatedBy: identity,
        updatedAt: new Date().toISOString(),
      }))
    })
    await batch.commit()
    created.push({ id: clId, name: pinned.name, phase: pinned.phase, itemCount: pinned.items.length })
  }

  await seedPersistentItems(tripId, created, identity)
  return tripId
}

// Seed a freshly-created trip with the globally-remembered recurring items,
// placing each into the checklist with a matching name+phase (creating it if
// none exists). Skips items whose name is already present in the target.
async function seedPersistentItems(
  tripId: string,
  created: { id: string; name: string; phase: ChecklistPhase; itemCount: number }[],
  identity: UserIdentity,
) {
  const persistSnap = await getDocs(collection(db, 'persistentItems'))
  if (persistSnap.empty) return

  for (const p of persistSnap.docs) {
    const rec = p.data() as Omit<PersistentItem, 'id'>
    let target = created.find(
      (c) => c.phase === rec.phase && c.name.toLowerCase() === rec.checklistName.trim().toLowerCase(),
    )
    if (!target) {
      const order = created.filter((c) => c.phase === rec.phase).length
      const clRef = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
        tripId,
        name: rec.checklistName,
        phase: rec.phase,
        order,
      })
      target = { id: clRef.id, name: rec.checklistName, phase: rec.phase, itemCount: 0 }
      created.push(target)
    }

    // Avoid duplicating an item that a template/suggestion already added.
    const itemsCol = collection(db, 'trips', tripId, 'checklists', target.id, 'items')
    const existing = await getDocs(itemsCol)
    if (existing.docs.some((d) => ((d.data().name as string) ?? '').toLowerCase() === rec.name.toLowerCase())) {
      continue
    }

    await addDoc(itemsCol, clean({
      tripId,
      checklistId: target.id,
      catalogItemId: rec.catalogItemId || undefined,
      name: rec.name,
      qty: rec.qty ?? '',
      checked: false,
      persist: true,
      order: existing.size,
      rev: 1,
      baseRev: 0,
      updatedBy: identity,
      updatedAt: new Date().toISOString(),
    }))
    target.itemCount = existing.size + 1
  }
}

// ── Grocery Lists ─────────────────────────────────────────────────────────────

export function subscribeGroceryLists(cb: (lists: GroceryList[]) => void) {
  return onSnapshot(
    query(collection(db, 'groceryLists'), orderBy('createdAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => docData<GroceryList>(d)))
  )
}

export async function addGroceryList(data: Omit<GroceryList, 'id'>) {
  return addDoc(collection(db, 'groceryLists'), { ...data, createdAt: serverTimestamp() })
}

export async function sendGroceryList(id: string) {
  return updateDoc(doc(db, 'groceryLists', id), {
    status: 'sent',
    sentAt: new Date().toISOString(),
  })
}

export async function deleteGroceryList(id: string) {
  // Deleting a document does not remove its subcollection, so clear items first.
  const itemsSnap = await getDocs(collection(db, 'groceryLists', id, 'items'))
  const batch = writeBatch(db)
  itemsSnap.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(db, 'groceryLists', id))
  await batch.commit()
}

export function subscribeGroceryItems(listId: string, cb: (items: GroceryItem[]) => void) {
  return onSnapshot(
    query(collection(db, 'groceryLists', listId, 'items'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => docData<GroceryItem>(d)))
  )
}

export async function addGroceryItem(
  listId: string,
  data: Omit<GroceryItem, 'id' | 'listId'>,
  identity: UserIdentity
) {
  return addDoc(collection(db, 'groceryLists', listId, 'items'), clean({
    ...data,
    listId,
    rev: 1,
    baseRev: 0,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
  }))
}

export async function updateGroceryItem(
  listId: string,
  itemId: string,
  data: Partial<GroceryItem>,
  identity: UserIdentity,
  currentRev: number
) {
  return updateDoc(doc(db, 'groceryLists', listId, 'items', itemId), clean({
    ...data,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: currentRev,
    rev: currentRev + 1,
  }))
}

export async function deleteGroceryItem(listId: string, itemId: string) {
  return deleteDoc(doc(db, 'groceryLists', listId, 'items', itemId))
}

// Update learned sort order for grocery items
export async function saveSortOrder(items: GroceryItem[], storeId: string | undefined) {
  const batch = writeBatch(db)
  items.forEach((item, idx) => {
    if (!item.catalogItemId) return
    const ref = doc(db, 'itemCatalog', item.catalogItemId)
    const key = `stats.lastGrocerySortIndex.${storeId ?? 'default'}`
    batch.update(ref, { [key]: idx })
  })
  await batch.commit()
}

export async function rateTrip(tripId: string, identity: UserIdentity, rating: number) {
  await updateDoc(doc(db, 'trips', tripId), { [`ratings.${identity}`]: rating })
}

export async function incrementRatingPrompt(tripId: string, identity: UserIdentity) {
  await updateDoc(doc(db, 'trips', tripId), { [`ratingPrompts.${identity}`]: increment(1) })
}

// Update stats when trip is completed
export async function recordTripStats(
  tripId: string,
  amenityIds: string[],
  _identity: UserIdentity
) {
  const checklistsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists'))
  const batch = writeBatch(db)

  for (const cl of checklistsSnap.docs) {
    const itemsSnap = await getDocs(
      collection(db, 'trips', tripId, 'checklists', cl.id, 'items')
    )
    for (const item of itemsSnap.docs) {
      const d = item.data()
      if (!d.catalogItemId || !d.checked) continue
      const catalogRef = doc(db, 'itemCatalog', d.catalogItemId as string)
      const catalogSnap = await getDoc(catalogRef)
      if (!catalogSnap.exists()) continue
      const stats = (catalogSnap.data().stats ?? { totalUsed: 0, byAmenity: {} }) as CatalogItem['stats']
      stats.totalUsed = (stats.totalUsed ?? 0) + 1
      for (const amenityId of amenityIds) {
        stats.byAmenity[amenityId] = (stats.byAmenity[amenityId] ?? 0) + 1
      }
      batch.update(catalogRef, { stats })
    }
  }

  await batch.commit()
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function subscribeTemplates(cb: (items: Template[]) => void) {
  return onSnapshot(query(collection(db, 'templates'), orderBy('name')), (snap) =>
    cb(snap.docs.map((d) => docData<Template>(d)))
  )
}

export async function addTemplate(data: Omit<Template, 'id'>) {
  return addDoc(collection(db, 'templates'), data)
}

export async function updateTemplate(id: string, data: Partial<Template>) {
  return updateDoc(doc(db, 'templates', id), data)
}

export async function deleteTemplate(id: string) {
  return deleteDoc(doc(db, 'templates', id))
}

// ── Supermarket lists ──────────────────────────────────────────────────────────
// A shopping list per supermarket (one active list per store, max three). Alice
// builds a list; Diogo shops and marks each item bought, then completes the list
// (which hides it and notifies the other person). See §15.

export const SUPERMARKET_STORES: { id: SupermarketStore; label: string }[] = [
  { id: 'nofrills_freshco', label: 'NoFrills / FreshCo' },
  { id: 'dollarama', label: 'Dollarama' },
  { id: 'costco', label: 'Costco' },
]

export function supermarketStoreLabel(store: SupermarketStore): string {
  return SUPERMARKET_STORES.find(s => s.id === store)?.label ?? store
}

// Recognise the "<name> -> camping" shorthand (also "→ camping", "->camping")
// used to flag an item as camping. Returns the cleaned name and the flag.
export function parseCampingFlag(raw: string): { name: string; forCamping: boolean } {
  const m = raw.match(/^(.*?)\s*(?:-+>|→)\s*camping\s*$/i)
  if (m && m[1].trim()) return { name: m[1].trim(), forCamping: true }
  return { name: raw.trim(), forCamping: false }
}

export function subscribeSupermarketLists(cb: (lists: SupermarketList[]) => void) {
  return onSnapshot(
    query(collection(db, 'supermarketLists'), orderBy('createdAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => docData<SupermarketList>(d)))
  )
}

export async function addSupermarketList(store: SupermarketStore, identity: UserIdentity) {
  return addDoc(collection(db, 'supermarketLists'), clean({
    store,
    status: 'active' as const,
    createdBy: identity,
    createdAt: serverTimestamp(),
  }))
}

export function subscribeSupermarketItems(listId: string, cb: (items: SupermarketItem[]) => void) {
  return onSnapshot(
    query(collection(db, 'supermarketLists', listId, 'items'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => docData<SupermarketItem>(d)))
  )
}

export async function addSupermarketItem(
  listId: string,
  data: Omit<SupermarketItem, 'id' | 'listId' | 'rev' | 'baseRev' | 'updatedBy' | 'updatedAt'>,
  identity: UserIdentity,
) {
  return addDoc(collection(db, 'supermarketLists', listId, 'items'), clean({
    ...data,
    listId,
    rev: 1,
    baseRev: 0,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
  }))
}

export async function updateSupermarketItem(
  listId: string,
  itemId: string,
  data: Partial<SupermarketItem>,
  identity: UserIdentity,
  currentRev: number,
) {
  return updateDoc(doc(db, 'supermarketLists', listId, 'items', itemId), clean({
    ...data,
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: currentRev,
    rev: currentRev + 1,
  }))
}

export async function deleteSupermarketItem(listId: string, itemId: string) {
  return deleteDoc(doc(db, 'supermarketLists', listId, 'items', itemId))
}

// Mark a list complete: hide it from the active view, record who/when, and notify
// the other person whether everything was bought or what was missed (§15).
export async function completeSupermarketList(
  list: SupermarketList,
  items: SupermarketItem[],
  identity: UserIdentity,
) {
  const storeLabel = supermarketStoreLabel(list.store)
  const missed = items.filter(i => !i.checked).map(i => i.name)
  const who = identity === 'diogo' ? 'Diogo' : 'Alice'
  const title = missed.length === 0 ? 'Shopping done 🎉' : 'Shopping update'
  const body = missed.length === 0
    ? `${who} bought everything on the ${storeLabel} list`
    : `${who} finished the ${storeLabel} list. Couldn't get: ${missed.join(', ')}`

  await updateDoc(doc(db, 'supermarketLists', list.id), {
    status: 'complete',
    completedAt: new Date().toISOString(),
    completedBy: identity,
  })

  // Notify only the other person (§15) — the shopper who completed doesn't get a
  // notification about their own action.
  const recipient: UserIdentity = identity === 'diogo' ? 'alice' : 'diogo'
  await sendNotification({ to: recipient, from: identity, title, body, type: 'supermarket' })
}

// Copy a bought camping item into the next trip's "Day of departure" (RV/truck)
// list, picking the active trip or the soonest upcoming one. No-op if there is no
// eligible trip or it has no `pre_dayof` checklist. Idempotent (skips duplicates).
export async function moveCampingItemToNextTrip(
  item: { name: string; catalogItemId?: string; qty?: string },
  trips: Trip[],
  identity: UserIdentity,
) {
  const today = new Date().toISOString().slice(0, 10)
  const target =
    trips.find(t => t.status === 'active') ??
    trips
      .filter(t => t.startDate >= today && t.status !== 'cancelled' && t.status !== 'completed')
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  if (!target) return

  const checklistsSnap = await getDocs(collection(db, 'trips', target.id, 'checklists'))
  const dayOf = checklistsSnap.docs
    .filter(d => (d.data().phase as ChecklistPhase) === 'pre_dayof')
    .sort((a, b) => ((a.data().order as number) ?? 0) - ((b.data().order as number) ?? 0))[0]
  if (!dayOf) return

  await copyItemToChecklist(target.id, dayOf.id, item, identity)
}

// ── Supermarket auto-sort (learned ordering) ─────────────────────────────────
// A per-store, word-based memory of how the user likes their shopping list
// ordered. Each manual sort teaches the model; new lists auto-sort by it. See
// §16. The signal is word-based so "Yogurt vanilla" and "Yogurt banana" share
// the word "yogurt" and are grouped together; the most recent sort weighs most
// via an exponential moving average that also sharpens the model over time.

const SUPERMARKET_SORT_DOC = doc(db, 'appSettings', 'supermarketSort')

// EMA weight given to the newest sort. 0.5 = the latest sort counts as much as
// all prior history combined, so ordering adapts quickly yet keeps learning.
const SORT_LEARN_RATE = 0.5

export function subscribeSupermarketSort(cb: (m: SupermarketSortMemory) => void) {
  return onSnapshot(SUPERMARKET_SORT_DOC, (snap) => {
    const d = snap.data()
    cb({ stores: (d?.stores as SupermarketSortMemory['stores']) ?? {} })
  })
}

// Split an item name into lowercased word tokens (accents kept, pure numbers and
// single characters dropped). Word overlap is what makes two differently-named
// items count as "the same kind" for sorting — one shared word is enough.
export function tokenizeItemName(name: string): string[] {
  return Array.from(
    new Set(
      name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 2 && !/^\d+$/.test(w)),
    ),
  )
}

// The learned position of a name = the mean learned position of its known words.
// Returns null when none of its words has any history yet (an unknown item).
function scoreName(name: string, words: Record<string, number>): number | null {
  const known = tokenizeItemName(name)
    .map((t) => words[t])
    .filter((v): v is number => typeof v === 'number')
  if (known.length === 0) return null
  return known.reduce((a, b) => a + b, 0) / known.length
}

// Return the items in the learned display order: unchecked items sorted by their
// learned score (unknown items sink to the bottom of the unchecked group, in
// their current relative order); checked ("bought") items always stay at the
// very bottom in their current relative order (§15 bought-to-end + §16).
export function sortedByMemory<T extends { name: string; checked: boolean }>(
  items: T[],
  memory: SupermarketSortMemory,
  store: SupermarketStore,
): T[] {
  const words = memory.stores[store] ?? {}
  const checked = items.filter((i) => i.checked)
  const unchecked = items
    .filter((i) => !i.checked)
    .map((it, idx) => ({ it, idx, score: scoreName(it.name, words) }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.idx - b.idx
      if (a.score === null) return 1
      if (b.score === null) return -1
      if (a.score !== b.score) return a.score - b.score
      return a.idx - b.idx
    })
  return [...unchecked.map((u) => u.it), ...checked]
}

// Learn from a deliberately-ordered list: nudge every word of each item toward
// that item's normalized position (0 = top … 1 = bottom) via an EMA, so recent
// sorts dominate and the model keeps sharpening (§16). Pass only the items that
// were actually sorted (exclude bought items, which the bought-to-end rule sank
// on their own). No-op below two items — a single item carries no order signal.
export async function learnSupermarketOrder(
  store: SupermarketStore,
  orderedNames: string[],
  memory: SupermarketSortMemory,
) {
  if (orderedNames.length < 2) return
  const words: Record<string, number> = { ...(memory.stores[store] ?? {}) }
  const n = orderedNames.length
  orderedNames.forEach((name, i) => {
    const pos = i / (n - 1)
    for (const w of tokenizeItemName(name)) {
      const prev = words[w]
      words[w] = prev === undefined ? pos : SORT_LEARN_RATE * pos + (1 - SORT_LEARN_RATE) * prev
    }
  })
  await setDoc(SUPERMARKET_SORT_DOC, { stores: { [store]: words } }, { merge: true })
}

// ── Notifications ────────────────────────────────────────────────────────────
// Cross-user notifications. The client writes a notification doc; a Cloud
// Function delivers it as a real push to the recipient's devices. Unread docs are
// also shown in-app as a banner until dismissed.

export async function sendNotification(
  data: Omit<AppNotification, 'id' | 'createdAt' | 'read'>,
) {
  return addDoc(collection(db, 'notifications'), clean({
    ...data,
    read: false,
    createdAt: new Date().toISOString(),
  }))
}

export function subscribeNotifications(identity: UserIdentity, cb: (items: AppNotification[]) => void) {
  return onSnapshot(
    query(
      collection(db, 'notifications'),
      where('to', '==', identity),
      where('read', '==', false),
    ),
    (snap) =>
      cb(
        snap.docs
          .map((d) => docData<AppNotification>(d))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),
  )
}

export async function markNotificationRead(id: string) {
  return updateDoc(doc(db, 'notifications', id), { read: true })
}

// ── FCM tokens ───────────────────────────────────────────────────────────────
// Persist each device's push token mapped to the identity in use, so a Cloud
// Function can target the right person. Keyed by token so re-registering or
// switching identity on a device overwrites cleanly.

export async function saveFcmToken(token: string, identity: UserIdentity) {
  const key = token.replace(/[/.#$[\]]/g, '_')
  await setDoc(doc(db, 'fcmTokens', key), {
    token,
    identity,
    updatedAt: new Date().toISOString(),
  })
}

export { toDate }
