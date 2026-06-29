import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDocs,
  getDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  Trip, Checklist, ChecklistItem, Template, Amenity, Store, CatalogItem,
  GroceryList, GroceryItem, UserIdentity
} from '@/types'

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
  return deleteDoc(doc(db, 'trips', id))
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

// ── Create trip from templates + suggestions ───────────────────────────────────

export async function createTripWithChecklists(
  tripData: Omit<Trip, 'id'>,
  templates: Template[],
  catalog: CatalogItem[],
  amenityIds: string[],
  identity: UserIdentity
): Promise<string> {
  const tripRef = await addDoc(collection(db, 'trips'), {
    ...tripData,
    createdAt: serverTimestamp(),
  })
  const tripId = tripRef.id

  const phaseOrder: Record<string, number> = {
    pre_early: 0, pre_dayof: 1, pack_down: 2, grocery: 3
  }

  const relevantTemplates = templates.filter(t => t.category === 'camping')
  relevantTemplates.sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase])

  for (const template of relevantTemplates) {
    const clRef = await addDoc(collection(db, 'trips', tripId, 'checklists'), {
      tripId,
      name: template.name,
      phase: template.phase,
      order: phaseOrder[template.phase],
    })
    const clId = clRef.id

    const suggestedItems = suggestItemsForTrip(catalog, amenityIds, template)

    const batch = writeBatch(db)
    suggestedItems.forEach((item, idx) => {
      const itemRef = doc(collection(db, 'trips', tripId, 'checklists', clId, 'items'))
      batch.set(itemRef, {
        tripId,
        checklistId: clId,
        catalogItemId: item.id,
        name: item.name,
        qty: '',
        checked: false,
        order: idx,
        rev: 1,
        baseRev: 0,
        updatedBy: identity,
        updatedAt: new Date().toISOString(),
      })
    })
    await batch.commit()
  }

  return tripId
}

function suggestItemsForTrip(
  catalog: CatalogItem[],
  amenityIds: string[],
  template: Template
): CatalogItem[] {
  const templateItemIds = new Set(template.items.map(i => i.catalogItemId))
  const result: CatalogItem[] = []

  for (const templateItem of template.items) {
    const catalogItem = catalog.find(c => c.id === templateItem.catalogItemId)
    if (catalogItem) result.push(catalogItem)
  }

  for (const item of catalog) {
    if (templateItemIds.has(item.id)) continue
    if (item.category !== 'camping') continue
    const score = computeAmenityScore(item, amenityIds)
    if (score >= 0.6) result.push(item)
  }

  return result
}

function computeAmenityScore(item: CatalogItem, amenityIds: string[]): number {
  if (!amenityIds.length || !item.stats) return 0
  let totalScore = 0
  for (const amenityId of amenityIds) {
    const count = item.stats.byAmenity?.[amenityId] ?? 0
    const total = item.stats.totalUsed ?? 0
    if (total > 0) totalScore += count / total
  }
  return totalScore / amenityIds.length
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

export { toDate }
