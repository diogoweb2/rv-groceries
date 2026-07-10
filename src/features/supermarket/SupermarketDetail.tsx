import { useState, useEffect, useRef } from 'react'
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
  addSupermarketItem, updateSupermarketItem,
  setSupermarketItemChecked, setSupermarketItemQty, setSupermarketItemForCamping,
  completeSupermarketList, ensureCatalogItem, deleteSupermarketItemAndPropagate,
  parseCampingFlag, storeLabel, sortedByMemory, learnSupermarketOrder,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, CheckCheck, Plus, Minus, GripVertical, Trash2, MoreVertical } from 'lucide-react'
import { RvIcon } from '@/components/RvIcon'
import type { SupermarketItem } from '@/types'

// Distance (px) the row must be swiped right before releasing deletes it.
const SWIPE_DELETE_THRESHOLD = 96

function SortableItem({
  item,
  onToggle,
  onToggleCamping,
  onChangeQty,
  onDelete,
  onRemove,
}: {
  item: SupermarketItem
  onToggle: (item: SupermarketItem) => void
  onToggleCamping: (item: SupermarketItem) => void
  onChangeQty: (item: SupermarketItem, delta: number) => void
  onDelete: (item: SupermarketItem) => void
  onRemove: (item: SupermarketItem) => void
}) {
  const qtyNum = Math.max(1, Number(item.qty) || 1)
  const [menuOpen, setMenuOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })

  // Horizontal swipe-to-delete. Tracked separately from the vertical drag
  // reorder (which lives on the grip handle) so the two never fight.
  const [dx, setDx] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const locked = useRef<'h' | 'v' | null>(null)
  const dxRef = useRef(0)

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY }
    locked.current = null
    dxRef.current = 0
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return
    const deltaX = e.clientX - start.current.x
    const deltaY = e.clientY - start.current.y
    if (!locked.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      locked.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'h' : 'v'
      if (locked.current === 'h') {
        setSwiping(true)
        // Keep receiving moves even if the cursor leaves the row.
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
      }
    }
    if (locked.current !== 'h') return
    e.preventDefault()
    const next = Math.max(0, deltaX) // only reveal on right-swipe
    dxRef.current = next
    setDx(next)
  }
  function onPointerEnd() {
    if (locked.current === 'h' && dxRef.current >= SWIPE_DELETE_THRESHOLD) {
      onDelete(item)
      return
    }
    start.current = null
    locked.current = null
    dxRef.current = 0
    setSwiping(false)
    setDx(0)
  }

  const willDelete = dx >= SWIPE_DELETE_THRESHOLD
  const rowStyle = {
    transform: `${CSS.Transform.toString(transform) ?? ''} translateX(${dx}px)`.trim(),
    transition: swiping ? 'none' : transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} className={`relative border-b border-gray-50 ${menuOpen ? 'z-30' : ''}`}>
      {/* Delete affordance revealed as the row slides right. */}
      <div
        className={`absolute inset-y-0 left-0 flex items-center gap-2 px-4 text-white transition-colors ${
          willDelete ? 'bg-red-600' : 'bg-red-400'
        }`}
        style={{ width: Math.max(dx, 0) }}
      >
        <Trash2 className="w-5 h-5 shrink-0" />
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        style={{ ...rowStyle, touchAction: 'pan-y' }}
        className={`relative flex items-center gap-3 bg-white px-4 py-3.5 ${item.checked ? 'opacity-60' : ''}`}
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
        className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center transition-colors ${
          item.forCamping ? 'bg-emerald-50' : ''
        }`}
        aria-label={item.forCamping ? 'Remove camping flag' : 'Flag for camping'}
        title="For camping"
      >
        <RvIcon className="w-7 h-7" active={!!item.forCamping} />
      </button>

      {/* Item overflow menu */}
      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen(v => !v)}
          aria-label="Item actions"
          className="p-2.5 -m-1 text-gray-300 hover:text-gray-500"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-44">
              <button
                onClick={() => { setMenuOpen(false); onRemove(item) }}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">Remove item</span>
              </button>
            </div>
          </>
        )}
      </div>
      </div>
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
    // "<name> -> camping" shorthand: flag it now; it reaches the trip's
    // "Bring to Truck" list once bought (§15).
    if (forCamping) await setSupermarketItemForCamping(list, newItem, true, trips, identity)
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
      // A camping-flagged item joins the trip's Bring to Truck list here (§8).
      await setSupermarketItemChecked(list!, item, true, identity, trips, { order: reordered.length - 1 })
    } else {
      setItems(items.map(i => (i.id === item.id ? { ...i, checked: false } : i)))
      await setSupermarketItemChecked(list!, item, false, identity, trips)
    }
  }

  // Tent icon: mark the item as destined for camping. It only reaches the trip's
  // "Bring to Truck" list once it's also bought (§8/§15).
  async function toggleCamping(item: SupermarketItem) {
    // Reflect the pin locally right away — the Firestore link/unlink round-trip
    // is slow, so waiting for the subscription made the toggle feel ~3s laggy.
    setItems(items.map(i => (i.id === item.id ? { ...i, forCamping: !item.forCamping } : i)))
    await setSupermarketItemForCamping(list!, item, !item.forCamping, trips, identity)
  }

  // Removes the item and, if it's live-linked to a trip item, that copy
  // too (§8/§15). Reached by swipe-right or the row's "⋮" menu.
  async function handleDelete(item: SupermarketItem) {
    setItems(items.filter(i => i.id !== item.id))
    await deleteSupermarketItemAndPropagate(item)
  }

  async function handleRemove(item: SupermarketItem) {
    await handleDelete(item)
  }

  async function handleComplete() {
    if (!list) return
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
  // Only reveal COMPLETE once at least 20% of the list is checked off, so the
  // person building the list can't finish it by mistake.
  const canComplete = items.length > 0 && bought / items.length >= 0.2

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
          {canComplete && (
            <Button
              onClick={handleComplete}
              disabled={completing}
              className="bg-[#2f6b4f] hover:bg-[#255a41] gap-2"
            >
              <CheckCheck className="w-4 h-4" /> COMPLETE
            </Button>
          )}
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
            <RvIcon className="w-4 h-4" active /> “{parsed.name}” will be flagged for camping

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
                onDelete={handleDelete}
                onRemove={handleRemove}
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
