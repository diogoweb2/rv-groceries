import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { useFeedback } from '@/hooks/useFirestore'
import { addFeedback, updateFeedback, deleteFeedback, saveFeedbackPositions } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, Plus, Pencil, Check, GripVertical, Bug, Lightbulb, ClipboardCopy, ClipboardCheck, Trash2 } from 'lucide-react'
import type { Feedback, FeedbackKind } from '@/types'

type Filter = 'all' | FeedbackKind | 'completed'

const KIND_META: Record<FeedbackKind, { label: string; icon: typeof Bug; badge: string }> = {
  bug: { label: 'Bug', icon: Bug, badge: 'bg-red-50 text-red-600' },
  improvement: { label: 'Improvement', icon: Lightbulb, badge: 'bg-amber-50 text-amber-600' },
}

// Which entries a filter shows: the Completed filter shows only done entries;
// every other filter shows only active (not-done) ones (§17).
function matchesFilter(item: Feedback, filter: Filter): boolean {
  if (filter === 'completed') return !!item.done
  if (item.done) return false
  if (filter === 'all') return true
  return item.kind === filter
}

function SortableRow({
  item,
  onToggleDone,
  onEdit,
  onDelete,
}: {
  item: Feedback
  onToggleDone: (item: Feedback) => void
  onEdit: (item: Feedback) => void
  onDelete: (item: Feedback) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const meta = KIND_META[item.kind]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 bg-white border-b border-gray-50 px-4 py-3.5 ${item.done ? 'opacity-60' : ''}`}
    >
      <button {...attributes} {...listeners} className="text-gray-300 touch-none">
        <GripVertical className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0">
        <span className={`text-base break-words whitespace-pre-wrap ${item.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>{item.text}</span>
        <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium align-middle ${meta.badge}`}>
          <meta.icon className="w-3 h-3" /> {meta.label}
        </span>
      </div>

      {item.done ? (
        <button onClick={() => onDelete(item)} className="text-gray-400 hover:text-red-500 p-1 shrink-0" aria-label="Delete permanently">
          <Trash2 className="w-4 h-4" />
        </button>
      ) : (
        <button onClick={() => onEdit(item)} className="text-gray-400 hover:text-gray-600 p-1 shrink-0" aria-label="Edit">
          <Pencil className="w-4 h-4" />
        </button>
      )}
      <button
        onClick={() => onToggleDone(item)}
        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
          item.done
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-gray-300 text-transparent hover:border-green-500 hover:bg-green-500 hover:text-white'
        }`}
        aria-label={item.done ? 'Restore (mark not done)' : 'Mark done'}
        title={item.done ? 'Restore' : 'Mark done'}
      >
        <Check className="w-4 h-4" />
      </button>
    </div>
  )
}

