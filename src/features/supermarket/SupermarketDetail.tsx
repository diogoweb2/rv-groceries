import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSupermarketLists, useSupermarketItems, useCatalog, useTrips } from '@/hooks/useFirestore'
import {
  addSupermarketItem, updateSupermarketItem, deleteSupermarketItem,
  completeSupermarketList, moveCampingItemToNextTrip, ensureCatalogItem,
  parseCampingFlag, supermarketStoreLabel,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, CheckCheck, Trash2, Plus, Tent } from 'lucide-react'
import type { SupermarketItem } from '@/types'

export function SupermarketDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lists = useSupermarketLists()
  const items = useSupermarketItems(id)
  const catalog = useCatalog()
  const trips = useTrips()
  const identity = useAppStore(s => s.identity)!

  const [query, setQuery] = useState('')
  const [completing, setCompleting] = useState(false)

  const list = lists.find(l => l.id === id)

  // Suggest supermarket (grocery/general) catalog items only — never camping.
  const parsed = parseCampingFlag(query)
  const existingNames = new Set(items.map(i => i.name.toLowerCase()))
  const seen = new Set<string>()
  const suggestions = parsed.name
    ? catalog
        .filter(c => c.category === 'grocery' || c.category === 'general')
        .filter(c => c.name.toLowerCase().includes(parsed.name.toLowerCase()))
        .filter(c => !existingNames.has(c.name.toLowerCase()))
        .sort((a, b) => (b.stats?.totalGrocery ?? 0) - (a.stats?.totalGrocery ?? 0))
        .filter(c => {
          const key = c.name.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 6)
    : []

  async function moveToRV(item: { name: string; catalogItemId?: string; qty?: string }) {
    await moveCampingItemToNextTrip(item, trips, identity)
  }

  async function handleAdd(explicitName?: string) {
    const { name, forCamping } = parseCampingFlag((explicitName ?? query).trim())
    if (!name || !list) return
    const match = catalog.find(c => c.name.toLowerCase() === name.toLowerCase())
    await addSupermarketItem(
      list.id,
      {
        catalogItemId: match?.id,
        name,
        qty: '',
        forCamping: forCamping || undefined,
        checked: false,
        order: items.length,
      },
      identity,
    )
    // Register new names so supermarket autocomplete learns them.
    if (!match) await ensureCatalogItem(catalog, name, 'grocery')
    setQuery('')
  }

  async function toggleBought(item: SupermarketItem) {
    const nowChecked = !item.checked
    await updateSupermarketItem(list!.id, item.id, { checked: nowChecked }, identity, item.rev)
    if (nowChecked && item.forCamping) {
      await moveToRV({ name: item.name, catalogItemId: item.catalogItemId, qty: item.qty })
    }
  }

  async function toggleCamping(item: SupermarketItem) {
    const next = !item.forCamping
    await updateSupermarketItem(list!.id, item.id, { forCamping: next }, identity, item.rev)
    if (next && item.checked) {
      await moveToRV({ name: item.name, catalogItemId: item.catalogItemId, qty: item.qty })
    }
  }

  async function handleComplete() {
    if (!list) return
    const missed = items.filter(i => !i.checked).length
    const msg = missed === 0
      ? 'Mark this list complete? The other person will be notified you got everything.'
      : `Mark complete with ${missed} item(s) not bought? The other person will be notified what you missed.`
    if (!confirm(msg)) return
    setCompleting(true)
    await completeSupermarketList(list, items, identity)
    setCompleting(false)
    navigate('/supermarket')
  }

  if (!list) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <p className="text-gray-400">List not found</p>
      </div>
    )
  }

  const bought = items.filter(i => i.checked).length

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/supermarket')} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{supermarketStoreLabel(list.store)}</h1>
            <p className="text-sm text-gray-500">{bought}/{items.length} bought</p>
          </div>
          <Button
            onClick={handleComplete}
            disabled={completing || items.length === 0}
            className="bg-[#2f6b4f] hover:bg-[#255a41] gap-2"
          >
            <CheckCheck className="w-4 h-4" /> COMPLETE
          </Button>
        </div>
      </div>

      {/* Add item bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex gap-2 px-4 py-3">
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Add item…  (tip: Milk -> camping)"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1"
          />
          <button
            onClick={() => handleAdd()}
            disabled={!parsed.name}
            className="bg-[#2f6b4f] text-white rounded-xl px-3 disabled:opacity-40"
            aria-label="Add item"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        {parsed.forCamping && (
          <p className="px-4 pb-2 text-xs text-[#2f6b4f] flex items-center gap-1">
            <Tent className="w-3.5 h-3.5" /> “{parsed.name}” will be flagged for camping
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {suggestions.map(c => (
              <button
                key={c.id}
                onClick={() => handleAdd(c.name)}
                className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-sm hover:bg-gray-200"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto pb-8">
        {items.map(item => (
          <div
            key={item.id}
            className={`flex items-center gap-3 bg-white border-b border-gray-50 px-4 py-3.5 ${item.checked ? 'opacity-60' : ''}`}
          >
            <button
              onClick={() => toggleBought(item)}
              className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                item.checked ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'
              }`}
              aria-label={item.checked ? 'Mark not bought' : 'Mark bought'}
            >
              {item.checked && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            <div className="flex-1 min-w-0">
              <span className={`text-base ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                {item.name}
              </span>
              {item.qty && <span className="text-sm text-gray-500 ml-1">× {item.qty}</span>}
            </div>

            <button
              onClick={() => toggleCamping(item)}
              className={`p-1.5 rounded-lg shrink-0 transition-colors ${
                item.forCamping ? 'bg-emerald-50 text-[#2f6b4f]' : 'text-gray-300 hover:text-gray-500'
              }`}
              aria-label={item.forCamping ? 'Remove camping flag' : 'Flag for camping'}
              title="For camping"
            >
              <Tent className="w-4 h-4" />
            </button>

            <button
              onClick={() => deleteSupermarketItem(list.id, item.id)}
              className="text-gray-300 hover:text-red-400 p-1 shrink-0"
              aria-label="Delete item"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No items yet</p>
        )}
      </div>
    </div>
  )
}
