import { useState, useMemo } from 'react'
import { useCatalog, useStores, useChecklistItems, useTrips } from '@/hooks/useFirestore'
import { addItem, ensureCatalogItem, mirrorGroceryItemToSupermarket, setItemPersist, setItemBringBack } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Plus, Pin, Undo2 } from 'lucide-react'
import type { CatalogItem, Checklist, ChecklistItem } from '@/types'

interface Props {
  tripId: string
  checklist: Checklist
  onClose: () => void
}

export function AddItemSheet({ tripId, checklist, onClose }: Props) {
  const checklistId = checklist.id
  const identity = useAppStore(s => s.identity)!
  const catalog = useCatalog()
  const stores = useStores()
  const trips = useTrips()
  const existingItems = useChecklistItems(tripId, checklistId)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  // After an item is added, a second step asks whether to flag it "bring every
  // trip" (§12) or "bring back" (§18), so the user can set these without
  // opening the list afterward.
  const [pending, setPending] = useState<{ id: string; name: string; catalogItemId?: string } | null>(null)
  const canBringBack = checklist.phase !== 'pack_down'

  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const existingNames = new Set(existingItems.map(i => i.name.toLowerCase()))

  const suggestions = useMemo(() => {
    const q = query.toLowerCase().trim()
    const seen = new Set<string>()
    return catalog
      .filter(item => !existingNames.has(item.name.toLowerCase()))
      .filter(item => !q || item.name.toLowerCase().includes(q))
      .sort((a, b) => (b.stats?.totalUsed ?? 0) - (a.stats?.totalUsed ?? 0))
      .filter(item => {
        const key = item.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 20)
  }, [catalog, query, existingNames])

  // Step 2: apply the chosen flag (§12/§18) to the just-added item, then return
  // to search for the next one.
  async function applyPendingFlag(flag: 'persist' | 'bringBack' | 'skip') {
    if (pending && flag !== 'skip') {
      const newItem = {
        id: pending.id, checklistId, tripId, name: pending.name, catalogItemId: pending.catalogItemId,
        qty: '', checked: false, order: existingItems.length, rev: 1,
      } as ChecklistItem
      if (flag === 'persist') await setItemPersist(tripId, checklist, newItem, true, identity)
      else await setItemBringBack(tripId, checklist, newItem, true, identity)
    }
    setPending(null)
  }

  async function addCatalogItem(item: CatalogItem) {
    setSaving(true)
    const ref = await addItem(tripId, checklistId, {
      catalogItemId: item.id,
      name: item.name,
      qty: '',
      storeId: item.defaultStoreId,
      checked: false,
      order: existingItems.length,
      rev: 1,
      baseRev: 0,
      updatedBy: identity,
      updatedAt: new Date().toISOString(),
    }, identity)
    // A store-linked grocery checklist also lives in Supermarket (§8) — mirror
    // this item there when the trip is next/active.
    await mirrorGroceryItemToSupermarket(
      tripId, checklist, ref.id, { name: item.name, catalogItemId: item.id, qty: '', checked: false }, trips, identity,
    )
    setSaving(false)
    setQuery('')
    setPending({ id: ref.id, name: item.name, catalogItemId: item.id })
  }

  async function addCustomItem() {
    const name = query.trim()
    if (!name) return
    setSaving(true)
    const ref = await addItem(tripId, checklistId, {
      name,
      qty: '',
      checked: false,
      order: existingItems.length,
      rev: 1,
      baseRev: 0,
      updatedBy: identity,
      updatedAt: new Date().toISOString(),
    }, identity)
    // Remember it globally for future autocomplete.
    await ensureCatalogItem(catalog, name, 'camping')
    await mirrorGroceryItemToSupermarket(
      tripId, checklist, ref.id, { name, qty: '', checked: false }, trips, identity,
    )
    setSaving(false)
    setQuery('')
    setPending({ id: ref.id, name })
  }

  const hasExact = catalog.some(c => c.name.toLowerCase() === query.toLowerCase().trim())

  function handleEnter() {
    const q = query.trim()
    if (!q || saving) return
    const exact = catalog.find(c => c.name.toLowerCase() === q.toLowerCase())
    if (exact) addCatalogItem(exact)
    else addCustomItem()
  }

  // Step 2 — after an item is added, ask how it should recur.
  if (pending) {
    return (
      <Sheet open onClose={onClose} title={`Add to ${checklist.name}`}>
        <div className="p-5 flex flex-col gap-4">
          <p className="text-center text-gray-500 text-sm">
            Added <strong className="text-gray-800">{pending.name}</strong>
          </p>
          <button
            onClick={() => applyPendingFlag('persist')}
            className="flex items-center gap-3 w-full rounded-2xl border-2 border-gray-200 px-4 py-4 text-left hover:border-[#2f6b4f] hover:bg-emerald-50 transition-colors"
          >
            <Pin className="w-6 h-6 text-[#2f6b4f] shrink-0" />
            <span className="flex flex-col">
              <span className="text-base font-semibold text-gray-800">Bring every trip</span>
              <span className="text-xs text-gray-500">Auto-add it to every future trip until packed</span>
            </span>
          </button>
          {canBringBack && (
            <button
              onClick={() => applyPendingFlag('bringBack')}
              className="flex items-center gap-3 w-full rounded-2xl border-2 border-gray-200 px-4 py-4 text-left hover:border-[#2f6b4f] hover:bg-emerald-50 transition-colors"
            >
              <Undo2 className="w-6 h-6 text-[#2f6b4f] shrink-0" />
              <span className="flex flex-col">
                <span className="text-base font-semibold text-gray-800">Bring back</span>
                <span className="text-xs text-gray-500">Move to "Pack down / return" once checked off</span>
              </span>
            </button>
          )}
          <Button variant="secondary" size="lg" className="w-full" onClick={() => applyPendingFlag('skip')}>
            SKIP
          </Button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open onClose={onClose} title={`Add to ${checklist.name}`}>
      <div className="p-4 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleEnter()}
            placeholder="Search or type new item..."
            className="pl-9"
            autoFocus
          />
        </div>
      </div>

      <div className="flex flex-col">
        {/* Add custom if typed something not in catalog */}
        {query.trim() && !hasExact && (
          <button
            onClick={addCustomItem}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50"
          >
            <div className="w-8 h-8 rounded-full bg-[#2f6b4f] flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-white" />
            </div>
            <span className="text-base text-gray-800">Add "<strong>{query.trim()}</strong>"</span>
          </button>
        )}

        {/* Catalog suggestions */}
        {suggestions.map(item => (
          <button
            key={item.id}
            onClick={() => addCatalogItem(item)}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 text-left"
          >
            <div className="flex-1 min-w-0">
              <p className="text-base text-gray-800">{item.name}</p>
              {item.defaultStoreId && (
                <p className="text-xs text-gray-400">{storeMap[item.defaultStoreId]}</p>
              )}
            </div>
            {item.stats?.totalUsed > 0 && (
              <span className="text-xs text-gray-400">×{item.stats.totalUsed}</span>
            )}
          </button>
        ))}

        {suggestions.length === 0 && !query.trim() && (
          <p className="text-center text-gray-400 text-sm py-8">
            Type to search the item catalog
          </p>
        )}
      </div>

      <div className="p-4">
        <Button variant="secondary" size="lg" className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Sheet>
  )
}
