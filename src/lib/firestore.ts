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
  deleteField,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore'
import { db } from './firebase'
import { localToday } from './date'
import type {
  Trip, Checklist, ChecklistItem, Amenity, Store, CatalogItem,
  GroceryList, GroceryItem, UserIdentity, OrderingPrefs, ChecklistPhase,
  PersistentItem, TripStatus, PinnedChecklist, Template,
  SupermarketList, SupermarketItem, SupermarketSortMemory,
  AppNotification, Feedback, TransitionId, Procedure, ProcedureStep, ItemDestination,
  RemindTarget
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
  await updateDoc(doc(db, 'stores', id), data)
  // Keep the name denormalized onto active Supermarket lists (§15) in sync,
  // so stale/offline clients that rely on it don't show the old name forever.
  if (data.name) {
    const snap = await getDocs(
      query(collection(db, 'supermarketLists'), where('storeId', '==', id), where('status', '==', 'active'))
    )
    if (!snap.empty) {
      const batch = writeBatch(db)
      snap.docs.forEach((d) => batch.update(d.ref, { storeName: data.name }))
      await batch.commit()
    }
  }
}

// A store with an active Supermarket list can't be deleted — doing so would
// orphan the list's storeId and make it render with no store name (§15).
export async function deleteStore(id: string) {
  const snap = await getDocs(
    query(collection(db, 'supermarketLists'), where('storeId', '==', id), where('status', '==', 'active'))
  )
  if (!snap.empty) throw new Error('This store has an active Supermarket list. Complete or delete it first.')
  return deleteDoc(doc(db, 'stores', id))
}

// One-time seed: make sure the stores Alice already shops at exist as Store
// records, so Supermarket (which now reads its store list from here) and
// trip Groceries checklists have something to pick from out of the box.
const DEFAULT_STORE_NAMES = ['NoFrills / FreshCo', 'Dollarama', 'Costco']

export async function ensureDefaultStores() {
  const snap = await getDocs(collection(db, 'stores'))
  const have = new Set(snap.docs.map((d) => ((d.data().name as string) ?? '').trim().toLowerCase()))
  for (const name of DEFAULT_STORE_NAMES) {
    if (!have.has(name.toLowerCase())) await addStore({ name })
  }
}

// One-time migration: older `supermarketLists` docs stored a fixed store
// enum (`store: 'dollarama' | ...`); link them to the matching Store record
// by name so the feature can read `storeId` going forward. No-op for lists
// already migrated or with no matching store.
const LEGACY_SUPERMARKET_STORE_LABELS: Record<string, string> = {
  nofrills_freshco: 'NoFrills / FreshCo',
  dollarama: 'Dollarama',
  costco: 'Costco',
}

export async function migrateSupermarketListsToStoreIds() {
  const [listsSnap, storesSnap] = await Promise.all([
    getDocs(collection(db, 'supermarketLists')),
    getDocs(collection(db, 'stores')),
  ])
  const storeIdByName = new Map(
    storesSnap.docs.map((d) => [((d.data().name as string) ?? '').trim().toLowerCase(), d.id])
  )
  const batch = writeBatch(db)
  let changed = false
  listsSnap.docs.forEach((d) => {
    const data = d.data()
    if (data.storeId) return
    const legacy = data.store as string | undefined
    if (!legacy) return
    const label = LEGACY_SUPERMARKET_STORE_LABELS[legacy] ?? legacy
    const storeId = storeIdByName.get(label.toLowerCase())
    if (!storeId) return
    batch.update(d.ref, { storeId })
    changed = true
  })
  if (changed) await batch.commit()
}

// One-time migration: trip grocery checklists used a free-text name (e.g.
// "Dollarama") for the store they shop at. Link any that match a known Store
// by name so they participate in the Supermarket sync going forward. Leaves
// non-matching checklists alone (still usable, just unsynced).
export async function migrateGroceryChecklistsToStoreIds() {
  const [checklistsSnap, storesSnap] = await Promise.all([
    getDocs(collectionGroup(db, 'checklists')),
    getDocs(collection(db, 'stores')),
  ])
  const storeIdByName = new Map(
    storesSnap.docs.map((d) => [((d.data().name as string) ?? '').trim().toLowerCase(), d.id])
  )
  const batch = writeBatch(db)
  let changed = false
  checklistsSnap.forEach((d) => {
    const data = d.data()
    if (data.phase !== 'grocery' || data.storeId) return
    const storeId = storeIdByName.get(((data.name as string) ?? '').trim().toLowerCase())
    if (!storeId) return
    batch.update(d.ref, { storeId })
    changed = true
  })
  if (changed) await batch.commit()
}

// One-time migration: previously, bought grocery items were copied into a
// trip's *first* Day of departure checklist (mixing them with hand-made day-of
// packing items). They now land in a dedicated "Spmkt->Truck" list (§8). Move
// any existing grocery-copied items into that list: for each trip, an item in a
// pre_dayof checklist whose name matches an item in one of the trip's grocery
// checklists is a grocery copy, so relocate it. Idempotent — items already in
// the "Spmkt->Truck" list are skipped, and it only touches trips that need it.
export async function migrateGroceryRvItemsToSpmktList() {
  const tripsSnap = await getDocs(collection(db, 'trips'))
  for (const tripDoc of tripsSnap.docs) {
    const tripId = tripDoc.id
    const checklistsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists'))

    // Names bought in this trip's grocery checklists — the signal for a copy.
    const groceryNames = new Set<string>()
    for (const cl of checklistsSnap.docs) {
      if ((cl.data().phase as ChecklistPhase) !== 'grocery') continue
      const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', cl.id, 'items'))
      itemsSnap.docs.forEach((d) => groceryNames.add(((d.data().name as string) ?? '').trim().toLowerCase()))
    }
    if (groceryNames.size === 0) continue

    const rvList = checklistsSnap.docs.find(
      (d) =>
        (d.data().phase as ChecklistPhase) === 'pre_dayof' &&
        ((d.data().name as string) ?? '').trim().toLowerCase() === RV_CHECKLIST_NAME.toLowerCase(),
    )

    // Day of departure checklists holding the grocery copies (all pre_dayof
    // lists except the destination "Spmkt->Truck" list itself).
    const sources = checklistsSnap.docs.filter(
      (d) => (d.data().phase as ChecklistPhase) === 'pre_dayof' && d.id !== rvList?.id,
    )

    // Collect the items to move before creating the destination, so we don't
    // create an empty "Spmkt->Truck" list on trips with nothing to migrate.
    const toMove: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = []
    for (const src of sources) {
      const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', src.id, 'items'))
      itemsSnap.docs.forEach((d) => {
        if (groceryNames.has(((d.data().name as string) ?? '').trim().toLowerCase())) {
          toMove.push({ ref: d.ref, data: d.data() })
        }
      })
    }
    if (toMove.length === 0) continue

    // Resolve (or create) the destination list and its existing item names.
    let rvId: string
    const existingNames = new Set<string>()
    if (rvList) {
      rvId = rvList.id
      const rvItemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', rvId, 'items'))
      rvItemsSnap.docs.forEach((d) => existingNames.add(((d.data().name as string) ?? '').trim().toLowerCase()))
    } else {
      const order = checklistsSnap.docs.filter((d) => d.data().phase === 'pre_dayof').length
      const ref = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
        tripId, name: RV_CHECKLIST_NAME, phase: 'pre_dayof' as const, order,
      })
      rvId = ref.id
    }

    const batch = writeBatch(db)
    let order = existingNames.size
    for (const m of toMove) {
      const name = ((m.data.name as string) ?? '').trim()
      const key = name.toLowerCase()
      // Always remove from the source; only re-create in the destination if it
      // isn't already there (dedupe), matching the "no duplicates" copy rule.
      batch.delete(m.ref)
      if (existingNames.has(key)) continue
      const destRef = doc(collection(db, 'trips', tripId, 'checklists', rvId, 'items'))
      batch.set(destRef, { ...m.data, checklistId: rvId, order })
      existingNames.add(key)
      order++
    }
    await batch.commit()
  }
}

