import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTrips, useChecklists, useAmenities, useOrdering } from '@/hooks/useFirestore'
import { updateTrip, deleteTrip, completeTrip, addChecklist, savePhaseOrder, saveChecklistOrder, saveChecklistPositions } from '@/lib/firestore'
import { useAppStore } from '@/lib/store'
import { ChecklistCard } from './ChecklistCard'
import { AddItemSheet } from './AddItemSheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { ArrowLeft, MoreVertical, CalendarDays, Trash2, CheckCircle, Plus, Check, Tag, GripVertical } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Trip, ChecklistPhase, Checklist } from '@/types'

const PHASES: { value: ChecklistPhase; label: string }[] = [
  { value: 'pre_early', label: 'Before the trip' },
  { value: 'pre_dayof', label: 'Day of departure' },
  { value: 'pack_down', label: 'Pack down / return' },
  { value: 'grocery', label: 'Groceries' },
]

const PHASE_LABELS: Record<string, string> = {
  pre_early: 'Before the trip',
  pre_dayof: 'Day of departure',
  pack_down: 'Pack down / return',
  grocery: 'Groceries',
}

const STATUS_BADGE: Record<Trip['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'info' }> = {
  planned: { label: 'Planned', variant: 'info' },
  active: { label: 'Active', variant: 'warning' },
  completed: { label: 'Done', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'default' },
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// A draggable phase section (the whole group, with its header handle).
function SortableSection({ phase, label, children }: { phase: ChecklistPhase; label: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `phase:${phase}` })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <h2 className="flex items-center gap-1 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
        <button
          {...attributes}
          {...listeners}
          aria-label="Reorder section"
          className="-ml-1 p-1 text-gray-300 hover:text-gray-500 touch-none cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4" />
        </button>
        {label}
      </h2>
      {children}
    </div>
  )
}

