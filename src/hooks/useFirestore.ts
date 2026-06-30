import { useState, useEffect } from 'react'
import {
  subscribeAmenities, subscribeStores, subscribeCatalog,
  subscribePinnedChecklists, subscribeTrips, subscribeChecklists,
  subscribeItems, subscribeGroceryLists, subscribeGroceryItems,
  subscribeOrdering, DEFAULT_PHASE_ORDER,
} from '@/lib/firestore'
import type {
  Amenity, Store, CatalogItem, PinnedChecklist, Trip,
  Checklist, ChecklistItem, GroceryList, GroceryItem, OrderingPrefs,
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

export function useGroceryItems(listId: string | undefined) {
  const [data, setData] = useState<GroceryItem[]>([])
  useEffect(() => {
    if (!listId) return
    return subscribeGroceryItems(listId, setData)
  }, [listId])
  return data
}