// One-time migration to the stage-driven two-list model (§20): for each trip,
// move every item from a legacy non-grocery checklist (pre_early / pre_dayof /
// pack_down) into a single "Other" (`other`) checklist, then delete the emptied
// legacy checklists (including the retired auto-lists "Spmkt->Truck" and
// "Bringing back items"). Grocery checklists are left untouched. Idempotent:
// once a trip has only grocery + other lists, it's skipped.
const LEGACY_PHASES = new Set(['pre_early', 'pre_dayof', 'pack_down'])

// Collapse one trip's legacy non-grocery checklists into its single Other list.
// Returns false (no-op) when the trip is already on the two-list model.
export async function collapseTripToOther(tripId: string): Promise<boolean> {
  const checklistsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists'))
  const legacy = checklistsSnap.docs.filter((d) => LEGACY_PHASES.has(d.data().phase as string))
  if (legacy.length === 0) return false

  const existingOther = checklistsSnap.docs.find((d) => (d.data().phase as string) === 'other')
  let otherId: string
  const otherNames = new Set<string>()
  if (existingOther) {
    otherId = existingOther.id
    const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', otherId, 'items'))
    itemsSnap.docs.forEach((d) => otherNames.add(((d.data().name as string) ?? '').trim().toLowerCase()))
  } else {
    const ref = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
      tripId, name: OTHER_CHECKLIST_NAME, phase: 'other' as const, order: 0,
    })
    otherId = ref.id
  }

  const batch = writeBatch(db)
  let order = otherNames.size
  for (const cl of legacy) {
    const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', cl.id, 'items'))
    for (const d of itemsSnap.docs) {
      const name = ((d.data().name as string) ?? '').trim()
      const key = name.toLowerCase()
      batch.delete(d.ref)
      if (!key || otherNames.has(key)) continue
      const destRef = doc(collection(db, 'trips', tripId, 'checklists', otherId, 'items'))
      batch.set(destRef, { ...d.data(), checklistId: otherId, order })
      otherNames.add(key)
      order++
    }
    batch.delete(cl.ref)
  }
  await batch.commit()
  return true
}

// One-time migration to the stage-driven two-list model (§20): collapse every
// trip. Idempotent — trips already on grocery + other are skipped.
export async function migratePhasesToOther() {
  const tripsSnap = await getDocs(collection(db, 'trips'))
  for (const tripDoc of tripsSnap.docs) {
    await collapseTripToOther(tripDoc.id)
  }
}

// One-time migration to the single-list model (§8): trips no longer have
// Groceries checklists — groceries are built in Supermarket and land in the
// trip's Other list when flagged for camping. Move every grocery item into
// Other (destination Truck, the default for camping groceries), re-point any
// live Supermarket link at its new home, and delete the grocery checklists.
export async function migrateGroceryChecklistsToOther() {
  const tripsSnap = await getDocs(collection(db, 'trips'))
  for (const tripDoc of tripsSnap.docs) {
    const tripId = tripDoc.id
    const checklistsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists'))
    const groceryLists = checklistsSnap.docs.filter((d) => (d.data().phase as string) === 'grocery')
    if (groceryLists.length === 0) continue

    const otherId = await findOrCreateOtherChecklist(tripId)
    const otherItemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', otherId, 'items'))
    const otherNames = new Set(otherItemsSnap.docs.map((d) => ((d.data().name as string) ?? '').trim().toLowerCase()))
    let order = otherItemsSnap.size

    for (const cl of groceryLists) {
      const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', cl.id, 'items'))
      for (const itemDoc of itemsSnap.docs) {
        const data = itemDoc.data()
        const key = ((data.name as string) ?? '').trim().toLowerCase()
        await deleteDoc(itemDoc.ref)
        if (!key || otherNames.has(key)) continue
        const destRef = doc(collection(db, 'trips', tripId, 'checklists', otherId, 'items'))
        await setDoc(destRef, {
          ...data,
          checklistId: otherId,
          order: order++,
          destination: data.destination ?? 'truck',
        })
        otherNames.add(key)
        // Keep the Supermarket side pointing at the moved copy, not the deleted one.
        if (data.linkedSupermarketListId && data.linkedSupermarketItemId) {
          await updateDoc(
            doc(db, 'supermarketLists', data.linkedSupermarketListId as string, 'items', data.linkedSupermarketItemId as string),
            { linkedChecklistId: otherId, linkedItemId: destRef.id },
          ).catch(() => {})
        }
      }
      await deleteDoc(cl.ref)
    }
  }
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
    items: items.map(i => clean({ name: i.name, catalogItemId: i.catalogItemId || undefined, qty: i.qty || undefined, destination: itemDestination(i) })),
    updatedAt: new Date().toISOString(),
    updatedBy: identity,
  })
}

