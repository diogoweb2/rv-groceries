import { useState, useEffect, useRef } from 'react'
import { useChecklistItems } from '@/hooks/useFirestore'
import {
  updateChecklist, deleteChecklist, deleteChecklistItemAndPropagate,
  setItemPersist, setItemDestination, itemDestination, setItemRemoveOnComplete,
  savePinnedChecklist, removePinnedChecklist,
  pushPinnedChecklistToTrips,
  setChecklistItemChecked, updateChecklistItemAndPropagate,
} from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Progress } from '@/components/ui/progress'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Plus, Minus, Trash2, ChevronDown, ChevronUp, MoreVertical, Pencil, GripVertical, Pin, EyeOff, Eye, Check, CircleCheck, CircleDashed, Printer } from 'lucide-react'
import { checklistTitle } from '@/lib/checklistTitle'
import { printLists } from '@/lib/print'
import { destinationMeta, destinationIcon, nextDestination } from './destination'
import type { Checklist, ChecklistItem } from '@/types'

// Build a printable line for an item: name plus quantity where it's meaningful.
function printLine(item: ChecklistItem): string {
  const qty = Math.max(1, Number(item.qty) || 1)
  return item.qty && qty > 1 ? `${item.name} × ${item.qty}` : item.name
}

interface Props {
  checklist: Checklist
  tripId: string
  onAddItem: () => void
  /** Drag handle attributes/listeners from the sortable wrapper. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
}

export function ChecklistCard({ checklist, tripId, onAddItem, dragHandleProps }: Props) {
  const identity = useAppStore(s => s.identity)!
  const items = useChecklistItems(tripId, checklist.id)
  const [expanded, setExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [itemMenu, setItemMenu] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(true)

  const checked = items.filter(i => i.checked).length
  const total = items.length
  const progress = total ? (checked / total) * 100 : 0

  // Completed items are auto-hidden within the card unless "Show completed" is on;
  // when shown, they sink to the bottom.
  const visibleItems = showCompleted
    ? [...items].sort((a, b) => Number(a.checked) - Number(b.checked))
    : items.filter(i => !i.checked)

  // When this checklist is pinned, keep the global snapshot in sync with any
  // item changes (add, delete, toggle). Skip the first render where items is
  // still the initial empty array before Firestore data loads.
  const hasMounted = useRef(false)
  useEffect(() => {
    if (!checklist.pinned) return
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    savePinnedChecklist(checklist.name, checklist.phase, items, identity)
  }, [items, checklist.pinned, checklist.name, checklist.phase, identity])

  // Hide a checklist the moment it becomes 100% complete (§5). Skip the first
  // meaningful load so an already-complete list on open isn't hidden.
  const completeRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (total === 0) return
    const isComplete = checked === total
    if (completeRef.current === null) {
      completeRef.current = isComplete
      return
    }
    if (isComplete && !completeRef.current && !checklist.hidden) {
      updateChecklist(tripId, checklist.id, { hidden: true })
    }
    completeRef.current = isComplete
  }, [checked, total, checklist.hidden, checklist.name, checklist.id, tripId])

  function handlePrint() {
    setMenuOpen(false)
    printLists(checklistTitle(checklist), [{
      name: checklistTitle(checklist),
      items: items.filter(i => !i.checked).map(i => printLine(i)),
    }])
  }

  async function handleToggleHidden() {
    setMenuOpen(false)
    await updateChecklist(tripId, checklist.id, { hidden: !checklist.hidden })
  }

  async function handleToggle(item: ChecklistItem) {
    await setChecklistItemChecked(tripId, checklist, item, !item.checked, identity)
  }

  async function handleTogglePersist(item: ChecklistItem) {
    await setItemPersist(tripId, checklist, item, !item.persist, identity)
  }

  async function handleCycleDestination(item: ChecklistItem) {
    await setItemDestination(tripId, checklist, item, nextDestination(itemDestination(item)), identity)
  }

  async function handleToggleRemoveOnComplete(item: ChecklistItem) {
    await setItemRemoveOnComplete(tripId, checklist.id, item, !item.removeOnComplete, identity)
  }

  async function handleDeleteItem(item: ChecklistItem) {
    await deleteChecklistItemAndPropagate(tripId, checklist, item)
  }

  async function handleChangeQty(item: ChecklistItem, delta: number) {
    const current = Math.max(1, Number(item.qty) || 1)
    const next = Math.max(1, current + delta)
    if (next === current) return
    await updateChecklistItemAndPropagate(tripId, checklist, item, { qty: String(next) }, identity)
  }

  async function handleTogglePin() {
    setMenuOpen(false)
    if (checklist.pinned) {
      await updateChecklist(tripId, checklist.id, { pinned: false })
      await removePinnedChecklist(checklist.phase, checklist.name)
    } else {
      await updateChecklist(tripId, checklist.id, { pinned: true })
      await savePinnedChecklist(checklist.name, checklist.phase, items, identity)
      await pushPinnedChecklistToTrips(tripId, checklist.name, checklist.phase, items, identity)
    }
  }

  async function handleRename() {
    if (renaming === null || !renaming.trim()) return
    const newName = renaming.trim()
    if (checklist.pinned) {
      await removePinnedChecklist(checklist.phase, checklist.name)
      await savePinnedChecklist(newName, checklist.phase, items, identity)
    }
    await updateChecklist(tripId, checklist.id, { name: newName })
    setRenaming(null)
  }

  async function handleDeleteChecklist() {
    setMenuOpen(false)
    if (checklist.pinned) {
      await removePinnedChecklist(checklist.phase, checklist.name)
    }
    await deleteChecklist(tripId, checklist.id)
  }

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${checklist.hidden ? 'opacity-60' : ''}`}>
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
            <span className="font-semibold text-gray-800 truncate">{checklistTitle(checklist)}</span>
              {checklist.hidden && <span className="text-[10px] font-medium uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">Hidden</span>}
              {checklist.pinned && <Pin className="w-3.5 h-3.5 text-[#2f6b4f] fill-current shrink-0" />}
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
                  onClick={handleTogglePin}
                  className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm hover:bg-gray-50 ${checklist.pinned ? 'text-[#2f6b4f]' : 'text-gray-700'}`}
                >
                  <Pin className={`w-4 h-4 ${checklist.pinned ? 'fill-current' : ''}`} />
                  {checklist.pinned ? 'Unpin from future trips' : 'Pin to future trips'}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setRenaming(checklist.name) }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Pencil className="w-4 h-4" /> Rename
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setShowCompleted(v => !v) }}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {showCompleted
                    ? <><CircleDashed className="w-4 h-4" /> Hide completed</>
                    : <><CircleCheck className="w-4 h-4" /> Show completed</>}
                </button>
                <button
                  onClick={handleToggleHidden}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {checklist.hidden ? <><Eye className="w-4 h-4" /> Unhide</> : <><EyeOff className="w-4 h-4" /> Hide for this trip</>}
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Printer className="w-4 h-4" /> Print
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

      {/* Items. No overflow-hidden: it would clip the bottom rows' "⋮" dropdowns. */}
      {expanded && (
        <div className="border-t border-gray-50 rounded-b-2xl">
          {visibleItems.map(item => (
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
                {item.qty && !item.linkedSupermarketItemId && (
                  <span className="text-sm text-gray-500 ml-1">× {item.qty}</span>
                )}
                {item.frozenField && (
                  <span className="ml-2 text-xs text-amber-600">⚠ conflict</span>
                )}
              </div>

              {/* Quantity stepper — shopping items, whose qty syncs to Supermarket */}
              {item.linkedSupermarketItemId && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleChangeQty(item, -1)}
                    disabled={Math.max(1, Number(item.qty) || 1) <= 1}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 disabled:opacity-30 active:bg-gray-100"
                    aria-label="Decrease quantity"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium text-gray-700">{Math.max(1, Number(item.qty) || 1)}</span>
                  <button
                    onClick={() => handleChangeQty(item, 1)}
                    className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 active:bg-gray-100"
                    aria-label="Increase quantity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Final destination (§18): Home / Truck / RV — tap to cycle */}
              {(() => {
                const dest = itemDestination(item)
                const meta = destinationMeta(dest)
                const Icon = destinationIcon(dest)
                return (
                  <button
                    onClick={() => handleCycleDestination(item)}
                    aria-label={meta ? `Final destination: ${meta.label} — tap to change` : 'Set final destination'}
                    className={`p-2.5 -m-1 ${meta ? 'text-[#2f6b4f]' : 'text-gray-300 hover:text-gray-500'}`}
                  >
                    <Icon className="w-5 h-5" />
                  </button>
                )
              })()}

              {/* Item menu: persist (§12) and complete-for-trip (§20) */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setItemMenu(v => (v === item.id ? null : item.id))}
                  aria-label="Item actions"
                  className="p-2.5 -m-1 text-gray-300 hover:text-gray-500"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
                {itemMenu === item.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setItemMenu(null)} />
                    <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-56">
                      <button
                        onClick={() => { setItemMenu(null); handleTogglePersist(item) }}
                        className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm hover:bg-gray-50 ${item.persist ? 'text-[#2f6b4f]' : 'text-gray-700'}`}
                      >
                        <Pin className={`w-4 h-4 shrink-0 ${item.persist ? 'fill-current' : ''}`} />
                        <span className="flex-1 text-left">Pin to next trip</span>
                        {item.persist && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                      <button
                        onClick={() => { setItemMenu(null); handleToggleRemoveOnComplete(item) }}
                        className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm hover:bg-gray-50 ${item.removeOnComplete ? 'text-[#2f6b4f]' : 'text-gray-700'}`}
                      >
                        <CircleCheck className="w-4 h-4 shrink-0" />
                        <span className="flex-1 text-left">Remove after completion</span>
                        {item.removeOnComplete && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                      <button
                        onClick={() => { setItemMenu(null); handleDeleteItem(item) }}
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
          ))}

          {/* Hidden-completed hint */}
          {!showCompleted && checked > 0 && (
            <button
              onClick={() => setShowCompleted(true)}
              className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50 border-b border-gray-50"
            >
              <CircleCheck className="w-3.5 h-3.5" />
              {checked} completed {checked === 1 ? 'item' : 'items'} hidden — show
            </button>
          )}

          {/* Add item button */}
          <button
            onClick={onAddItem}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-[#2f6b4f] font-medium hover:bg-emerald-50 transition-colors rounded-b-2xl"
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
