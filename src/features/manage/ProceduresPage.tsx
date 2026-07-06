import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProcedures } from '@/hooks/useFirestore'
import { ALL_PROCEDURE_IDS, PROCEDURE_LABELS, addProcedureStep, removeProcedureStep, saveProcedureSteps } from '@/lib/firestore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, Plus, Pencil, Trash2, GripVertical, ShieldCheck } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TransitionId, ProcedureStep } from '@/types'

function SortableStep({ step, onEdit, onDelete }: {
  step: ProcedureStep
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 px-3 py-3">
      <button
        {...attributes}
        {...listeners}
        aria-label="Reorder step"
        className="p-1 -ml-1 text-gray-300 hover:text-gray-500 touch-none cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm font-medium text-gray-800">{step.text}</span>
      <button onClick={onEdit} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Edit step">
        <Pencil className="w-4 h-4" />
      </button>
      <button onClick={onDelete} className="text-gray-400 hover:text-red-500 p-1" aria-label="Delete step">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

/**
 * Manage → Safety checklists (§20): edit the shared per-transition safety
 * procedures reused by every trip. Steps can be added, renamed, deleted, and
 * drag-reordered; changes apply to all trips (future and not-yet-crossed
 * transitions of current ones).
 */
export function ProceduresPage() {
  const navigate = useNavigate()
  const procedures = useProcedures()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [editing, setEditing] = useState<{ transitionId: TransitionId; step: ProcedureStep } | null>(null)
  const [editText, setEditText] = useState('')
  const [drafts, setDrafts] = useState<Partial<Record<TransitionId, string>>>({})

  function stepsFor(id: TransitionId): ProcedureStep[] {
    return procedures.find(p => p.id === id)?.steps ?? []
  }

  async function handleAdd(transitionId: TransitionId) {
    const text = (drafts[transitionId] ?? '').trim()
    if (!text) return
    await addProcedureStep(transitionId, text)
    setDrafts(d => ({ ...d, [transitionId]: '' }))
  }

  async function handleDelete(transitionId: TransitionId, step: ProcedureStep) {
    if (!confirm(`Remove "${step.text}" from every trip?`)) return
    await removeProcedureStep(transitionId, step)
  }

  async function handleSaveEdit() {
    if (!editing || !editText.trim()) return
    const steps = stepsFor(editing.transitionId).map(s =>
      s.id === editing.step.id ? { ...s, text: editText.trim() } : s
    )
    await saveProcedureSteps(editing.transitionId, steps)
    setEditing(null)
  }

  function handleDragEnd(transitionId: TransitionId) {
    return (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const steps = stepsFor(transitionId)
      const oldIndex = steps.findIndex(s => s.id === active.id)
      const newIndex = steps.findIndex(s => s.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      saveProcedureSteps(transitionId, arrayMove(steps, oldIndex, newIndex))
    }
  }

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white border-b border-gray-100">
        <button onClick={() => navigate(-1)} className="text-gray-600 p-1 -ml-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-gray-800">Safety checklists</h1>
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-6 p-4">
        <p className="text-sm text-gray-500 -mb-2">
          These steps are shared by every trip. The app asks for them before you advance past each point of the route.
        </p>
        {ALL_PROCEDURE_IDS.map(tid => {
          const steps = stepsFor(tid)
          return (
            <div key={tid}>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                <ShieldCheck className="w-4 h-4 text-gray-400" /> {PROCEDURE_LABELS[tid]}
              </h2>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(tid)}>
                <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {steps.map(step => (
                      <SortableStep
                        key={step.id}
                        step={step}
                        onEdit={() => { setEditing({ transitionId: tid, step }); setEditText(step.text) }}
                        onDelete={() => handleDelete(tid, step)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              <div className="flex gap-2 mt-2">
                <Input
                  value={drafts[tid] ?? ''}
                  onChange={e => setDrafts(d => ({ ...d, [tid]: e.target.value }))}
                  placeholder="Add a step…"
                  onKeyDown={e => e.key === 'Enter' && handleAdd(tid)}
                />
                <Button variant="secondary" onClick={() => handleAdd(tid)} disabled={!(drafts[tid] ?? '').trim()} aria-label="Add step">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit step">
        <div className="flex flex-col gap-4">
          <Input
            value={editText}
            onChange={e => setEditText(e.target.value)}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
          />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSaveEdit} disabled={!editText.trim()}>Save</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