// Find or create the checklist matching phase+name in a trip, returning its id
// and the lowercased names of items already in it (for de-duping pushes).
async function findOrCreateChecklistByName(
  tripId: string,
  phase: ChecklistPhase,
  name: string,
): Promise<{ checklistId: string; existingNames: Set<string>; created: boolean }> {
  const checklistsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists'))
  const target = checklistsSnap.docs.find(
    (d) => d.data().phase === phase && ((d.data().name as string) ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
  )
  if (target) {
    const itemsSnap = await getDocs(collection(db, 'trips', tripId, 'checklists', target.id, 'items'))
    return {
      checklistId: target.id,
      existingNames: new Set(itemsSnap.docs.map((d) => ((d.data().name as string) ?? '').toLowerCase())),
      created: false,
    }
  }
  const order = checklistsSnap.docs.filter((d) => d.data().phase === phase).length
  const clRef = await addDoc(collection(db, 'trips', tripId, 'checklists'), { tripId, name, phase, order, pinned: true })
  return { checklistId: clRef.id, existingNames: new Set(), created: true }
}

// Trips eligible for an immediate pin push: active or planned (not
// completed/cancelled), excluding the trip the pin originated on (it already
// has the item/checklist).
async function upcomingTripsExcluding(excludeTripId: string) {
  const tripsSnap = await getDocs(collection(db, 'trips'))
  return tripsSnap.docs.filter((d) => {
    if (d.id === excludeTripId) return false
    const status = d.data().status as TripStatus
    return status === 'active' || status === 'planned'
  })
}

// Immediately mirror a just-pinned item into every other active/planned trip
// (not just future new trips seeded later — see §12). Idempotent per trip:
// skips a trip whose target checklist already has a same-name item.
async function pushPersistentItemToTrips(
  excludeTripId: string,
  rec: Omit<PersistentItem, 'id'>,
  identity: UserIdentity,
) {
  const targets = await upcomingTripsExcluding(excludeTripId)
  for (const tripDoc of targets) {
    const tripId = tripDoc.id
    const { checklistId, existingNames } = await findOrCreateChecklistByName(tripId, rec.phase, rec.checklistName)
    if (existingNames.has(rec.name.toLowerCase())) continue
    await addDoc(collection(db, 'trips', tripId, 'checklists', checklistId, 'items'), clean({
      tripId,
      checklistId,
      catalogItemId: rec.catalogItemId || undefined,
      name: rec.name,
      qty: rec.qty ?? '',
      destination: rec.destination,
      checked: false,
      order: existingNames.size,
      rev: 1,
      baseRev: 0,
      updatedBy: identity,
      updatedAt: new Date().toISOString(),
    }))
  }
}

// Immediately mirror a just-pinned checklist (and its current items) into
// every other active/planned trip (see §13). Idempotent per trip/item: skips
// items that already exist by name in the target checklist.
export async function pushPinnedChecklistToTrips(
  excludeTripId: string,
  name: string,
  phase: ChecklistPhase,
  items: ChecklistItem[],
  identity: UserIdentity,
) {
  const targets = await upcomingTripsExcluding(excludeTripId)
  for (const tripDoc of targets) {
    const tripId = tripDoc.id
    const { checklistId, existingNames } = await findOrCreateChecklistByName(tripId, phase, name)
    const batch = writeBatch(db)
    let order = existingNames.size
    let changed = false
    for (const item of items) {
      const key = item.name.toLowerCase()
      if (existingNames.has(key)) continue
      const itemRef = doc(collection(db, 'trips', tripId, 'checklists', checklistId, 'items'))
      batch.set(itemRef, clean({
        tripId,
        checklistId,
        catalogItemId: item.catalogItemId || undefined,
        name: item.name,
        qty: item.qty || '',
        destination: itemDestination(item),
        checked: false,
        order,
        rev: 1,
        baseRev: 0,
        updatedBy: identity,
        updatedAt: new Date().toISOString(),
      }))
      existingNames.add(key)
      order++
      changed = true
    }
    if (changed) await batch.commit()
  }
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
// "Today" is the device's local date (`localToday`); shifting a trip's own dates
// by whole days is done in UTC, which is safe for bare `YYYY-MM-DD` strings.

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The status a trip should have for a given day, based purely on its dates.
export function deriveTripStatus(
  trip: Trip,
  today = localToday(),
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
  const today = localToday()
  for (const trip of trips) {
    if (trip.status === 'cancelled') continue
    const next = deriveTripStatus(trip, today)
    if (next === trip.status || STATUS_RANK[next] <= STATUS_RANK[trip.status]) continue
    if (next === 'completed') await completeTrip(trip, identity)
    else await updateTrip(trip.id, { status: next })
  }
}

// The trip that "next/current trip" features (Home dashboard §4, camping-item
// sync §8/§15) should target: the active trip if any, else the soonest
// upcoming non-cancelled/non-completed trip.
export function findNextOrActiveTrip(trips: Trip[]): Trip | undefined {
  const today = localToday()
  const live = trips.filter((t) => t.status !== 'cancelled' && t.status !== 'completed')
  return (
    // 1. A trip explicitly marked active.
    live.find((t) => t.status === 'active') ??
    // 2. A trip currently underway by its dates but not yet marked active — a
    //    planned trip whose start has passed must still be a valid target.
    live
      .filter((t) => t.startDate <= today && t.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ??
    // 3. Otherwise the soonest upcoming trip.
    live
      .filter((t) => t.startDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  )
}

// ── Trip route (stops & transitions) + safety procedures ──────────────────────
// Every trip follows the same fixed route (§20):
//   Home → Warehouse → Campsite → Warehouse → Home
// `trip.currentStop` is the index of the stop the crew is at. Advancing to the
// next stop crosses a *transition*, and each transition has a shared safety
// procedure (a `procedures` doc) whose per-trip check state lives on the trip.

export const TRIP_STOPS = ['Home', 'Warehouse', 'Campsite', 'Warehouse', 'Home'] as const

// Transition i is the act of leaving stop i for stop i+1 (safety checklist fires
// on advance). `arrive_home` is the terminal checklist at the last stop — it has
// no next stop; completing it finishes the trip and prompts the rating (§20).
export const TRANSITIONS: { id: TransitionId; label: string }[] = [
  { id: 'leave_home', label: 'Leaving home' },
  { id: 'leave_warehouse_go', label: 'Leaving the warehouse' },
  { id: 'leave_campsite', label: 'Leaving the campsite' },
  { id: 'leave_warehouse_return', label: 'Leaving the warehouse (heading home)' },
]

// The safety checklist shown at each stop (by stop index). Stops advance by the
// transition of the same index; the last stop uses the terminal `arrive_home`.
export const STOP_PROCEDURE: (TransitionId | null)[] = [
  'leave_home', 'leave_warehouse_go', 'leave_campsite', 'leave_warehouse_return', 'arrive_home',
]

export const FINAL_TRANSITION: TransitionId = 'arrive_home'

export const PROCEDURE_LABELS: Record<TransitionId, string> = {
  leave_home: 'Leaving home',
  leave_warehouse_go: 'Leaving the warehouse',
  leave_campsite: 'Leaving the campsite',
  leave_warehouse_return: 'Leaving the warehouse (heading home)',
  arrive_home: 'Arriving home (final checks)',
}

// Which items each stop puts in front of the user (§20). `null` = no item list
// (safety only). `remapHomeToTruck` shows a Home-destination item as Truck at
// that moment (it must ride in the truck before it can go home).
export interface StageConfig {
  itemFilter: ((dest: ItemDestination | undefined) => boolean) | null
  remapHomeToTruck: boolean
  label: string
}

export const TRIP_STAGES: StageConfig[] = [
  { itemFilter: () => true, remapHomeToTruck: false, label: 'Load everything into the truck' },
  { itemFilter: null, remapHomeToTruck: false, label: 'Safety checklist only' },
  { itemFilter: () => true, remapHomeToTruck: true, label: 'Stow in the RV or truck' },
  { itemFilter: () => true, remapHomeToTruck: true, label: 'Sort between RV and truck' },
  { itemFilter: (d) => (d ?? 'home') === 'home', remapHomeToTruck: false, label: 'Bring inside the house' },
]

// The destination to *display* for an item at a given stop (Home → Truck where
// the stage remaps it). The stored destination is never changed by this.
export function displayedDestination(
  dest: ItemDestination | undefined,
  stopIndex: number,
): ItemDestination | undefined {
  const stage = TRIP_STAGES[stopIndex]
  if (stage?.remapHomeToTruck && (dest ?? 'home') === 'home') return 'truck'
  return dest
}

// Toggle an item's per-stop "done" mark (§20). Independent of `checked`.
export async function setStageItemDone(
  tripId: string,
  checklistId: string,
  item: ChecklistItem,
  stopIndex: number,
  done: boolean,
  identity: UserIdentity,
) {
  await updateItem(tripId, checklistId, item.id, {
    stagesDone: done
      ? Array.from(new Set([...(item.stagesDone ?? []), stopIndex]))
      : (item.stagesDone ?? []).filter((s) => s !== stopIndex),
  }, identity, item.rev)
}

// Toggle the "remove after completion" flag (§20). Marking it does not check or
// hide the item — it only means that once the item is checked off at a stop, it
// stops appearing at the stops that follow. Deliberately does NOT route through
// the persist rule, so a pinned item stays in the recurring set and still shows
// up next trip, and it never propagates to Supermarket.
export async function setItemRemoveOnComplete(
  tripId: string,
  checklistId: string,
  item: ChecklistItem,
  removeOnComplete: boolean,
  identity: UserIdentity,
) {
  await updateItem(tripId, checklistId, item.id, { removeOnComplete }, identity, item.rev)
}

// Set — or clear, with `null` — the item's day-before reminder target (§21).
export async function setItemRemindTo(
  tripId: string,
  checklistId: string,
  item: ChecklistItem,
  remindTo: RemindTarget | null,
  identity: UserIdentity,
) {
  await updateDoc(doc(db, 'trips', tripId, 'checklists', checklistId, 'items', item.id), {
    remindTo: remindTo ?? deleteField(),
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: item.rev,
    rev: item.rev + 1,
  })
}

/** Unchecked items of a trip flagged to remind `identity` (directly or via 'both'), §21. */
export async function fetchTripRemindersFor(
  tripId: string,
  identity: UserIdentity,
): Promise<{ checklistId: string; item: ChecklistItem }[]> {
  const lists = await getDocs(collection(db, 'trips', tripId, 'checklists'))
  const out: { checklistId: string; item: ChecklistItem }[] = []
  for (const cl of lists.docs) {
    const items = await getDocs(collection(db, 'trips', tripId, 'checklists', cl.id, 'items'))
    for (const d of items.docs) {
      const item = docData<ChecklistItem>(d)
      if (item.checked) continue
      if (item.remindTo === identity || item.remindTo === 'both') out.push({ checklistId: cl.id, item })
    }
  }
  return out
}

// The single free-form list for a trip under the two-list model (§20).
export const OTHER_CHECKLIST_NAME = 'Other'

export async function findOrCreateOtherChecklist(tripId: string): Promise<string> {
  const snap = await getDocs(collection(db, 'trips', tripId, 'checklists'))
  const existing = snap.docs.find((d) => (d.data().phase as ChecklistPhase) === 'other')
  if (existing) return existing.id
  const ref = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
    tripId, name: OTHER_CHECKLIST_NAME, phase: 'other' as const, order: 0,
  })
  return ref.id
}

export function subscribeProcedures(cb: (items: Procedure[]) => void) {
  return onSnapshot(collection(db, 'procedures'), (snap) =>
    cb(snap.docs.map((d) => docData<Procedure>(d)))
  )
}

function newStepId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// One-time seed of the starter safety procedures (§20). Per-transition: only
// creates docs that don't exist yet, so user edits are never overwritten.
const DEFAULT_PROCEDURE_STEPS: Record<TransitionId, string[]> = {
  leave_home: [],
  leave_warehouse_go: [
    'Trailer battery connected',
    'Hitch pin + safety chains secured',
    'Lights & brake check',
    'Tire pressure checked',
    'Jack raised',
    'Mirrors adjusted',
  ],
  leave_campsite: [
    'Antenna down',
    'Stabilizers up',
    'Windows & vents closed',
    'Tanks emptied',
    'Propane closed',
    'Final walk-around',
  ],
  leave_warehouse_return: [
    'Trailer battery disconnected',
    'Trailer aligned in its spot',
    'Wheels chocked',
    'Propane closed',
    'RV locked',
  ],
  arrive_home: [
    'Truck unloaded',
    'Fridge/cooler emptied',
    'Trailer locked',
  ],
}

export const ALL_PROCEDURE_IDS: TransitionId[] = [...TRANSITIONS.map((t) => t.id), FINAL_TRANSITION]

export async function ensureDefaultProcedures() {
  const snap = await getDocs(collection(db, 'procedures'))
  const have = new Set(snap.docs.map((d) => d.id))
  for (const id of ALL_PROCEDURE_IDS) {
    if (have.has(id)) continue
    await setDoc(doc(db, 'procedures', id), {
      steps: DEFAULT_PROCEDURE_STEPS[id].map((text) => ({ id: newStepId(), text })),
    })
  }
}

// Procedure steps are a shared template: adding/removing a step changes it for
// every future trip (and every not-yet-crossed transition of current trips).
export async function addProcedureStep(transitionId: TransitionId, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  const step: ProcedureStep = { id: newStepId(), text: trimmed }
  await setDoc(doc(db, 'procedures', transitionId), { steps: arrayUnion(step) }, { merge: true })
}

export async function removeProcedureStep(transitionId: TransitionId, step: ProcedureStep) {
  await updateDoc(doc(db, 'procedures', transitionId), { steps: arrayRemove(step) })
}

// Replace a transition's whole step list — used by Manage → Safety checklists
// for renaming a step and for drag reordering. Step ids are preserved, so
// per-trip check state keeps pointing at the right steps.
export async function saveProcedureSteps(transitionId: TransitionId, steps: ProcedureStep[]) {
  await setDoc(doc(db, 'procedures', transitionId), { steps })
}

// Check/uncheck one procedure step for one trip's transition. State is on the
// trip doc so it is shared live between Diogo and Alice and resets naturally
// with each new trip.
export async function setTransitionStepChecked(
  tripId: string,
  transitionId: TransitionId,
  stepId: string,
  checked: boolean,
) {
  await updateDoc(doc(db, 'trips', tripId), {
    [`transitions.${transitionId}.checked`]: checked ? arrayUnion(stepId) : arrayRemove(stepId),
  })
}

// Advance the trip to the next stop, recording who crossed the transition and
// which safety steps (if any) were skipped unchecked. Clamped to the route.
export async function advanceTripStop(
  trip: Trip,
  transitionId: TransitionId,
  skippedStepIds: string[],
  identity: UserIdentity,
) {
  const next = Math.min((trip.currentStop ?? 0) + 1, TRIP_STOPS.length - 1)
  const data: Record<string, unknown> = {
    currentStop: next,
    [`transitions.${transitionId}.advancedAt`]: new Date().toISOString(),
    [`transitions.${transitionId}.advancedBy`]: identity,
  }
  if (skippedStepIds.length > 0) {
    data[`transitions.${transitionId}.skippedSteps`] = skippedStepIds
    data[`transitions.${transitionId}.skippedAt`] = new Date().toISOString()
  }
  await updateDoc(doc(db, 'trips', trip.id), data)
}

// Step back one stop (mistake fix). Keeps the transition's check state so
// re-advancing doesn't force re-checking everything.
export async function stepBackTripStop(trip: Trip) {
  const prev = Math.max((trip.currentStop ?? 0) - 1, 0)
  await updateDoc(doc(db, 'trips', trip.id), { currentStop: prev })
}

// ── Checklists ────────────────────────────────────────────────────────────────

export function subscribeChecklists(tripId: string, cb: (lists: Checklist[]) => void) {
  return onSnapshot(
    query(collection(db, 'trips', tripId, 'checklists'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => docData<Checklist>(d)))
  )
}

export async function addChecklist(tripId: string, data: Omit<Checklist, 'id' | 'tripId'>) {
  return addDoc(collection(db, 'trips', tripId, 'checklists'), clean({ ...data, tripId }))
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

// Name of the dedicated "Day of departure" checklist that bought groceries
// (from trip Groceries or synced Supermarket) are copied into (§8). Kept
// separate from any hand-made day-of packing list so the two don't mix.
export const RV_CHECKLIST_NAME = 'Spmkt->Truck'

// An item's effective final destination (§18). The legacy `bringBack` flag
// reads as destination `home`; an explicit `destination` always wins.
export function itemDestination(
  item: Pick<ChecklistItem, 'destination' | 'bringBack'>,
): ItemDestination | undefined {
  return item.destination ?? (item.bringBack ? 'home' : undefined)
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

// One-shot read of every checklist in a trip with its items, ordered the same
// way the trip view is (by checklist `order`, items by `order`). Used by the
// "Print all" action (§19) which needs item data the per-card subscriptions
// don't expose at the trip level.
export async function getTripChecklistsWithItems(
  tripId: string,
): Promise<{ checklist: Checklist; items: ChecklistItem[] }[]> {
  const checklistsSnap = await getDocs(
    query(collection(db, 'trips', tripId, 'checklists'), orderBy('order')),
  )
  const out: { checklist: Checklist; items: ChecklistItem[] }[] = []
  for (const cl of checklistsSnap.docs) {
    const itemsSnap = await getDocs(
      query(collection(db, 'trips', tripId, 'checklists', cl.id, 'items'), orderBy('order')),
    )
    out.push({
      checklist: docData<Checklist>(cl),
      items: itemsSnap.docs.map((d) => docData<ChecklistItem>(d)),
    })
  }
  return out
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

// Check/uncheck a checklist item, applying the persist-recurring rule (§12).
// A trip item's check means "handled at this stop"; it is never propagated to a
// live-linked Supermarket item, where a check means "bought" (§8).
export async function setChecklistItemChecked(
  tripId: string,
  checklist: Checklist,
  item: ChecklistItem,
  checked: boolean,
  identity: UserIdentity,
  currentStop: number,
) {
  // The checklist-card checkbox and the stage checkbox are two views of the same
  // "handled" state (§20). Mirror the card check into `stagesDone` at the trip's
  // current stop, so a "remove after completion" item checked from the card also
  // drops out of the later stops. The stop comes from the caller's live trip
  // subscription — no extra read before the write, so the check lands instantly.
  const stop = Math.min(Math.max(currentStop, 0), TRIP_STOPS.length - 1)
  const stagesDone = checked
    ? Array.from(new Set([...(item.stagesDone ?? []), stop]))
    : (item.stagesDone ?? []).filter(s => s !== stop)
  await updateItem(tripId, checklist.id, item.id, { checked, stagesDone }, identity, item.rev)

  if (item.persist) {
    if (checked) {
      await removePersistentItem(checklist.phase, checklist.name, item.name)
    } else {
      await addPersistentItem(
        { name: item.name, phase: checklist.phase, checklistName: checklist.name, catalogItemId: item.catalogItemId, qty: item.qty },
        identity,
      )
    }
  }

  // NOTE (§20): the old copy-on-check rules (bought grocery → "Spmkt->Truck",
  // destination-home → "Bringing back items") are retired under the stage-driven
  // flow — those lists no longer exist; each stop derives its own view from item
  // destinations instead.
}

// Update a checklist item and, when it's live-linked to a Supermarket item,
// propagate a quantity change there too (§8/§15).
export async function updateChecklistItemAndPropagate(
  tripId: string,
  checklist: Checklist,
  item: ChecklistItem,
  data: Partial<ChecklistItem>,
  identity: UserIdentity,
) {
  await updateItem(tripId, checklist.id, item.id, data, identity, item.rev)
  if (data.qty !== undefined && item.linkedSupermarketListId && item.linkedSupermarketItemId) {
    const linkedSnap = await getDoc(
      doc(db, 'supermarketLists', item.linkedSupermarketListId, 'items', item.linkedSupermarketItemId)
    )
    if (linkedSnap.exists()) {
      await updateSupermarketItem(
        item.linkedSupermarketListId,
        item.linkedSupermarketItemId,
        { qty: data.qty },
        identity,
        (linkedSnap.data().rev as number) ?? 0,
      )
    }
  }
}

// Delete a checklist item and, when it's live-linked to a Supermarket item,
// delete that one too (they represent the same shopping-list entry, §8/§15).
export async function deleteChecklistItemAndPropagate(
  tripId: string,
  checklist: Checklist,
  item: ChecklistItem,
) {
  if (item.persist) await removePersistentItem(checklist.phase, checklist.name, item.name)
  await deleteItem(tripId, checklist.id, item.id)
  if (item.linkedSupermarketListId && item.linkedSupermarketItemId) {
    await deleteSupermarketItem(item.linkedSupermarketListId, item.linkedSupermarketItemId)
  }
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
    destination: rec.destination,
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
    const rec = { name: item.name, phase: checklist.phase, checklistName: checklist.name, catalogItemId: item.catalogItemId, qty: item.qty, destination: itemDestination(item) }
    await addPersistentItem(rec, identity)
    await pushPersistentItemToTrips(tripId, rec, identity)
  } else if (!persist) {
    await removePersistentItem(checklist.phase, checklist.name, item.name)
  }
}

// Set an item's final destination (§18): Home / Truck / RV. Destination `home`
// means "must come back" — checking the item later copies it into the trip's
// Pack down / return list (see setChecklistItemChecked). If the item is
// *already* checked when the destination changes, reconcile the Pack down copy
// immediately — switching to `home` copies it in, switching away removes it —
// so destination order and check order don't matter. Clears the legacy
// `bringBack` flag so `destination` is the single source going forward.
export async function setItemDestination(
  tripId: string,
  checklist: Checklist,
  item: ChecklistItem,
  destination: ItemDestination,
  identity: UserIdentity,
) {
  // Under the stage-driven flow (§20) destination is just a per-item property
  // the stop views derive from; changing it no longer copies anything.
  await updateItem(tripId, checklist.id, item.id, { destination, bringBack: false }, identity, item.rev)
  // If the item is pinned (persist), remember the new destination on the global
  // recurring record too, so future trips seed it with the same destination (§12/§18).
  if (item.persist && !item.checked) {
    await addPersistentItem(
      { name: item.name, phase: checklist.phase, checklistName: checklist.name, catalogItemId: item.catalogItemId, qty: item.qty, destination },
      identity,
    )
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
        destination: item.destination,
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
  // Two-list model (§20): funnel all seeded non-grocery lists into "Other".
  await collapseTripToOther(tripId)
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
      destination: rec.destination,
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
// A shopping list per store (one active list per store). Alice builds a list;
// Diogo shops and marks each item bought, then completes the list (which hides
// it and notifies the other person). See §15. Stores come from the shared
// `stores` collection (Manage > Stores) — see §11.

// Display name for a list's store. Prefers the live `stores` join (reflects
// renames immediately), then the name denormalized onto the list at creation
// (so a list never renders nameless while `stores` hasn't loaded or if the
// store was deleted), then a visible placeholder.
export function storeLabel(stores: Store[], list: Pick<SupermarketList, 'storeId' | 'storeName'>): string {
  return stores.find((s) => s.id === list.storeId)?.name ?? list.storeName ?? 'Unknown store'
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

async function createSupermarketListDoc(storeId: string, identity: UserIdentity) {
  // Denormalize the store name onto the list so it can render without the
  // `stores` join (see storeLabel). Reads from the offline cache when needed.
  const storeSnap = await getDoc(doc(db, 'stores', storeId))
  const storeName = (storeSnap.data()?.name as string | undefined)?.trim()
  return addDoc(collection(db, 'supermarketLists'), clean({
    storeId,
    storeName,
    status: 'active' as const,
    createdBy: identity,
    createdAt: serverTimestamp(),
  }))
}

// Find the store's current active list, or start a new one. This is the only
// way a Supermarket list should be created — it re-checks for an existing
// active list right before writing, so two near-simultaneous "new list" taps
// (e.g. from two devices) land on the same list instead of creating a
// duplicate for the store (§15: at most one active list per store). Used by
// both the store picker (SupermarketHome) and to land grocery items mirrored
// in from a trip (§8).
export async function ensureActiveSupermarketList(storeId: string, identity: UserIdentity): Promise<string> {
  const snap = await getDocs(
    query(collection(db, 'supermarketLists'), where('storeId', '==', storeId), where('status', '==', 'active'))
  )
  if (!snap.empty) return snap.docs[0].id
  const ref = await createSupermarketListDoc(storeId, identity)
  return ref.id
}

// One-time backfill: write `storeName` onto existing supermarketLists docs
// created before the field existed, so they render a title on clients that
// can't resolve the `stores` join. Run from the dev console (checklistDevTools).
export async function backfillSupermarketStoreNames() {
  const [listsSnap, storesSnap] = await Promise.all([
    getDocs(collection(db, 'supermarketLists')),
    getDocs(collection(db, 'stores')),
  ])
  const nameById = new Map(storesSnap.docs.map((d) => [d.id, (d.data().name as string) ?? '']))
  const batch = writeBatch(db)
  let changed = 0
  listsSnap.docs.forEach((d) => {
    const data = d.data()
    if (data.storeName) return
    const name = nameById.get(data.storeId)
    if (!name) return
    batch.update(d.ref, { storeName: name })
    changed++
  })
  if (changed) await batch.commit()
  return { updated: changed }
}

// One-time cleanup for the duplicate-active-list bug (§15): before
// `ensureActiveSupermarketList` was enforced everywhere, a race could create
// more than one active list for the same store. For each store with more
// than one active list, keep the oldest, move any items from the others into
// it (skipping same-name items so nothing doubles up), and delete the
// duplicate list docs outright — not mark them complete, which would fire a
// spurious completion notification (§15) for a list nobody actually shopped.
export async function dedupeSupermarketLists() {
  const snap = await getDocs(
    query(collection(db, 'supermarketLists'), where('status', '==', 'active'))
  )
  const byStore = new Map<string, { id: string; createdAt: unknown }[]>()
  snap.docs.forEach((d) => {
    const data = d.data()
    const arr = byStore.get(data.storeId) ?? []
    arr.push({ id: d.id, createdAt: data.createdAt })
    byStore.set(data.storeId, arr)
  })

  let mergedLists = 0
  let movedItems = 0

  for (const [, lists] of byStore) {
    if (lists.length < 2) continue
    lists.sort((a, b) => {
      const at = a.createdAt instanceof Timestamp ? a.createdAt.toMillis() : 0
      const bt = b.createdAt instanceof Timestamp ? b.createdAt.toMillis() : 0
      return at - bt
    })
    const [keeper, ...dupes] = lists

    const keeperItemsSnap = await getDocs(collection(db, 'supermarketLists', keeper.id, 'items'))
    const keeperNames = new Set(keeperItemsSnap.docs.map((d) => ((d.data().name as string) ?? '').trim().toLowerCase()))

    for (const dupe of dupes) {
      const itemsSnap = await getDocs(collection(db, 'supermarketLists', dupe.id, 'items'))
      const batch = writeBatch(db)
      itemsSnap.docs.forEach((itemDoc) => {
        const data = itemDoc.data()
        const nameKey = ((data.name as string) ?? '').trim().toLowerCase()
        if (!keeperNames.has(nameKey)) {
          batch.set(doc(collection(db, 'supermarketLists', keeper.id, 'items')), data)
          keeperNames.add(nameKey)
          movedItems++
        }
        batch.delete(itemDoc.ref)
      })
      batch.delete(doc(db, 'supermarketLists', dupe.id))
      await batch.commit()
      mergedLists++
    }
  }

  return { mergedLists, movedItems }
}

export function subscribeSupermarketItems(listId: string, cb: (items: SupermarketItem[]) => void) {
  return onSnapshot(
    query(collection(db, 'supermarketLists', listId, 'items'), orderBy('order')),
    (snap) => cb(snap.docs.map((d) => docData<SupermarketItem>(d)))
  )
}

export async function addSupermarketItem(
  listId: string,
  data: Omit<SupermarketItem, 'id' | 'listId' | 'rev' | 'baseRev' | 'updatedBy' | 'updatedAt' | 'createdAt'>,
  identity: UserIdentity,
) {
  const now = new Date().toISOString()
  return addDoc(collection(db, 'supermarketLists', listId, 'items'), clean({
    ...data,
    listId,
    rev: 1,
    baseRev: 0,
    updatedBy: identity,
    updatedAt: now,
    createdAt: now,
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

// Delete a supermarket item and, when it's live-linked to a trip grocery item
// (§8/§15), delete that one too — they're the same shopping-list entry.
export async function deleteSupermarketItemAndPropagate(item: SupermarketItem) {
  if (item.linkedTripId && item.linkedChecklistId && item.linkedItemId) {
    await deleteDoc(doc(db, 'trips', item.linkedTripId, 'checklists', item.linkedChecklistId, 'items', item.linkedItemId))
  }
  await deleteSupermarketItem(item.listId, item.id)
}

// Mark a supermarket item bought/unbought. A camping-flagged item enters the
// trip's "Bring to Truck" list the moment it is bought, and leaves it again if
// it is un-bought (§8) — there's no point loading something not yet purchased.
// The trip copy's own check (loaded into the truck) is never touched here.
export async function setSupermarketItemChecked(
  list: SupermarketList,
  item: SupermarketItem,
  checked: boolean,
  identity: UserIdentity,
  trips: Trip[],
  extra?: Partial<SupermarketItem>,
) {
  // Stamp when it was bought so the daily cleanup can drop it the next day (§15);
  // clear the stamp when un-bought so it's no longer a removal candidate.
  const checkedAt = checked ? new Date().toISOString() : deleteField()
  await updateSupermarketItem(
    list.id, item.id,
    { checked, checkedAt, ...extra } as Partial<SupermarketItem>,
    identity, item.rev,
  )
  if (!item.forCamping) return
  if (checked) await linkSupermarketItemToTrip(list, { ...item, checked }, trips, identity)
  else await unlinkSupermarketItemFromTrip({ ...item, checked }, identity, true)
}

// Flip a supermarket item's "for camping" flag. The trip copy only exists while
// the item is both flagged and bought (§8), so flagging an unbought item just
// records the intent.
export async function setSupermarketItemForCamping(
  list: SupermarketList,
  item: SupermarketItem,
  forCamping: boolean,
  trips: Trip[],
  identity: UserIdentity,
) {
  if (!forCamping) {
    await unlinkSupermarketItemFromTrip(item, identity)
  } else if (item.checked) {
    await linkSupermarketItemToTrip(list, item, trips, identity)
  } else {
    await updateSupermarketItem(list.id, item.id, { forCamping: true }, identity, item.rev)
  }
}

// Adjust a supermarket item's quantity and, when it's live-linked to a trip
// item, propagate the new quantity there too.
export async function setSupermarketItemQty(
  list: SupermarketList,
  item: SupermarketItem,
  qty: string,
  identity: UserIdentity,
) {
  await updateSupermarketItem(list.id, item.id, { qty }, identity, item.rev)
  if (!item.linkedTripId || !item.linkedChecklistId || !item.linkedItemId) return
  const tripItemSnap = await getDoc(
    doc(db, 'trips', item.linkedTripId, 'checklists', item.linkedChecklistId, 'items', item.linkedItemId)
  )
  if (!tripItemSnap.exists()) return
  await updateItem(
    item.linkedTripId, item.linkedChecklistId, item.linkedItemId,
    { qty }, identity, (tripItemSnap.data().rev as number) ?? 0,
  )
}

// Rename a supermarket item and, when it's live-linked to a trip item,
// propagate the new name there too (§8/§15).
export async function setSupermarketItemName(
  list: SupermarketList,
  item: SupermarketItem,
  name: string,
  identity: UserIdentity,
) {
  await updateSupermarketItem(list.id, item.id, { name }, identity, item.rev)
  if (!item.linkedTripId || !item.linkedChecklistId || !item.linkedItemId) return
  const tripItemSnap = await getDoc(
    doc(db, 'trips', item.linkedTripId, 'checklists', item.linkedChecklistId, 'items', item.linkedItemId)
  )
  if (!tripItemSnap.exists()) return
  await updateItem(
    item.linkedTripId, item.linkedChecklistId, item.linkedItemId,
    { name }, identity, (tripItemSnap.data().rev as number) ?? 0,
  )
}

// Mirror a bought, camping-flagged supermarket item into the next/active trip's
// "Bring to Truck" (Other) list with the Truck destination, adopting a same-name
// item there if one already exists. No-op if there's no next/active trip. The
// trip copy starts unchecked — bought at the store is not loaded into the truck
// (§8). Only ever called once the item is *both* flagged and bought.
export async function linkSupermarketItemToTrip(
  list: SupermarketList,
  item: SupermarketItem,
  trips: Trip[],
  identity: UserIdentity,
) {
  const target = findNextOrActiveTrip(trips)
  if (!target) return

  // Re-read the item fresh — the caller's `item` may be a stale local copy
  // (e.g. right after an optimistic sort re-write bumped its rev/order).
  const freshSnap = await getDoc(doc(db, 'supermarketLists', list.id, 'items', item.id))
  if (!freshSnap.exists()) return
  const fresh = docData<SupermarketItem>(freshSnap)

  const checklistId = await findOrCreateOtherChecklist(target.id)
  const itemsCol = collection(db, 'trips', target.id, 'checklists', checklistId, 'items')
  const itemsSnap = await getDocs(itemsCol)
  // Only adopt a same-name trip item that isn't already linked to a
  // *different* Supermarket item — otherwise we'd silently steal its link.
  const existing = itemsSnap.docs.find(
    (d) =>
      ((d.data().name as string) ?? '').toLowerCase() === fresh.name.toLowerCase() &&
      (!d.data().linkedSupermarketItemId || d.data().linkedSupermarketItemId === fresh.id)
  )

  let tripItemId: string
  if (existing) {
    tripItemId = existing.id
    // Camping groceries ride in the truck to camp — set the destination (§18),
    // unless the user already picked one on this item.
    const existingDest = itemDestination(docData<ChecklistItem>(existing))
    await updateItem(target.id, checklistId, existing.id, {
      linkedSupermarketListId: list.id, linkedSupermarketItemId: fresh.id,
      ...(existingDest ? {} : { destination: 'truck' as const }),
    }, identity, (existing.data().rev as number) ?? 0)
  } else {
    const ref = await addItem(
      target.id, checklistId,
      clean({
        catalogItemId: fresh.catalogItemId, name: fresh.name, qty: fresh.qty || '1',
        checked: false, order: itemsSnap.size, destination: 'truck' as const,
        linkedSupermarketListId: list.id, linkedSupermarketItemId: fresh.id,
      }) as Omit<ChecklistItem, 'id' | 'tripId' | 'checklistId'>,
      identity,
    )
    tripItemId = ref.id
  }

  await updateSupermarketItem(
    list.id, fresh.id,
    { forCamping: true, linkedTripId: target.id, linkedChecklistId: checklistId, linkedItemId: tripItemId },
    identity, fresh.rev,
  )
}

// Remove a supermarket item's mirrored copy from the trip's "Bring to Truck"
// list and clear the link. `keepFlag` keeps the camping flag on — used when the
// item is un-bought but still destined for camping (§8).
export async function unlinkSupermarketItemFromTrip(
  item: SupermarketItem,
  identity: UserIdentity,
  keepFlag = false,
) {
  if (item.linkedTripId && item.linkedChecklistId && item.linkedItemId) {
    await deleteDoc(doc(db, 'trips', item.linkedTripId, 'checklists', item.linkedChecklistId, 'items', item.linkedItemId))
  }
  // Re-read the rev — the caller may have just written this doc (e.g. the bought
  // toggle), leaving its local copy a revision behind.
  const ref = doc(db, 'supermarketLists', item.listId, 'items', item.id)
  const snap = await getDoc(ref)
  const rev = (snap.data()?.rev as number) ?? item.rev
  await updateDoc(ref, {
    forCamping: keepFlag,
    linkedTripId: deleteField(),
    linkedChecklistId: deleteField(),
    linkedItemId: deleteField(),
    updatedBy: identity,
    updatedAt: new Date().toISOString(),
    baseRev: rev,
    rev: rev + 1,
  })
}

// Mark a list complete: hide it from the active view, record who/when, and — only
// when something couldn't be bought — tell the other person what was missed (§15).
export async function completeSupermarketList(
  list: SupermarketList,
  items: SupermarketItem[],
  storeName: string,
  identity: UserIdentity,
) {
  const missed = items.filter(i => !i.checked).map(i => i.name)

  await updateDoc(doc(db, 'supermarketLists', list.id), {
    status: 'complete',
    completedAt: new Date().toISOString(),
    completedBy: identity,
  })

  // A fully-bought list is the expected outcome and needs no push (§15). Notify
  // only the other person — the shopper doesn't get a push about their own action.
  if (missed.length === 0) return
  const who = identity === 'diogo' ? 'Diogo' : 'Alice'
  const recipient: UserIdentity = identity === 'diogo' ? 'alice' : 'diogo'
  await sendNotification({
    to: recipient,
    from: identity,
    title: 'Shopping update',
    body: `${who} finished the ${storeName} list. Couldn't get: ${missed.join(', ')}`,
    type: 'supermarket',
    url: '/supermarket',
  })
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
  store: string,
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
  store: string,
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

// ── Feedback (bugs & ideas) ────────────────────────────────────────────────────
// A shared, sortable to-do list of reported bugs and improvement ideas (§17).
// Completing an entry simply deletes it.

export function subscribeFeedback(cb: (items: Feedback[]) => void) {
  return onSnapshot(query(collection(db, 'feedback'), orderBy('order')), (snap) =>
    cb(snap.docs.map((d) => docData<Feedback>(d)))
  )
}

export async function addFeedback(
  data: Omit<Feedback, 'id' | 'createdAt'>,
) {
  return addDoc(collection(db, 'feedback'), clean({
    ...data,
    createdAt: new Date().toISOString(),
  }))
}

export async function updateFeedback(id: string, data: Partial<Feedback>) {
  return updateDoc(doc(db, 'feedback', id), clean(data))
}

export async function deleteFeedback(id: string) {
  return deleteDoc(doc(db, 'feedback', id))
}

// Persist the list position of each entry after a drag reorder.
export async function saveFeedbackPositions(ordered: { id: string; order: number }[]) {
  const batch = writeBatch(db)
  ordered.forEach(({ id, order }) => batch.update(doc(db, 'feedback', id), { order }))
  await batch.commit()
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
