import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useSupermarketLists, useSupermarketItems, useCatalog, useTrips, useSupermarketSort, useStores } from '@/hooks/useFirestore'
import {
  addSupermarketItem, updateSupermarketItem, deleteSupermarketItemAndPropagate,
  setSupermarketItemChecked, setSupermarketItemQty, linkSupermarketItemToTrip, unlinkSupermarketItemFromTrip,
  completeSupermarketList, ensureCatalogItem,
  parseCampingFlag, storeLabel, sortedByMemory, learnSupermarketOrder,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, CheckCheck, Trash2, Plus, Minus, Tent, GripVertical } from 'lucide-react'
import type { SupermarketItem } from '@/types'

function SortableItem({
  item,
  onToggle,
  onToggleCamping,
  onChangeQty,
  onDelete,
}: {
  item: SupermarketItem
  onToggle: (item: SupermarketItem) => void
  onToggleCamping: (item: SupermarketItem) => void
  onChangeQty: (item: SupermarketItem, delta: number) => void
  onDelete: (item: SupermarketItem) => void
}) {
  const qtyNum = Math.max(1, Number(item.qty) || 1)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 bg-white border-b border-gray-50 px-4 py-3.5 ${item.checked ? 'opacity-60' : ''}`}
    >
      <button {...attributes} {...listeners} className="text-gray-300 touch-none">
        <GripVertical className="w-5 h-5" />
      </button>

      <button
        onClick={() => onToggle(item)}
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
      </div>

      {/* Quantity stepper */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onChangeQty(item, -1)}
          disabled={qtyNum <= 1}
          className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 disabled:opacity-30 active:bg-gray-100"
          aria-label="Decrease quantity"
        >
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-5 text-center text-sm font-medium text-gray-700">{qtyNum}</span>
        <button
          onClick={() => onChangeQty(item, 1)}
          className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 active:bg-gray-100"
          aria-label="Increase quantity"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={() => onToggleCamping(item)}
        className={`p-1.5 rounded-lg shrink-0 transition-colors ${
          item.forCamping ? 'bg-emerald-50 text-[#2f6b4f]' : 'text-gray-300 hover:text-gray-500'
        }`}
        aria-label={item.forCamping ? 'Remove camping flag' : 'Flag for camping'}
        title="For camping"
      >
        <Tent className="w-4 h-4" />
      </button>

      <button
        onClick={() => onDelete(item)}
        className="text-gray-300 hover:text-red-400 p-1 shrink-0"
        aria-label="Delete item"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

export function SupermarketDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lists = useSupermarketLists()
  const rawItems = useSupermarketItems(id)
  const catalog = useCatalog()
  const trips = useTrips()
  const stores = useStores()
  const sortMemory = useSupermarketSort()
  const identity = useAppStore(s => s.identity)!

  const [items, setItems] = useState<SupermarketItem[]>([])
  const [query, setQuery] = useState('')
  const [completing, setCompleting] = useState(false)

  // Sync server items to local state (for drag-and-drop)
  useEffect(() => { setItems(rawItems) }, [rawItems])

  const list = lists.find(l => l.id === id)
  const store = stores.find(s => s.id === list?.storeId)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  // Persist the given items in the learned order (§16): re-index every item
  // whose position changed and reflect it locally right away.
  async function applySortedOrder(current: SupermarketItem[]) {
    if (!list) return
    const sorted = sortedByMemory(current, sortMemory, list.storeId)
    setItems(sorted)
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i]
      if (it.order !== i) {
        await updateSupermarketItem(list.id, it.id, { order: i }, identity, it.rev)
      }
    }
  }

  async function handleAdd(explicitName?: string) {
    const { name, forCamping } = parseCampingFlag((explicitName ?? query).trim())
    if (!name || !list) return
    const match = catalog.find(c => c.name.toLowerCase() === name.toLowerCase())
    const ref = await addSupermarketItem(
      list.id,
      { catalogItemId: match?.id, name, qty: '1', checked: false, order: items.length },
      identity,
    )
    // Register new names so supermarket autocomplete learns them.
    if (!match) await ensureCatalogItem(catalog, name, 'grocery')
    setQuery('')
    // Auto-sort the list by learned order every time an item is added (§16).
    const newItem: SupermarketItem = {
      id: ref.id, listId: list.id, catalogItemId: match?.id, name, qty: '1',
      checked: false, order: items.length,
      rev: 1, baseRev: 0, updatedBy: identity, updatedAt: new Date().toISOString(),
    }
    await applySortedOrder([...items, newItem])
    // "<name> -> camping" shorthand: mirror straight into the next/active
    // trip's grocery list for this store (§15).
    if (forCamping && store) await linkSupermarketItemToTrip(list, newItem, store, trips, identity)
  }

  // Adjust an item's quantity from its row stepper (min 1). Optimistic locally.
  async function changeQty(item: SupermarketItem, delta: number) {
    const current = Math.max(1, Number(item.qty) || 1)
    const next = Math.max(1, current + delta)
    if (next === current) return
    setItems(items.map(i => (i.id === item.id ? { ...i, qty: String(next) } : i)))
    await setSupermarketItemQty(list!, item, String(next), identity)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered)
    for (let i = 0; i < reordered.length; i++) {
      const item = reordered[i]
      if (item.order !== i) {
        await updateSupermarketItem(list!.id, item.id, { order: i }, identity, item.rev)
      }
    }
    // Learn this manual ordering so future lists auto-sort to match (§16). Only
    // the deliberately-ordered (unchecked) items teach; bought ones sit at the
    // bottom by the bought-to-end rule, not by choice.
    await learnSupermarketOrder(list!.storeId, reordered.filter(i => !i.checked).map(i => i.name), sortMemory)
  }

  async function toggleBought(item: SupermarketItem) {
    const nowChecked = !item.checked
    if (nowChecked) {
      // Move the item to the end of the list once bought.
      const oldIndex = items.findIndex(i => i.id === item.id)
      const reordered = arrayMove(items, oldIndex, items.length - 1)
      setItems(reordered)
      for (let i = 0; i < reordered.length; i++) {
        const it = reordered[i]
        if (it.id === item.id || it.order === i) continue
        await updateSupermarketItem(list!.id, it.id, { order: i }, identity, it.rev)
      }
      // Propagates to the linked trip item (if any), which cascades the
      // checked → copy-to-RV rule (§8).
      await setSupermarketItemChecked(list!, item, true, identity, { order: reordered.length - 1 })
    } else {
      setItems(items.map(i => (i.id === item.id ? { ...i, checked: false } : i)))
      await setSupermarketItemChecked(list!, item, false, identity)
    }
  }

  // Tent icon: mirror this item into (or remove it from) the next/active
  // trip's grocery list for this store — the item stays live-linked
  // afterward (§8/§15).
  async function toggleCamping(item: SupermarketItem) {
    if (item.forCamping) {
      await unlinkSupermarketItemFromTrip(item, identity)
    } else if (store) {
      await linkSupermarketItemToTrip(list!, item, store, trips, identity)
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
    await completeSupermarketList(list, items, storeLabel(stores, list), identity)
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
            <h1 className="text-lg font-bold text-gray-800 truncate">{storeLabel(stores, list)}</h1>
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

      {/* Drag-sortable items */}
      <div className="flex-1 overflow-y-auto pb-8">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map(item => (
              <SortableItem
                key={item.id}
                item={item}
                onToggle={toggleBought}
                onToggleCamping={toggleCamping}
                onChangeQty={changeQty}
                onDelete={deleteSupermarketItemAndPropagate}
              />
            ))}
          </SortableContext>
        </DndContext>
        {items.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">No items yet</p>
        )}
      </div>
    </div>
  )
}
