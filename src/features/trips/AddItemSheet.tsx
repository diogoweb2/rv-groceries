import { useState, useMemo } from 'react'
import { useCatalog, useStores, useChecklistItems } from '@/hooks/useFirestore'
import { addItem, ensureCatalogItem } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Sheet } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Plus } from 'lucide-react'
import type { CatalogItem } from '@/types'

interface Props {
  tripId: string
  checklistId: string
  onClose: () => void
}

export function AddItemSheet({ tripId, checklistId, onClose }: Props) {
  const identity = useAppStore(s => s.identity)!
  const catalog = useCatalog()
  const stores = useStores()
  const existingItems = useChecklistItems(tripId, checklistId)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

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

  async function addCatalogItem(item: CatalogItem) {
    setSaving(true)
    await addItem(tripId, checklistId, {
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
    setSaving(false)
    setQuery('')
  }

  async function addCustomItem() {
    const name = query.trim()
    if (!name) return
    setSaving(true)
    await addItem(tripId, checklistId, {
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
    setSaving(false)
    setQuery('')
  }

  const hasExact = catalog.some(c => c.name.toLowerCase() === query.toLowerCase().trim())

  function handleEnter() {
    const q = query.trim()
    if (!q || saving) return
    const exact = catalog.find(c => c.name.toLowerCase() === q.toLowerCase())
    if (exact) addCatalogItem(exact)
    else addCustomItem()
  }

  return (
    <Sheet open onClose={onClose} title="Add item">
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
