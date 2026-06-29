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
import { useGroceryLists, useGroceryItems, useStores, useCatalog } from '@/hooks/useFirestore'
import { updateGroceryItem, deleteGroceryItem, addGroceryItem, sendGroceryList, saveSortOrder } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Send, GripVertical, Trash2, Plus, Filter } from 'lucide-react'
import type { GroceryItem } from '@/types'

function SortableItem({
  item,
  storeMap,
  onToggle,
  onDelete,
}: {
  item: GroceryItem
  storeMap: Record<string, string>
  onToggle: (item: GroceryItem) => void
  onDelete: (id: string) => void
}) {
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
        {item.storeId && <span className="text-xs text-gray-400 ml-2">{storeMap[item.storeId]}</span>}
      </div>

      <button onClick={() => onDelete(item.id)} className="text-gray-300 hover:text-red-400 p-1 shrink-0">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

export function GroceryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const lists = useGroceryLists()
  const rawItems = useGroceryItems(id)
  const stores = useStores()
  const catalog = useCatalog()
  const identity = useAppStore(s => s.identity)!

  const [items, setItems] = useState<GroceryItem[]>([])
  const [storeFilter, setStoreFilter] = useState<string>('')
  const [addQuery, setAddQuery] = useState('')
  const [sending, setSending] = useState(false)

  // Sync server items to local state (for drag-and-drop)
  useEffect(() => { setItems(rawItems) }, [rawItems])

  const list = lists.find(l => l.id === id)
  const storeMap = Object.fromEntries(stores.map(s => [s.id, s.name]))
  const isSent = list?.status === 'sent'

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const displayItems = storeFilter
    ? items.filter(i => i.storeId === storeFilter)
    : items

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex(i => i.id === active.id)
    const newIndex = items.findIndex(i => i.id === over.id)
    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered)
    // Persist new order
    for (let i = 0; i < reordered.length; i++) {
      const item = reordered[i]
      if (item.order !== i) {
        await updateGroceryItem(id!, item.id, { order: i }, identity, item.rev)
      }
    }
    // Learn sort order
    await saveSortOrder(reordered, storeFilter || undefined)
  }

  async function handleToggle(item: GroceryItem) {
    await updateGroceryItem(id!, item.id, { checked: !item.checked }, identity, item.rev)
  }

  async function handleDelete(itemId: string) {
    await deleteGroceryItem(id!, itemId)
  }

  async function handleAddItem() {
    const name = addQuery.trim()
    if (!name) return
    const match = catalog.find(c => c.name.toLowerCase() === name.toLowerCase())
    await addGroceryItem(
      id!,
      {
        catalogItemId: match?.id,
        storeId: match?.defaultStoreId,
        name,
        qty: '',
        checked: false,
        order: items.length,
        rev: 1,
        baseRev: 0,
        updatedBy: identity,
        updatedAt: new Date().toISOString(),
      },
      identity
    )
    setAddQuery('')
  }

  async function handleSend() {
    if (!confirm('Send this list?')) return
    setSending(true)
    await sendGroceryList(id!)
    setSending(false)
  }

  if (!list) return <div className="flex items-center justify-center min-h-dvh"><p className="text-gray-400">List not found</p></div>

  const checked = items.filter(i => i.checked).length

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/grocery')} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{list.title}</h1>
            <p className="text-sm text-gray-500">{checked}/{items.length} checked</p>
          </div>
          {!isSent && (
            <Button
              onClick={handleSend}
              disabled={sending || items.length === 0}
              className="bg-pink-500 hover:bg-pink-600 gap-2"
            >
              <Send className="w-4 h-4" /> SEND
            </Button>
          )}
        </div>

        {/* Store filter */}
        {stores.length > 0 && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
            <button
              onClick={() => setStoreFilter('')}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1 ${!storeFilter ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              <Filter className="w-3.5 h-3.5" /> All
            </button>
            {stores.map(s => (
              <button
                key={s.id}
                onClick={() => setStoreFilter(s.id)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${storeFilter === s.id ? 'bg-[#1e3a5f] text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add item bar */}
      {!isSent && (
        <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100">
          <Input
            value={addQuery}
            onChange={e => setAddQuery(e.target.value)}
            placeholder="Add item…"
            onKeyDown={e => e.key === 'Enter' && handleAddItem()}
            className="flex-1"
          />
          <button
            onClick={handleAddItem}
            disabled={!addQuery.trim()}
            className="bg-[#1e3a5f] text-white rounded-xl px-3 disabled:opacity-40"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Drag-sortable list */}
      <div className="flex-1 overflow-y-auto pb-8">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {displayItems.map(item => (
              <SortableItem
                key={item.id}
                item={item}
                storeMap={storeMap}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </SortableContext>
        </DndContext>
        {displayItems.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">
            {storeFilter ? 'No items for this store' : 'No items yet'}
          </p>
        )}
      </div>
    </div>
  )
}
