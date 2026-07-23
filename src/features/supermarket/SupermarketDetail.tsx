import { useState, useEffect, useRef, useMemo } from 'react'
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
  addSupermarketItem, updateSupermarketItem, addAnywhereSupermarketItem,
  setSupermarketItemChecked, setSupermarketItemQty, setSupermarketItemForCamping,
  setSupermarketItemName,
  completeSupermarketList, ensureCatalogItem, deleteSupermarketItemAndPropagate,
  parseCampingFlag, storeLabel, sortedByMemory, learnSupermarketOrder,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ArrowLeft, CheckCheck, Plus, Minus, GripVertical, Trash2, MoreVertical, Globe } from 'lucide-react'
import { AddSupermarketItemSheet } from './AddSupermarketItemSheet'
import { RvIcon } from '@/components/RvIcon'
import type { SupermarketItem } from '@/types'
import { useOverflowMenu } from '@/hooks/useOverflowMenu'

// Distance (px) the row must be swiped right before releasing deletes it.
const SWIPE_DELETE_THRESHOLD = 96

// How long the bought-item shopping-cart ride runs before the row sinks.
const CART_RIDE_MS = 900

function SortableItem({
  item,
  cartRide,
  onToggle,
  onRename,
  onToggleCamping,
  onChangeQty,
  onDelete,
  onRemove,
}: {
  item: SupermarketItem
  /** Play the "cart zooms across the row" bought animation. */
  cartRide: boolean
  onToggle: (item: SupermarketItem) => void
  onRename: (item: SupermarketItem) => void
  onToggleCamping: (item: SupermarketItem) => void
  onChangeQty: (item: SupermarketItem, delta: number) => void
  onDelete: (item: SupermarketItem) => void
  onRemove: (item: SupermarketItem) => void
}) {
  const qtyNum = Math.max(1, Number(item.qty) || 1)
  const { open: menuOpen, toggle: toggleMenu, close: closeMenu } = useOverflowMenu(`item-${item.id}`)
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
      {/* Outside the transformed row below: a `fixed` backdrop nested inside it
          would be sized to the row, not the viewport. It stays z-auto and first
          in DOM order so the row — and the menu it contains — paints over it. */}
      {menuOpen && <div className="fixed inset-0" onClick={closeMenu} />}
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
        className={`relative flex items-center gap-3 bg-white px-4 py-3.5 transition-opacity duration-300 ${item.checked ? 'opacity-60' : ''}`}
      >
      {/* Bought celebration: a shopping cart races across the row (§8 UX). */}
      {cartRide && (
        <div className="pointer-events-none absolute inset-y-0 z-10 flex items-center animate-cart-ride">
          <span className="inline-block text-3xl animate-cart-rattle drop-shadow-md">🛒</span>
          <span className="cart-speed-lines" aria-hidden />
        </div>
      )}

      <button {...attributes} {...listeners} className="text-gray-300 touch-none">
        <GripVertical className="w-5 h-5" />
      </button>

      <button
        onClick={() => onToggle(item)}
        className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.checked ? 'bg-green-500 border-green-500 text-white animate-check-pop' : 'border-gray-300'
        }`}
        aria-label={item.checked ? 'Mark not bought' : 'Mark bought'}
      >
        {item.checked && (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Tap the name to rename the item. */}
      <button
        onClick={() => onRename(item)}
        className="flex-1 min-w-0 text-left"
      >
        <span className={`text-base transition-colors duration-300 inline-flex items-center gap-1.5 ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {item.name}
          {item.anywhereId && <Globe className="w-3.5 h-3.5 text-[#2f6b4f] shrink-0" aria-label="On all stores" />}
        </span>
        {/* Flyer deal pushed in from Smart Price: show its price and how long
            it holds (§15). Expired items are hidden/cleaned automatically. */}
        {item.sourceApp === 'smartprice' && (item.priceLabel || item.validUntil) && (
          <span className="block text-xs text-emerald-700">
            {item.priceLabel}
            {item.priceLabel && item.validUntil ? ' · ' : ''}
            {item.validUntil ? `valid until ${new Date(item.validUntil).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
          </span>
        )}
      </button>

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
          onClick={toggleMenu}
          aria-label="Item actions"
          className="p-2.5 -m-1 text-gray-300 hover:text-gray-500"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-44">
            <button
              onClick={() => { closeMenu(); onRemove(item) }}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left">Remove item</span>
            </button>
          </div>
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
  // Hide Smart Price deal items entirely — they're pushed in by the other app
  // and don't belong in the manual shopping list or its bought count (§15).
  // Also hide expired deals right away (the 4am cleanup deletes them for real);
  // bought or camping-flagged ones stay — they're wanted anyway.
  // Memoized so the reference is stable between renders — the items sync effect
  // depends on it, and a fresh array every render would loop it (setState →
  // render → new array → effect → setState …).
  const allItems = useSupermarketItems(id)
  const rawItems = useMemo(
    () => allItems.filter(
      i => i.sourceApp !== 'smartprice' &&
        !(i.validUntil && Date.parse(i.validUntil) < Date.now() && !i.checked && !i.forCamping)
    ),
    [allItems],
  )
  const catalog = useCatalog()
  const trips = useTrips()
  const stores = useStores()
  const sortMemory = useSupermarketSort()
  const identity = useAppStore(s => s.identity)!

  const [items, setItems] = useState<SupermarketItem[]>([])
  const [adding, setAdding] = useState(false)
  const [completing, setCompleting] = useState(false)
  // Item being renamed via tap-on-name, and the dialog's draft text.
  const [renaming, setRenaming] = useState<SupermarketItem | null>(null)
  const [renameText, setRenameText] = useState('')
  // Item currently playing the bought cart-ride animation. While an item rides,
  // `holdRef` pins it at its on-screen position so neither our own reorder
  // writes nor an incoming snapshot can move it mid-animation.
  const [cartRideId, setCartRideId] = useState<string | null>(null)
  const holdRef = useRef<Map<string, number>>(new Map())

  // Sync server items to local state (for drag-and-drop), keeping any
  // mid-animation item at the position it currently occupies on screen.
  useEffect(() => {
    setItems(prev => {
      const holds = holdRef.current
      const now = Date.now()
      for (const [hid, expires] of holds) if (expires < now) holds.delete(hid)
      if (holds.size === 0) return rawItems
      const next = [...rawItems]
      for (const hid of holds.keys()) {
        const prevIdx = prev.findIndex(i => i.id === hid)
        const newIdx = next.findIndex(i => i.id === hid)
        if (prevIdx >= 0 && newIdx >= 0 && prevIdx !== newIdx) {
          const [moved] = next.splice(newIdx, 1)
          next.splice(Math.min(prevIdx, next.length), 0, moved)
        }
      }
      return next
    })
  }, [rawItems])

  const list = lists.find(l => l.id === id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

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

  async function handleAdd(raw: string, anywhere: boolean) {
    const { name, forCamping } = parseCampingFlag(raw.trim())
    if (!name || !list) return
    const match = catalog.find(c => c.name.toLowerCase() === name.toLowerCase())
    // "Anywhere" items land on every active list at once and stay synced (§15).
    if (anywhere) {
      if (!match) await ensureCatalogItem(catalog, name, 'grocery')
      await addAnywhereSupermarketItem(lists, { name, catalogItemId: match?.id, forCamping }, identity)
      return
    }
    const ref = await addSupermarketItem(
      list.id,
      { catalogItemId: match?.id, name, qty: '1', checked: false, order: items.length },
      identity,
    )
    // Register new names so supermarket autocomplete learns them.
    if (!match) await ensureCatalogItem(catalog, name, 'grocery')
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
    // Flip the check locally right away so the feedback plays where the user
    // tapped; a newly bought row sinks to the bottom only after the cart ride.
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, checked: nowChecked } : i)))
    if (nowChecked) {
      // Pin the row in place and run the cart across it, then sink it.
      holdRef.current.set(item.id, Date.now() + CART_RIDE_MS + 300)
      setCartRideId(item.id)
      const oldIndex = items.findIndex(i => i.id === item.id)
      const reordered = arrayMove(items, oldIndex, items.length - 1)
      window.setTimeout(() => {
        setCartRideId(cur => (cur === item.id ? null : cur))
        holdRef.current.delete(item.id)
        setItems(prev => {
          const idx = prev.findIndex(i => i.id === item.id)
          return idx < 0 ? prev : arrayMove(prev, idx, prev.length - 1)
        })
      }, CART_RIDE_MS)
      // Write the check first so the earliest snapshot already carries it (the
      // sibling order updates can trickle in after). A camping-flagged item
      // joins the trip's Bring to Truck list here (§8).
      await setSupermarketItemChecked(list!, item, true, identity, trips, { order: reordered.length - 1 })
      for (let i = 0; i < reordered.length; i++) {
        const it = reordered[i]
        if (it.id === item.id || it.order === i) continue
        await updateSupermarketItem(list!.id, it.id, { order: i }, identity, it.rev)
      }
    } else {
      await setSupermarketItemChecked(list!, item, false, identity, trips)
    }
  }

  function startRename(item: SupermarketItem) {
    setRenameText(item.name)
    setRenaming(item)
  }

  async function handleRenameSave() {
    const target = renaming
    const name = renameText.trim()
    setRenaming(null)
    if (!target || !name || name === target.name) return
    // Reflect the rename locally right away; the write propagates it to a
    // live-linked trip item too (§8/§15).
    setItems(prev => prev.map(i => (i.id === target.id ? { ...i, name } : i)))
    await setSupermarketItemName(list!, target, name, identity)
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

      {/* Drag-sortable items */}
      <div className="flex-1 overflow-y-auto pb-8">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {items.map(item => (
              <SortableItem
                key={item.id}
                item={item}
                cartRide={cartRideId === item.id}
                onToggle={toggleBought}
                onRename={startRename}
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

        {/* Primary action, same as a trip checklist's "+ Add item" row */}
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 w-full bg-white border-b border-gray-100 px-4 py-3 text-sm text-[#2f6b4f] font-medium hover:bg-emerald-50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add item
        </button>
      </div>

      {/* Rename dialog (tap on an item's name) */}
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title="Edit item">
        <div className="flex flex-col gap-4">
          <Input
            value={renameText}
            onChange={e => setRenameText(e.target.value)}
            placeholder="Item name"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleRenameSave()}
          />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button className="flex-1" onClick={handleRenameSave} disabled={!renameText.trim()}>Save</Button>
          </div>
        </div>
      </Dialog>

      {adding && (
        <AddSupermarketItemSheet
          storeName={storeLabel(stores, list)}
          items={items}
          onAdd={handleAdd}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}
