import { useState } from 'react'
import { useChecklistItems } from '@/hooks/useFirestore'
import { toggleItem, deleteItem, updateChecklist, deleteChecklist, copyItemToChecklist, setItemPersist, addPersistentItem, removePersistentItem } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Progress } from '@/components/ui/progress'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Trash2, ChevronDown, ChevronUp, MoreVertical, Pencil, GripVertical, Pin } from 'lucide-react'
import type { Checklist, ChecklistItem } from '@/types'

interface Props {
  checklist: Checklist
  tripId: string
  onAddItem: () => void
  /** When set, checking an item here also copies it to this checklist (bring-to-RV). */
  copyToOnCheck?: string
  /** Drag handle attributes/listeners from the sortable wrapper. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
}

export function ChecklistCard({ checklist, tripId, onAddItem, copyToOnCheck, dragHandleProps }: Props) {
  const identity = useAppStore(s => s.identity)!
  const items = useChecklistItems(tripId, checklist.id)
  const [expanded, setExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)

  const checked = items.filter(i => i.checked).length
  const total = items.length
  const progress = total ? (checked / total) * 100 : 0

  async function handleToggle(item: ChecklistItem) {
    const nextChecked = !item.checked
    await toggleItem(tripId, checklist.id, item.id, nextChecked, identity, item.rev)
    // A persistent item only recurs while unchecked: drop it from the recurring
    // set when checked, restore it when unchecked again.
    if (item.persist) {
      if (nextChecked) {
        await removePersistentItem(checklist.phase, checklist.name, item.name)
      } else {
        await addPersistentItem(
          { name: item.name, phase: checklist.phase, checklistName: checklist.name, catalogItemId: item.catalogItemId, qty: item.qty },
          identity,
        )
      }
    }
    // When a grocery item is bought, send it to the bring-to-RV list.
    if (nextChecked && copyToOnCheck) {
      await copyItemToChecklist(
        tripId,
        copyToOnCheck,
        { name: item.name, catalogItemId: item.catalogItemId, qty: item.qty },
        identity,
      )
    }
  }

  async function handleTogglePersist(item: ChecklistItem) {
    await setItemPersist(tripId, checklist, item, !item.persist, identity)
  }

  async function handleDelete(item: ChecklistItem) {
    if (item.persist) await removePersistentItem(checklist.phase, checklist.name, item.name)
    await deleteItem(tripId, checklist.id, item.id)
  }

  async function handleRename() {
    if (renaming === null || !renaming.trim()) return
    await updateChecklist(tripId, checklist.id, { name: renaming.trim() })
    setRenaming(null)
  }

  async function handleDeleteChecklist() {
    setMenuOpen(false)
    if (!confirm(`Delete checklist "${checklist.name}" and all its items?`)) return
    await deleteChecklist(tripId, checklist.id)
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
      {/* Card header */}
      <div className="flex items-start gap-2 px-4 pt-4 pb-3">
        {dragHandleProps && (
          <button
            {...dragHandleProps}
            aria-label="Reorder checklist"
            className="-ml-1.5 mt-0.5 p-1 text-gray-300 hover:text-gray-500 touch-none cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-5 h-5" />
          </button>
        )}
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => setExpanded(v => !v)}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-semibold text-gray-800 truncate">{checklist.name}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-gray-500">{checked}/{total}</span>
              {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </div>
          <Progress value={progress} />
        </button>

        {/* Checklist menu */}
        <div className="relative shrink-0 -mr-1">
          <button onClick={() => setMenuOpen(v => !v)} className="p-1 text-gray-400 hover:text-gray-600">
            <MoreVertical className="w-5 h-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-36">
                <button
                  onClick={() => { setMenuOpen(false); setRenaming(checklist.name) }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Pencil className="w-4 h-4" /> Rename
                </button>
                <button
                  onClick={handleDeleteChecklist}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Items */}
      {expanded && (
        <div className="border-t border-gray-50 rounded-b-2xl overflow-hidden">
          {items.map(item => (
            <div
              key={item.id}
              className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 ${item.checked ? 'bg-green-50/50' : ''}`}
            >
              {/* Checkbox */}
              <button
                onClick={() => handleToggle(item)}
                className={`w-6 h-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                  item.checked
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'border-gray-300'
                }`}
              >
                {item.checked && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <span className={`text-base ${item.checked ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {item.name}
                </span>
                {item.qty && (
                  <span className="text-sm text-gray-500 ml-1">× {item.qty}</span>
                )}
                {item.frozenField && (
                  <span className="ml-2 text-xs text-amber-600">⚠ conflict</span>
                )}
              </div>

              {/* Persist (carry to future trips until checked) */}
              <button
                onClick={() => handleTogglePersist(item)}
                aria-label={item.persist ? 'Stop carrying to future trips' : 'Carry to future trips'}
                aria-pressed={!!item.persist}
                className={`p-1 ${item.persist ? 'text-[#2f6b4f]' : 'text-gray-300 hover:text-gray-500'}`}
              >
                <Pin className={`w-4 h-4 ${item.persist ? 'fill-current' : ''}`} />
              </button>

              {/* Delete */}
              <button
                onClick={() => handleDelete(item)}
                className="text-gray-300 hover:text-red-400 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

          {/* Add item button */}
          <button
            onClick={onAddItem}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-[#2f6b4f] font-medium hover:bg-emerald-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add item
          </button>
        </div>
      )}

      {/* Rename dialog */}
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title="Rename checklist">
        <div className="flex flex-col gap-4">
          <Input
            value={renaming ?? ''}
            onChange={e => setRenaming(e.target.value)}
            placeholder="Checklist name"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleRename()}
          />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button className="flex-1" onClick={handleRename} disabled={!renaming?.trim()}>Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