// A draggable checklist card within a section.
function SortableChecklist({ checklist, tripId, onAddItem, copyToOnCheck }: {
  checklist: Checklist
  tripId: string
  onAddItem: () => void
  copyToOnCheck?: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checklist.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style}>
      <ChecklistCard
        checklist={checklist}
        tripId={tripId}
        onAddItem={onAddItem}
        copyToOnCheck={copyToOnCheck}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export function TripDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const trips = useTrips()
  const checklists = useChecklists(id)
  const amenities = useAmenities()
  const ordering = useOrdering()
  const identity = useAppStore(s => s.identity)!
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [newChecklist, setNewChecklist] = useState<{ name: string; phase: ChecklistPhase } | null>(null)
  const [savingChecklist, setSavingChecklist] = useState(false)
  const [editAmenities, setEditAmenities] = useState<string[] | null>(null)

  // Bought groceries get copied into the "Day of departure" checklist (bring to RV).
  const bringToRvId = checklists.find(c => c.phase === 'pre_dayof')?.id

  const trip = trips.find(t => t.id === id)
  if (!trip) return (
    <div className="flex items-center justify-center min-h-dvh">
      <p className="text-gray-400">Trip not found</p>
    </div>
  )

  const currentTrip = trip
  const badge = STATUS_BADGE[currentTrip.status]

  async function markComplete() {
    await completeTrip(currentTrip, identity)
    setMenuOpen(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this trip?')) return
    await deleteTrip(id!)
    navigate('/trips', { replace: true })
  }

  async function setStatus(status: Trip['status']) {
    await updateTrip(id!, { status })
    setMenuOpen(false)
  }

  async function handleAddChecklist() {
    if (!newChecklist?.name.trim()) return
    setSavingChecklist(true)
    await addChecklist(id!, {
      name: newChecklist.name.trim(),
      phase: newChecklist.phase,
      // Append at the end of its phase.
      order: byPhase[newChecklist.phase]?.length ?? 0,
    })
    setSavingChecklist(false)
    setNewChecklist(null)
  }

  function handleSectionDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = String(active.id).replace('phase:', '') as ChecklistPhase
    const to = String(over.id).replace('phase:', '') as ChecklistPhase
    const oldIndex = ordering.phaseOrder.indexOf(from)
    const newIndex = ordering.phaseOrder.indexOf(to)
    if (oldIndex === -1 || newIndex === -1) return
    savePhaseOrder(arrayMove(ordering.phaseOrder, oldIndex, newIndex))
  }

  function handleCardDragEnd(phase: ChecklistPhase, lists: Checklist[]) {
    return (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const oldIndex = lists.findIndex(c => c.id === active.id)
      const newIndex = lists.findIndex(c => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(lists, oldIndex, newIndex)
      saveChecklistPositions(id!, next)        // persist positions on this trip
      saveChecklistOrder(phase, next.map(c => c.name)) // remember for future trips
    }
  }

  async function handleSaveAmenities() {
    if (editAmenities === null) return
    await updateTrip(id!, { amenities: editAmenities })
    setEditAmenities(null)
  }

  // Group checklists by phase (each group already sorted by `order`).
  const byPhase = checklists.reduce<Record<string, typeof checklists>>((acc, cl) => {
    if (!acc[cl.phase]) acc[cl.phase] = []
    acc[cl.phase].push(cl)
    return acc
  }, {})

  // Phase sections to show, in the remembered order (only non-empty ones).
  const visiblePhases = ordering.phaseOrder.filter(p => byPhase[p]?.length)

  return (
    <div className="flex flex-col h-dvh bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button onClick={() => navigate('/trips')} className="text-gray-600 p-1 -ml-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">{trip.title}</h1>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <div className="relative">
            <button onClick={() => setMenuOpen(v => !v)} className="p-2 text-gray-500">
              <MoreVertical className="w-5 h-5" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-40">
                  {trip.status !== 'active' && (
                    <button onClick={() => setStatus('active')} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Mark as Active
                    </button>
                  )}
                  {trip.status !== 'completed' && (
                    <button onClick={markComplete} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-green-600 hover:bg-gray-50">
                      <CheckCircle className="w-4 h-4" /> Mark Complete
                    </button>
                  )}
                  {trip.status !== 'planned' && (
                    <button onClick={() => setStatus('planned')} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                      Mark as Planned
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); setEditAmenities(trip.amenities) }} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50">
                    <Tag className="w-4 h-4" /> Edit amenities
                  </button>
                  <button onClick={handleDelete} className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-500 hover:bg-gray-50">
                    <Trash2 className="w-4 h-4" /> Delete trip
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 px-5 pb-3 text-sm text-gray-500">
          <CalendarDays className="w-4 h-4" />
          <span>{formatDate(trip.startDate)} — {formatDate(trip.endDate)}</span>
        </div>
        <button
          onClick={() => setEditAmenities(trip.amenities)}
          className="flex flex-wrap items-center gap-1.5 px-5 pb-3 w-full text-left"
        >
          {trip.amenities.length > 0 ? (
            trip.amenities.map(aid => {
              const a = amenities.find(x => x.id === aid)
              return a ? (
                <span key={aid} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {a.icon} {a.name}
                </span>
              ) : null
            })
          ) : (
            <span className="text-xs text-gray-400">No amenities</span>
          )}
          <span className="text-xs text-[#2f6b4f] font-medium ml-1">Edit</span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-8 flex flex-col gap-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSectionDragEnd}>
          <SortableContext items={visiblePhases.map(p => `phase:${p}`)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-6">
              {visiblePhases.map(phase => {
                const phaseLists = byPhase[phase]
                return (
                  <SortableSection key={phase} phase={phase} label={PHASE_LABELS[phase] ?? phase}>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCardDragEnd(phase, phaseLists)}>
                      <SortableContext items={phaseLists.map(c => c.id)} strategy={verticalListSortingStrategy}>
                        <div className="flex flex-col gap-3">
                          {phaseLists.map(cl => (
                            <SortableChecklist
                              key={cl.id}
                              checklist={cl}
                              tripId={id!}
                              onAddItem={() => setAddingTo(cl.id)}
                              copyToOnCheck={cl.phase === 'grocery' ? bringToRvId : undefined}
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                    {/* Per-section shortcut: add a blank checklist straight into this phase. */}
                    <button
                      onClick={() => setNewChecklist({ name: '', phase: phase as ChecklistPhase })}
                      className="flex items-center gap-1.5 mt-2 px-1 text-sm font-medium text-[#2f6b4f] hover:underline"
                    >
                      <Plus className="w-4 h-4" /> Add checklist
                    </button>
                  </SortableSection>
                )
              })}
            </div>
          </SortableContext>
        </DndContext>

        {checklists.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-base font-medium">No checklists yet</p>
            <p className="text-sm">Add one below to get started</p>
          </div>
        )}

        {/* Add checklist */}
        <button
          onClick={() => setNewChecklist({ name: '', phase: 'pre_early' })}
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl border-2 border-dashed border-gray-200 text-[#2f6b4f] font-medium hover:bg-emerald-50 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add checklist
        </button>
      </div>

      {/* Add Item Sheet */}
      {addingTo && (
        <AddItemSheet
          tripId={id!}
          checklistId={addingTo}
          onClose={() => setAddingTo(null)}
        />
      )}

      {/* Edit amenities */}
      <Dialog open={editAmenities !== null} onClose={() => setEditAmenities(null)} title="Trip amenities">
        {editAmenities !== null && (
          <div className="flex flex-col gap-4">
            {amenities.length === 0 ? (
              <p className="text-sm text-gray-500">No amenities defined yet. Add some in Manage → Amenities.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {amenities.map(a => {
                  const active = editAmenities.includes(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => setEditAmenities(
                        active ? editAmenities.filter(x => x !== a.id) : [...editAmenities, a.id]
                      )}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${
                        active ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {active && <Check className="w-3.5 h-3.5" />}
                      <span>{a.icon}</span>
                      <span>{a.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" className="flex-1" onClick={() => setEditAmenities(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleSaveAmenities}>Save</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* New checklist dialog */}
      <Dialog open={!!newChecklist} onClose={() => setNewChecklist(null)} title="New checklist">
        {newChecklist && (
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">Name</label>
              <Input
                value={newChecklist.name}
                onChange={e => setNewChecklist({ ...newChecklist, name: e.target.value })}
                placeholder="e.g. Kitchen gear"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAddChecklist()}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">Section</label>
              <div className="grid grid-cols-2 gap-2">
                {PHASES.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setNewChecklist({ ...newChecklist, phase: p.value })}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border-2 transition-colors ${newChecklist.phase === p.value ? 'border-[#2f6b4f] bg-[#2f6b4f] text-white' : 'border-gray-200 text-gray-600'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setNewChecklist(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleAddChecklist} disabled={savingChecklist || !newChecklist.name.trim()}>Add</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