export function FeedbackPage() {
  const navigate = useNavigate()
  const rawItems = useFeedback()
  const identity = useAppStore(s => s.identity)!

  const [items, setItems] = useState<Feedback[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; item?: Feedback } | null>(null)
  const [text, setText] = useState('')
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Keep a local copy for optimistic drag-and-drop.
  useEffect(() => { setItems(rawItems) }, [rawItems])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const visible = items.filter(i => matchesFilter(i, filter))

  function openAdd() { setText(''); setKind(filter === 'improvement' ? 'improvement' : 'bug'); setDialog({ mode: 'add' }) }
  function openEdit(item: Feedback) { setText(item.text); setKind(item.kind); setDialog({ mode: 'edit', item }) }

  async function handleSave() {
    if (!text.trim()) return
    setSaving(true)
    if (dialog?.mode === 'add') {
      await addFeedback({ kind, text: text.trim(), order: items.length, createdBy: identity })
    } else if (dialog?.item) {
      await updateFeedback(dialog.item.id, { kind, text: text.trim() })
    }
    setSaving(false)
    setDialog(null)
  }

  // Copy the active (not-done) list, in order, to the clipboard as plain text —
  // a running-numbered block per entry, ready to paste into an AI (§17).
  // "Bug 1:\n<text>" / "Improvement 2:\n<text>", blank line between.
  async function handleExport() {
    const active = items.filter(i => !i.done)
    if (active.length === 0) return
    const out = active
      .map((i, idx) => `${KIND_META[i.kind].label} ${idx + 1}:\n${i.text}`)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(out)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable (e.g. insecure context) — silently ignore */
    }
  }

  // Complete an entry (hide it from the working list) or restore it. The entry
  // is kept either way so a mistaken completion can be undone (§17).
  async function handleToggleDone(item: Feedback) {
    const done = !item.done
    setItems(items.map(i => (i.id === item.id ? { ...i, done } : i)))
    await updateFeedback(item.id, { done })
  }

  // Permanently remove a completed entry from the Completed view.
  async function handleDelete(item: Feedback) {
    if (!confirm('Delete this entry permanently?')) return
    setItems(items.filter(i => i.id !== item.id))
    await deleteFeedback(item.id)
  }

  // Drag reorders within the currently-visible (possibly filtered) rows, then
  // rebuilds the full list so hidden entries keep their relative slots, and
  // persists any changed positions.
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = visible.findIndex(i => i.id === active.id)
    const newIndex = visible.findIndex(i => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const reorderedVisible = arrayMove(visible, oldIndex, newIndex)

    let vi = 0
    const merged = items.map(i =>
      matchesFilter(i, filter) ? reorderedVisible[vi++] : i
    )
    setItems(merged)
    const changed = merged
      .map((item, idx) => ({ id: item.id, order: idx }))
      .filter(({ id, order }) => items.find(i => i.id === id)?.order !== order)
    if (changed.length > 0) await saveFeedbackPositions(changed)
  }

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'bug', label: 'Bugs' },
    { key: 'improvement', label: 'Improvements' },
    { key: 'completed', label: 'Completed' },
  ]

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">Bugs &amp; ideas</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            onClick={handleExport}
            disabled={items.length === 0}
            title="Copy all to clipboard"
            aria-label="Copy all to clipboard"
          >
            {copied ? <ClipboardCheck className="w-5 h-5 text-[#2f6b4f]" /> : <ClipboardCopy className="w-5 h-5" />}
          </Button>
          <Button size="icon" onClick={openAdd}><Plus className="w-5 h-5" /></Button>
        </div>
      </div>

      {/* Filter chips — the list is the same, filtering only hides rows. */}
      <div className="flex flex-wrap gap-2 px-4 py-3 bg-white border-b border-gray-100">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              filter === f.key ? 'bg-[#2f6b4f] text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visible.map(i => i.id)} strategy={verticalListSortingStrategy}>
            {visible.map(item => (
              <SortableRow key={item.id} item={item} onToggleDone={handleToggleDone} onEdit={openEdit} onDelete={handleDelete} />
            ))}
          </SortableContext>
        </DndContext>
        {visible.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-10">
            {filter === 'all' ? 'Nothing logged yet'
              : filter === 'completed' ? 'No completed entries'
              : `No ${filter === 'bug' ? 'bugs' : 'improvements'}`}
          </p>
        )}
      </div>

      <Dialog open={!!dialog} onClose={() => setDialog(null)} title={dialog?.mode === 'add' ? 'New entry' : 'Edit entry'}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">Type</label>
            <div className="flex gap-2">
              {(Object.keys(KIND_META) as FeedbackKind[]).map(k => {
                const meta = KIND_META[k]
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 text-sm font-medium ${
                      kind === k ? 'border-[#2f6b4f] text-[#2f6b4f]' : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    <meta.icon className="w-4 h-4" /> {meta.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1.5 block">Description</label>
            <Textarea value={text} onChange={e => setText(e.target.value)} rows={5} autoFocus
              placeholder="What's the bug or idea?  (Enter for a new line, ⌘/Ctrl+Enter to save)"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave() }} />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDialog(null)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !text.trim()}>Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
