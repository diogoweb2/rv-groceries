import { useState, useEffect } from 'react'
import {
  subscribeAmenities, subscribeStores, subscribeCatalog,
  subscribePinnedChecklists, subscribeTrips, subscribeChecklists,
  subscribeItems, subscribeGroceryLists, subscribeGroceryItems,
  subscribeOrdering, DEFAULT_PHASE_ORDER, subscribeTemplates,
  subscribeSupermarketLists, subscribeSupermarketItems, subscribeNotifications,
  subscribeSupermarketSort, subscribeFeedback, subscribeProcedures,
} from '@/lib/firestore'
import type {
  Amenity, Store, CatalogItem, PinnedChecklist, Trip,
  Checklist, ChecklistItem, GroceryList, GroceryItem, OrderingPrefs, Template,
  SupermarketList, SupermarketItem, SupermarketSortMemory, AppNotification, UserIdentity,
  Feedback, Procedure,
} from '@/types'

export function useAmenities() {
  const [data, setData] = useState<Amenity[]>([])
  useEffect(() => subscribeAmenities(setData), [])
  return data
}

export function useStores() {
  const [data, setData] = useState<Store[]>([])
  useEffect(() => subscribeStores(setData), [])
  return data
}

export function useCatalog() {
  const [data, setData] = useState<CatalogItem[]>([])
  useEffect(() => subscribeCatalog(setData), [])
  return data
}

export function usePinnedChecklists() {
  const [data, setData] = useState<PinnedChecklist[]>([])
  useEffect(() => subscribePinnedChecklists(setData), [])
  return data
}

export function useTrips() {
  const [data, setData] = useState<Trip[]>([])
  useEffect(() => subscribeTrips(setData), [])
  return data
}

export function useChecklists(tripId: string | undefined) {
  const [data, setData] = useState<Checklist[]>([])
  useEffect(() => {
    if (!tripId) return
    return subscribeChecklists(tripId, setData)
  }, [tripId])
  return data
}

export function useChecklistItems(tripId: string | undefined, checklistId: string | undefined) {
  const [data, setData] = useState<ChecklistItem[]>([])
  useEffect(() => {
    if (!tripId || !checklistId) return
    return subscribeItems(tripId, checklistId, setData)
  }, [tripId, checklistId])
  return data
}

export function useOrdering() {
  const [data, setData] = useState<OrderingPrefs>({ phaseOrder: DEFAULT_PHASE_ORDER, checklistOrder: {} })
  useEffect(() => subscribeOrdering(setData), [])
  return data
}

export function useGroceryLists() {
  const [data, setData] = useState<GroceryList[]>([])
  useEffect(() => subscribeGroceryLists(setData), [])
  return data
}

export function useTemplates() {
  const [data, setData] = useState<Template[]>([])
  useEffect(() => subscribeTemplates(setData), [])
  return data
}

export function useGroceryItems(listId: string | undefined) {
  const [data, setData] = useState<GroceryItem[]>([])
  useEffect(() => {
    if (!listId) return
    return subscribeGroceryItems(listId, setData)
  }, [listId])
  return data
}

export function useSupermarketLists() {
  const [data, setData] = useState<SupermarketList[]>([])
  useEffect(() => subscribeSupermarketLists(setData), [])
  return data
}

export function useSupermarketItems(listId: string | undefined) {
  const [data, setData] = useState<SupermarketItem[]>([])
  useEffect(() => {
    if (!listId) return
    return subscribeSupermarketItems(listId, setData)
  }, [listId])
  return data
}

/**
 * How many distinct things are still left to buy across every active list.
 * The same item on two stores' lists counts once, so the number matches what
 * the shopper thinks of as "things to buy", not rows on screen.
 */
export function useSupermarketPendingCount() {
  const lists = useSupermarketLists()
  const [byList, setByList] = useState<Record<string, SupermarketItem[]>>({})

  const activeIds = lists.filter(l => l.status === 'active').map(l => l.id)
  const key = activeIds.join(',')

  useEffect(() => {
    const ids = key ? key.split(',') : []
    const unsubs = ids.map(id =>
      subscribeSupermarketItems(id, items => setByList(prev => ({ ...prev, [id]: items })))
    )
    // Drop lists that are no longer active so their items stop being counted.
    setByList(prev => Object.fromEntries(ids.map(id => [id, prev[id] ?? []])))
    return () => unsubs.forEach(u => u())
  }, [key])

  const names = new Set<string>()
  for (const items of Object.values(byList)) {
    for (const item of items) {
      if (!item.checked) names.add(item.name.trim().toLowerCase())
    }
  }
  return names.size
}

export function useSupermarketSort() {
  const [data, setData] = useState<SupermarketSortMemory>({ stores: {} })
  useEffect(() => subscribeSupermarketSort(setData), [])
  return data
}

export function useProcedures() {
  const [data, setData] = useState<Procedure[]>([])
  useEffect(() => subscribeProcedures(setData), [])
  return data
}

export function useFeedback() {
  const [data, setData] = useState<Feedback[]>([])
  useEffect(() => subscribeFeedback(setData), [])
  return data
}

export function useNotifications(identity: UserIdentity | null) {
  const [data, setData] = useState<AppNotification[]>([])
  useEffect(() => {
    if (!identity) return
    return subscribeNotifications(identity, setData)
  }, [identity])
  return data
}
