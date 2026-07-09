import { useState, useMemo } from 'react'
import { useCatalog, useStores, useChecklistItems, useTrips } from '@/hooks/useFirestore'
import { addItem, ensureCatalogItem, mirrorGroceryItemToSupermarket, setItemDestination } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Search, Plus } from 'lucide-react'
import { DESTINATIONS } from './destination'
import { checklistTitle } from '@/lib/checklistTitle'
import type { CatalogItem, Checklist, ChecklistItem, ItemDestination } from '@/types'

// Step 2 of adding an item (§18): pick the item's final destination. Required —
// there is no skip. (Pinning to future trips is done later, on the item row.)
const DESTINATION_HINTS: Record<ItemDestination, string> = {
  home: 'Comes camping, must come back home',
  truck: 'Stays in the truck',
  rv: 'Stays in the RV',
}

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
  // After an item is added, a second step asks for its final destination (§18).
  const [pending, setPending] = useState<{ id: string; name: string; catalogItemId?: string } | null>(null)

  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const existingNames = new Set(existingItems.map(i => i.name.toLowerCase()))

  const suggestions = useMemo(() => {
    const q = query.toLowerCase().trim()
    // Autocomplete only: no query, no list (§18).
    if (!q) return []
    const seen = new Set<string>()
    return catalog
      .filter(item => !existingNames.has(item.name.toLowerCase()))
      .filter(item => item.name.toLowerCase().includes(q))
      .sort((a, b) => (b.stats?.totalUsed ?? 0) - (a.stats?.totalUsed ?? 0))
      .filter(item => {
        const key = item.name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }, [catalog, query, existingNames])

  // Step 2: set the chosen destination on the just-added item, then return to
  // search for the next one.
  async function applyPendingDestination(destination: ItemDestination) {
    if (pending) {
      const newItem = {
        id: pending.id, checklistId, tripId, name: pending.name, catalogItemId: pending.catalogItemId,
        qty: '', checked: false, order: existingItems.length, rev: 1,
      } as ChecklistItem
      await setItemDestination(tripId, checklist, newItem, destination, identity)
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

  // Step 2 — after an item is added, ask where it finally belongs (§18).
  if (pending) {
    return (
      <Sheet open onClose={onClose} title={`Add to ${checklistTitle(checklist)}`}>
        <div className="p-5 flex flex-col gap-4">
          <p className="text-center text-gray-500 text-sm">
            Added <strong className="text-gray-800">{pending.name}</strong> — where does it belong after the trip?
          </p>
          {DESTINATIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => applyPendingDestination(opt.value)}
              className="flex items-center gap-3 w-full rounded-2xl border-2 border-gray-200 px-4 py-4 text-left hover:border-[#2f6b4f] hover:bg-emerald-50 transition-colors"
            >
              <opt.icon className="w-6 h-6 text-[#2f6b4f] shrink-0" />
              <span className="flex flex-col">
                <span className="text-base font-semibold text-gray-800">{opt.label}</span>
                <span className="text-xs text-gray-500">{DESTINATION_HINTS[opt.value]}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open onClose={onClose} title={`Add to ${checklistTitle(checklist)}`}>
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
        {/* Catalog suggestions first — reusing a known item is the common case,
            typing a brand-new name is the fallback below. */}
        {suggestions.map(item => (
          <button
            key={item.id}
            onClick={() => addCatalogItem(item)}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 hover:bg-gray-50 text-left"
          >
            <div className="w-8 h-8 rounded-full bg-[#2f6b4f] flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-white" />
            </div>
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

        {/* Add custom if typed something not in catalog */}
        {query.trim() && !hasExact && (
          <button
            onClick={addCustomItem}
            disabled={saving}
            className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50"
          >
            <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-gray-400" />
            </div>
            <span className="text-base text-gray-500">Add "<strong className="text-gray-800">{query.trim()}</strong>"</span>
          </button>
        )}

        {suggestions.length === 0 && !query.trim() && (
          <p className="text-center text-gray-400 text-sm py-8">
            Type to search the item catalog
          </p>
        )}
      </div>
    </Sheet>
  )
}
